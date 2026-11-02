// ルールエンジン（ホストが状態を管理する。DOM非依存なのでNodeでもテスト可能）
export const CARD_TYPES = ['A', 'K', 'Q'];
export const MAX_PLAY = 5;   // 1回に出せる最大枚数
const HAND_SIZE = 5;
const DICE_PER = 5;
export const TIMING = {
  deal: 2600, roll: 2800, turn: 30000, forced: 6000,
  revealCard: 3800, revealDice: 3400, revealDicePer: 2200,
  shotPull: 5800, shotAfterBlank: 3200, shotAfterFatal: 6000,
  drinkSafe: 6600, drinkFatal: 9800,
};

export function makeDeck() {
  const d = [];
  for (const t of CARD_TYPES) for (let i = 0; i < 6; i++) d.push(t);
  d.push('J', 'J');
  return d;
}
function shuffleArr(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Engine {
  constructor(o = {}) {
    this.rng = o.rng || Math.random;
    this.now = o.now || (() => Date.now());
    this.T = Object.assign({}, TIMING, o.timing || {});
    this.mode = 'card';
    this.seats = [null, null, null, null];
    this.phase = 'lobby';
    this.events = [];
    this.evId = o.evStart || 0;
    this.seq = 0;
    this.dirty = true;
    this.rn = 0;
    this.turn = -1;
    this.forced = false;
    this.phaseEnd = 0;
    this.table = null;
    this.pile = 0;
    this.lastPlay = null;
    this.bid = null;
    this.winner = -1;
    this.loser = -1;
    this.botAt = 0;
    this.botN = 0;
  }
  touch() { this.seq++; this.dirty = true; }
  ev(e) {
    e.i = ++this.evId;
    this.events.push(e);
    if (this.events.length > 8) this.events.shift();
    this.touch();
  }
  seatOf(id) { return this.seats.findIndex(s => s && s.id === id); }
  occupied() { return this.seats.map((s, i) => (s ? i : -1)).filter(i => i >= 0); }
  aliveSeats() { return this.seats.map((s, i) => (s && s.alive ? i : -1)).filter(i => i >= 0); }
  totalDice() { return this.aliveSeats().length * DICE_PER; }

  addPlayer(id, name, bot = false) {
    const ex = this.seatOf(id);
    if (ex >= 0) return ex;
    if (this.phase !== 'lobby') return -1;
    const i = this.seats.findIndex(s => !s);
    if (i < 0) return -1;
    this.seats[i] = {
      id, name: String(name || 'Player').slice(0, 12), bot: !!bot, char: i,
      alive: true, left: false, hand: [], dice: [], shots: 0, bullet: 0, poison: 0,
    };
    this.touch();
    return i;
  }
  addBot(names) {
    const i = this.seats.findIndex(s => !s);
    if (i < 0 || this.phase !== 'lobby') return -1;
    this.botN++;
    const nm = names[(this.botN - 1) % names.length];
    return this.addPlayer('bot' + this.botN + '_' + Math.floor(this.rng() * 1e6), nm, true);
  }
  removeBot() {
    if (this.phase !== 'lobby') return false;
    for (let i = 3; i >= 0; i--) if (this.seats[i] && this.seats[i].bot) { this.seats[i] = null; this.touch(); return true; }
    return false;
  }
  rename(id, name) {
    const i = this.seatOf(id);
    if (i >= 0 && name && this.seats[i].name !== name) { this.seats[i].name = String(name).slice(0, 12); this.touch(); }
  }
  setMode(m) {
    if (this.phase !== 'lobby' || (m !== 'card' && m !== 'dice')) return;
    this.mode = m; this.touch();
  }
  removePlayer(id) {
    const i = this.seatOf(id);
    if (i < 0) return;
    const s = this.seats[i];
    if (this.phase === 'lobby') { this.seats[i] = null; this.touch(); return; }
    if (s.left) return;
    const wasAlive = s.alive;
    s.left = true; s.alive = false; s.hand = []; s.dice = [];
    this.ev({ t: 'leave', s: i });
    if (this.phase === 'over' || !wasAlive) return;
    const alive = this.aliveSeats();
    if (alive.length <= 1) { this.finish(); return; }
    if (this.phase === 'turn' && this.turn === i) {
      if (this.mode === 'card') this.passTurnCard(i);
      else this.beginTurn(this.nextAliveAfter(i), this.isDiceForced());
    } else if (this.phase === 'turn' && this.mode === 'card') {
      // re-evaluate forced state (others may now be the only card holders)
      const t = this.turn;
      const othersWithCards = alive.filter(j => j !== t && this.seats[j].hand.length > 0);
      if (!this.forced && this.seats[t].hand.length === 0 && othersWithCards.length === 0 && this.lastPlay) {
        this.beginTurn(t, true);
      }
    }
  }

  start() {
    if (this.phase !== 'lobby' || this.occupied().length < 2) return false;
    // 席替え: ゲームごとに座る位置（＝順番と隣の人）をランダムにする。
    // 全員が1つずつずれただけ（回転）だと一人称では同じ並びに見えるので、前回と「並び順」が必ず変わるようにする
    const players = this.seats.filter(Boolean);
    const sig = (seats) => {
      const ids = seats.map(x => (x ? x.id : '-'));
      const anchor = players.map(p => p.id).sort()[0];
      const k = ids.indexOf(anchor);
      return ids.slice(k).concat(ids.slice(0, k)).join('|');
    };
    const prev = sig(this.seats);
    let next, tries = 0;
    do {
      const spots = shuffleArr([0, 1, 2, 3], this.rng);
      next = [null, null, null, null];
      players.forEach((p, k) => { next[spots[k]] = p; });
    } while (players.length > 1 && sig(next) === prev && ++tries < 60);
    this.seats = next;
    for (const s of this.seats) {
      if (!s) continue;
      Object.assign(s, { alive: true, left: false, shots: 0, poison: 0, hand: [], dice: [] });
      s.bullet = Math.floor(this.rng() * 6);
    }
    this.winner = -1; this.rn = 0; this.loser = -1;
    this.ev({ t: 'start', md: this.mode });
    const al = this.aliveSeats();
    this.newRound(al[Math.floor(this.rng() * al.length)]);
    return true;
  }

  newRound(starter) {
    this.rn++;
    this.lastPlay = null; this.bid = null; this.pile = 0; this.forced = false; this.loser = -1;
    const now = this.now();
    if (this.mode === 'card') {
      this.table = CARD_TYPES[Math.floor(this.rng() * 3)];
      const deck = shuffleArr(makeDeck(), this.rng);
      for (const s of this.seats) {
        if (!s) continue;
        s.dice = [];
        s.hand = s.alive ? deck.splice(0, HAND_SIZE) : [];
      }
      this.ev({ t: 'round', rn: this.rn, tc: this.table, st: starter });
      this.phase = 'deal'; this.phaseEnd = now + this.T.deal;
    } else {
      this.table = null;
      for (const s of this.seats) {
        if (!s) continue;
        s.hand = [];
        s.dice = s.alive ? Array.from({ length: DICE_PER }, () => 1 + Math.floor(this.rng() * 6)) : [];
      }
      this.ev({ t: 'roll', rn: this.rn, st: starter });
      this.phase = 'roll'; this.phaseEnd = now + this.T.roll;
    }
    this.turn = starter;
    this.botAt = 0;
    this.touch();
  }

  beginTurn(seat, forced = false) {
    this.turn = seat; this.forced = !!forced; this.phase = 'turn';
    const now = this.now();
    this.phaseEnd = now + (forced ? this.T.forced : this.T.turn);
    const s = this.seats[seat];
    this.botAt = s && s.bot ? now + (forced ? 1400 : 1600 + this.rng() * 2400) : 0;
    this.touch();
  }

  nextAliveAfter(seat, pred) {
    for (let k = 1; k <= 4; k++) {
      const j = (seat + k) % 4;
      const s = this.seats[j];
      if (s && s.alive && (!pred || pred(s))) return j;
    }
    return -1;
  }

  passTurnCard(from) {
    const j = this.nextAliveAfter(from, s => s.hand.length > 0);
    if (j >= 0 && j !== from) return this.beginTurn(j, false);
    // nobody else holds cards → the last play is challenged automatically by the next player
    const k = this.nextAliveAfter(from);
    if (!this.lastPlay) {
      // nothing on the table and nobody can play → redeal
      return this.newRound(k >= 0 ? k : from);
    }
    if (k === this.lastPlay.seat) {
      // only the last player is left with cards; next alive (other than them) challenges
      const k2 = this.nextAliveAfter(k);
      return this.beginTurn(k2 >= 0 ? k2 : k, true);
    }
    return this.beginTurn(k, true);
  }

  isDiceForced() {
    return !!(this.bid && this.bid.q >= this.totalDice() && this.bid.f === 6);
  }

  validBid(q, f) {
    if (!Number.isInteger(q) || !Number.isInteger(f) || f < 1 || f > 6 || q < 1 || q > this.totalDice()) return false;
    if (!this.bid) return true;
    return q > this.bid.q || (q === this.bid.q && f > this.bid.f);
  }

  act(seat, a) {
    if (!a || typeof a !== 'object') return 'bad';
    if (this.phase !== 'turn' || seat !== this.turn) return 'turn';
    const s = this.seats[seat];
    if (!s || !s.alive) return 'dead';
    const now = this.now();

    if (a.t === 'play' && this.mode === 'card') {
      if (this.forced) return 'forced';
      if (!Array.isArray(a.i)) return 'bad';
      const idx = [...new Set(a.i)].filter(n => Number.isInteger(n));
      if (idx.length < 1 || idx.length > MAX_PLAY) return 'count';
      if (idx.some(n => n < 0 || n >= s.hand.length)) return 'idx';
      // あがり: 直前の人が手札を出し切り、この人が告発せずにカードを出した → 直前の人の勝ち
      const lp = this.lastPlay;
      if (lp && lp.seat !== seat) {
        const prev = this.seats[lp.seat];
        if (prev && prev.alive && prev.hand.length === 0) {
          const lie = lp.cards.some(c => c !== this.table && c !== 'J');
          this.ev({ t: 'agari', s: lp.seat, by: seat, cards: lp.cards.slice(), lie, tc: this.table });
          this.winner = lp.seat; this.phase = 'over'; this.botAt = 0;
          this.ev({ t: 'over', w: lp.seat, why: 'agari' });
          return null;
        }
      }
      const cards = idx.map(n => s.hand[n]);
      s.hand = s.hand.filter((_, n) => !idx.includes(n));
      this.lastPlay = { seat, cards };
      this.pile += cards.length;
      this.ev({ t: 'play', s: seat, n: cards.length, tc: this.table, left: s.hand.length });
      this.passTurnCard(seat);
      return null;
    }

    if (a.t === 'liar') {
      if (this.mode === 'card') {
        const lp = this.lastPlay;
        if (!lp || lp.seat === seat) return 'nolast';
        const lie = lp.cards.some(c => c !== this.table && c !== 'J');
        const loser = lie ? lp.seat : seat;
        this.loser = loser;
        this.ev({ t: 'liar', s: seat, tg: lp.seat, cards: lp.cards.slice(), lie, lo: loser, tc: this.table, fz: this.forced });
        this.phase = 'reveal'; this.phaseEnd = now + this.T.revealCard; this.botAt = 0;
        this.touch();
        return null;
      } else {
        const b = this.bid;
        if (!b || b.s === seat) return 'nobid';
        let cnt = 0;
        const dice = this.seats.map(p => (p && p.alive ? p.dice.slice() : null));
        for (const d of dice) if (d) for (const v of d) if (v === b.f || (b.f !== 1 && v === 1)) cnt++;
        const lie = cnt < b.q;
        const loser = lie ? b.s : seat;
        this.loser = loser;
        this.ev({ t: 'dliar', s: seat, tg: b.s, q: b.q, f: b.f, cnt, dice, lie, lo: loser });
        this.phase = 'reveal'; this.phaseEnd = now + this.T.revealDice + dice.filter(Boolean).length * (this.T.revealDicePer || 0); this.botAt = 0;
        this.touch();
        return null;
      }
    }

    if (a.t === 'bid' && this.mode === 'dice') {
      if (this.forced) return 'forced';
      const q = a.q | 0, f = a.f | 0;
      if (!this.validBid(q, f)) return 'invalid';
      this.bid = { q, f, s: seat };
      this.ev({ t: 'bid', s: seat, q, f });
      this.beginTurn(this.nextAliveAfter(seat), this.isDiceForced());
      return null;
    }
    return 'bad';
  }

  autoAct() {
    const seat = this.turn, s = this.seats[seat];
    if (!s) return;
    if (this.mode === 'card') {
      if (this.forced || s.hand.length === 0) {
        if (this.lastPlay && this.lastPlay.seat !== seat) this.act(seat, { t: 'liar' });
        else this.passTurnCard(seat);
      } else this.act(seat, { t: 'play', i: [0] });
    } else {
      if (this.forced) { this.act(seat, { t: 'liar' }); return; }
      const b = this.bid;
      let q, f;
      if (!b) {
        const counts = [0, 0, 0, 0, 0, 0, 0];
        for (const v of s.dice) counts[v]++;
        f = 2; for (let k = 2; k <= 6; k++) if (counts[k] + counts[1] > counts[f] + counts[1]) f = k;
        q = Math.max(1, counts[f] + counts[1]);
      } else if (b.f < 6) { q = b.q; f = b.f + 1; } else { q = b.q + 1; f = 2; }
      if (!this.validBid(q, f)) { if (b) this.act(seat, { t: 'liar' }); return; }
      this.act(seat, { t: 'bid', q, f });
    }
  }

  penalty() {
    const L = this.seats[this.loser];
    const now = this.now();
    if (!L || !L.alive) { this.afterPenalty(); return; }
    if (this.mode === 'card') {
      // 結果（実弾か空砲か）は引き金を引く瞬間まで誰にも送らない（途中でリロードしても分からない）
      this.pendingFatal = L.shots === L.bullet;
      L.shots++;
      this.ev({ t: 'shot', s: this.loser, n: L.shots });
      this.phase = 'shot'; this.shotStage = 1; this.phaseEnd = now + this.T.shotPull;
    } else {
      const fatal = L.poison >= 1;
      L.poison++;
      if (fatal) { L.alive = false; L.dice = []; }
      this.ev({ t: 'drink', s: this.loser, fatal, n: L.poison });
      this.phase = 'drink'; this.phaseEnd = now + (fatal ? this.T.drinkFatal : this.T.drinkSafe);
    }
    this.touch();
  }

  finish() {
    const alive = this.aliveSeats();
    this.winner = alive.length === 1 ? alive[0] : -1;
    this.phase = 'over'; this.botAt = 0;
    this.ev({ t: 'over', w: this.winner });
  }

  afterPenalty() {
    const alive = this.aliveSeats();
    if (alive.length <= 1) { this.finish(); return; }
    const L = this.seats[this.loser];
    const st = L && L.alive ? this.loser : this.nextAliveAfter(this.loser >= 0 ? this.loser : 0);
    this.newRound(st);
  }

  toLobby() {
    if (this.phase !== 'over' && this.phase !== 'lobby') return;
    for (let i = 0; i < 4; i++) {
      const s = this.seats[i];
      if (s && s.left) this.seats[i] = null;
      else if (s) Object.assign(s, { alive: true, hand: [], dice: [], shots: 0, poison: 0 });
    }
    this.phase = 'lobby'; this.turn = -1; this.lastPlay = null; this.bid = null; this.pile = 0; this.winner = -1;
    this.ev({ t: 'lobby' });
  }

  update() {
    const now = this.now();
    switch (this.phase) {
      case 'deal': case 'roll':
        if (now >= this.phaseEnd) this.beginTurn(this.turn, false);
        break;
      case 'turn':
        if (this.botAt && now >= this.botAt) {
          this.botAt = 0;
          const seat = this.turn;
          let a = null;
          try { a = Bots.decide(this, seat); } catch (e) { a = null; }
          const err = a ? this.act(seat, a) : 'x';
          if (err) this.autoAct();
        } else if (now >= this.phaseEnd) this.autoAct();
        break;
      case 'reveal':
        if (now >= this.phaseEnd) this.penalty();
        break;
      case 'shot':
        if (now < this.phaseEnd) break;
        if (this.shotStage === 1) {
          const L = this.seats[this.loser];
          if (!L || !L.alive) { this.afterPenalty(); break; }
          const fatal = !!this.pendingFatal;
          if (fatal) { L.alive = false; L.hand = []; }
          this.ev({ t: 'fire', s: this.loser, fatal, n: L.shots });
          this.shotStage = 2; this.phaseEnd = now + (fatal ? this.T.shotAfterFatal : this.T.shotAfterBlank);
          this.touch();
        } else this.afterPenalty();
        break;
      case 'drink':
        if (now >= this.phaseEnd) this.afterPenalty();
        break;
    }
  }

  publicState() {
    const now = this.now();
    return {
      v: 1, ph: this.phase, md: this.mode, rn: this.rn, tu: this.turn, fz: this.forced ? 1 : 0,
      dl: Math.max(0, Math.round(this.phaseEnd - now)),
      pl: this.seats.map(s => s && {
        id: s.id, n: s.name, b: s.bot ? 1 : 0, c: s.char, a: s.alive ? 1 : 0, lf: s.left ? 1 : 0,
        hc: s.hand.length, sh: s.shots, ps: s.poison,
      }),
      tc: this.table, pile: this.pile,
      lp: this.lastPlay ? { s: this.lastPlay.seat, n: this.lastPlay.cards.length } : null,
      bid: this.bid, ev: this.events.slice(), w: this.winner, seq: this.seq,
    };
  }

  privateFor(seat) {
    const s = this.seats[seat];
    if (!s) return null;
    return this.mode === 'card' ? { r: this.rn, h: s.hand.slice() } : { r: this.rn, d: s.dice.slice() };
  }
}

// ===================== CPU PLAYERS =====================
export const Bots = {
  decide(eng, seat) {
    const s = eng.seats[seat];
    return eng.mode === 'card' ? this.card(eng, seat, s) : this.dice(eng, seat, s);
  },
  card(eng, seat, s) {
    const r = eng.rng;
    if (eng.forced) return { t: 'liar' };
    const tc = eng.table, lp = eng.lastPlay;
    const good = [], bad = [];
    s.hand.forEach((c, i) => ((c === tc || c === 'J') ? good : bad).push(i));
    if (lp && lp.seat !== seat) {
      const remainingTrue = 8 - good.length;
      let p = 0.14 + 0.13 * (lp.cards.length - 1) + (good.length / 8) * 0.55;
      if (remainingTrue < lp.cards.length) p = 1;
      const prev = eng.seats[lp.seat];
      if (prev && prev.hand.length === 0) p = Math.max(p + 0.2, 0.72);   // 見逃すと相手の「あがり」
      if (good.length === 0) p += 0.12;
      if (s.hand.length === 0) p = 1;
      if (r() < Math.min(0.95, p)) return { t: 'liar' };
    }
    if (s.hand.length === 0) return { t: 'liar' };
    let pick;
    if (good.length && (bad.length === 0 || r() < 0.78)) {
      shuffleArr(good, r);
      const n = Math.min(good.length, 1 + Math.floor(r() * Math.min(MAX_PLAY, good.length)));
      pick = good.slice(0, n);
      if (pick.length < MAX_PLAY && bad.length && r() < 0.14) pick.push(bad[Math.floor(r() * bad.length)]);
    } else {
      const pool = shuffleArr(bad.length ? bad.slice() : good.slice(), r);
      pick = pool.slice(0, Math.min(pool.length, r() < 0.1 ? 3 : r() < 0.3 ? 2 : 1));
    }
    return { t: 'play', i: pick };
  },
  dice(eng, seat, s) {
    const r = eng.rng;
    if (eng.forced) return { t: 'liar' };
    const total = eng.totalDice();
    const others = total - s.dice.length;
    const mine = f => s.dice.filter(v => v === f || (f !== 1 && v === 1)).length;
    const exp = f => mine(f) + others * (f === 1 ? 1 / 6 : 1 / 3);
    const b = eng.bid;
    if (b && b.s !== seat) {
      const diff = b.q - exp(b.f);
      const p = diff <= 0 ? 0.02 : Math.min(0.95, 0.12 + diff * 0.3);
      if (r() < p) return { t: 'liar' };
    }
    let best = null;
    for (let f = 1; f <= 6; f++) {
      let q;
      if (!b) q = Math.max(1, Math.floor(exp(f) - 0.4 - r() * 1.2));
      else q = f > b.f ? b.q : b.q + 1;
      if (q > total) continue;
      const score = exp(f) - q + (r() - 0.5) * 0.9 - (f === 1 ? 0.4 : 0);
      if (!best || score > best.score) best = { q, f, score };
    }
    if (!best) return { t: 'liar' };
    if (b && best.score < -1.3 && r() < 0.75) return { t: 'liar' };
    return { t: 'bid', q: best.q, f: best.f };
  },
};

