// エンジンの自動テスト: node test/engine.test.mjs （または npm test）
import { Engine, isNeko } from '../js/engine.js';

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('NG:', m); } };
const stats = { card: { games: 0, rounds: 0, deaths: 0, forced: 0, agari: 0 }, dice: { games: 0, rounds: 0, deaths: 0 } };

for (let g = 0; g < 300; g++) {
  const mode = g % 2 ? 'dice' : 'card';
  let t = 0;
  const e = new Engine({ rng: seeded(g + 1), now: () => t });
  const n = 2 + (g % 3);
  for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'P' + i, true);
  e.setMode(mode);
  ok(e.start(), 'start');
  let steps = 0, seen = 0;
  const leaveAt = g % 7 === 0 ? 40 : -1;
  while (e.phase !== 'over') {
    t += 100; e.update(); steps++;
    if (steps === leaveAt) e.removePlayer('p1');
    if (steps > 200000) { ok(false, 'game did not finish'); break; }
    if (e.phase === 'turn') {
      const s = e.seats[e.turn];
      ok(s && s.alive, 'turn on dead seat');
      if (mode === 'card') {
        ok(!(e.forced && (!e.lastPlay || e.lastPlay.seat === e.turn)), 'bad forced state');
        ok(e.forced || s.hand.length > 0, 'empty-handed turn');
      }
    }
    for (const ev of e.events) {
      if (ev.i <= seen) continue; seen = ev.i;
      if (ev.t === 'round' || ev.t === 'roll') stats[mode].rounds++;
      if ((ev.t === 'fire' || ev.t === 'drink') && ev.fatal) stats[mode].deaths++;
      if (ev.t === 'shot') ok(!('fatal' in ev), 'no early result');
      if (ev.t === 'liar' && ev.fz) stats.card.forced++;
      if (ev.t === 'agari') stats.card.agari++;
      if (ev.t === 'dliar') {
        let c = 0; for (const d of ev.dice) if (d) for (const v of d) if (v === ev.f) c++;
        ok(c === ev.cnt, 'dice count');
      }
    }
    ok(JSON.stringify(e.publicState()).length < 3000, 'state size');
  }
  stats[mode].games++;
  e.toLobby(); ok(e.phase === 'lobby', 'toLobby');
}
// 個別ルール
const e = new Engine({ now: () => 0 });
e.addPlayer('a', 'a'); e.addPlayer('b', 'b'); e.setMode('dice'); e.start(); e.beginTurn(e.turn);
const t0 = e.turn;
ok(e.act(t0, { t: 'bid', q: 3, f: 4 }) === null, 'bid');
const t1 = e.turn;
ok(e.act(t1, { t: 'bid', q: 3, f: 3 }) === 'invalid', 'lower bid rejected');
ok(e.act(t1, { t: 'bid', q: 3, f: 5 }) === null, 'same count higher face');
ok(e.act(t1, { t: 'bid', q: 5, f: 5 }) === 'turn', 'wrong turn rejected');
// 席替え: 開始ごとに席がランダム（キャラクターは本人についていく）
{
  const e = new Engine({ rng: seeded(3), now: () => 0 });
  ['a', 'b', 'c'].forEach(n => e.addPlayer(n, n));
  const seen = new Set();
  for (let k = 0; k < 12; k++) {
    e.start(); ok(e.seats.filter(Boolean).length === 3, 'players kept');
    seen.add(e.seats.map(s => s ? s.id : '-').join(''));
    const a = e.seats.find(s => s && s.id === 'a'); ok(a.char === 0, 'character follows player');
    e.phase = 'over'; e.toLobby();
  }
  ok(seen.size > 3, 'seating varies between games');
  // 回転だけの並び（一人称では同じに見える）を含め、前回と同じ並びは出ない
  for (const n of [2, 3, 4]) {
    const f = new Engine({ rng: seeded(10 + n), now: () => 0 });
    for (let i = 0; i < n; i++) f.addPlayer('p' + i, 'p' + i);
    let prevRel = null;
    for (let k = 0; k < 200; k++) {
      f.start();
      const ids = f.seats.map(x => (x ? x.id : '-')); const a = ids.indexOf('p0');
      const rel = ids.slice(a).concat(ids.slice(0, a)).join('|');
      ok(rel !== prevRel, 'relative seating changes every game (' + n + ' players)');
      prevRel = rel; f.phase = 'over'; f.toLobby();
    }
  }
}
// あがり: 手札を出し切った後、次の人が告発せずに出したら勝ち
{
  const a = new Engine({ rng: seeded(7), now: () => 0 });
  a.addPlayer('x', 'x'); a.addPlayer('y', 'y'); a.addPlayer('z', 'z'); a.start();
  const x = a.seatOf('x'), nx = a.nextAliveAfter(x);
  a.beginTurn(x); a.seats[x].hand = ['K']; a.table = 'Q';
  ok(a.act(x, { t: 'play', i: [0] }) === null, 'play last card');
  ok(a.seats[x].hand.length === 0 && a.phase === 'turn' && a.turn === nx, 'turn passes to next');
  ok(a.act(nx, { t: 'play', i: [0] }) === null, 'next plays instead of calling');
  ok(a.phase === 'over' && a.winner === x, 'agari wins');
  ok(a.events.some(e => e.t === 'agari' && e.s === x && e.lie === true), 'agari event records the (lying) cards');
  // 告発された場合は通常判定（あがりにならない）
  const b = new Engine({ rng: seeded(8), now: () => 0 });
  b.addPlayer('x', 'x'); b.addPlayer('y', 'y'); b.start();
  const bx = b.seatOf('x'), by = b.seatOf('y');
  b.beginTurn(bx); b.seats[bx].hand = ['Q']; b.table = 'Q';
  b.act(bx, { t: 'play', i: [0] });
  ok(b.act(by, { t: 'liar' }) === null && b.phase === 'reveal' && b.loser === by, 'called liar on true last card → caller loses, no agari');
}
// 1回に5枚まで出せる（6枚目以降はない）
{
  const e = new Engine({ rng: seeded(21), now: () => 0 });
  e.addPlayer('x', 'x'); e.addPlayer('y', 'y'); e.start();
  const x = e.seatOf('x'); e.beginTurn(x);
  ok(e.act(x, { t: 'play', i: [0, 1, 2, 3, 4] }) === null, 'play 5 cards at once');
  ok(e.lastPlay.cards.length === 5 && e.seats[x].hand.length === 0, '5 cards on the table');
  const y = e.seatOf('y');
  ok(e.act(y, { t: 'play', i: [0, 1, 2, 3, 4, 5] }) === 'count' || e.phase === 'over', 'more than 5 rejected (or agari already)');
}
// リボルバー: 6回以内に必ず死亡
for (let k = 0; k < 50; k++) {
  const r = new Engine({ rng: seeded(k + 99), now: () => 0 });
  r.addPlayer('a', 'a'); r.addPlayer('b', 'b'); r.start();
  const si = r.seatOf('a'), s = r.seats[si]; let shots = 0;
  while (s.alive && shots < 7) { r.loser = si; r.phase = 'reveal'; r.penalty(); ok(r.events.slice(-1)[0].fatal === undefined, 'shot event hides result'); r.phaseEnd = 0; r.update(); shots++; r.phase = 'turn'; }
  ok(!s.alive && shots <= 6, 'revolver kills within 6 pulls');
}
// ダイス: 1はワイルドではない（宣言した目だけを数える）
{
  const mk = (bid, dice) => { const e = new Engine({ rng: seeded(3), now: () => 0 }); e.setMode('dice'); e.addPlayer('a', 'a'); e.addPlayer('b', 'b'); e.start();
    const a = e.seatOf('a'), b = e.seatOf('b'); e.seats[a].dice = dice[0]; e.seats[b].dice = dice[1]; e.bid = { q: bid.q, f: bid.f, s: a }; e.beginTurn(b); e.act(b, { t: 'liar' }); return e.events.slice(-1)[0]; };
  let ev = mk({ q: 5, f: 2 }, [[2, 2, 1, 1, 3], [2, 1, 1, 4, 5]]);
  ok(ev.cnt === 3 && ev.lie, '2×5: only 2s counted (3) → lie');
  ev = mk({ q: 4, f: 6 }, [[6, 6, 1, 1, 3], [6, 6, 1, 4, 5]]);
  ok(ev.cnt === 4 && !ev.lie, '6×4: only 6s counted (4) → true');
  ev = mk({ q: 4, f: 6 }, [[6, 1, 1, 1, 3], [6, 6, 1, 4, 5]]);
  ok(ev.cnt === 3 && ev.lie, '6×4 with many 1s: still 3 → lie');
  ev = mk({ q: 3, f: 1 }, [[1, 1, 2, 2, 3], [1, 4, 4, 5, 6]]);
  ok(ev.cnt === 3 && !ev.lie, '1×3: 1s counted as their own face');
}
// 隠しコマンド nekojita: その人の個人データにだけ追加情報が入る
{
  ok(isNeko('nekojita') && isNeko(' NekoJita ') && isNeko('ｎｅｋｏｊｉｔａ') && !isNeko('nekojita2') && !isNeko('neko'), 'isNeko name check');
  const e = new Engine({ rng: seeded(5), now: () => 0 });
  e.addPlayer('n', 'nekojita'); e.addPlayer('o', 'other'); e.addBot(['CPU']); e.start();
  const n = e.seatOf('n'), o = e.seatOf('o');
  ok(e.privateFor(n).x && Array.isArray(e.privateFor(n).x.pl) && e.privateFor(n).x.pl.length === 0, 'neko gets empty play log');
  ok(!e.privateFor(o).x, 'others get no cheat data');
  const first = e.turn; e.beginTurn(first);
  const cards = e.seats[first].hand.slice(0, 2);
  e.act(first, { t: 'play', i: [0, 1] });
  const x = e.privateFor(n).x;
  ok(x.pl.length === 1 && x.pl[0].s === first && x.pl[0].c.join() === cards.join(), 'neko sees played cards');
  ok(!JSON.stringify(e.publicState()).includes('"pl":[{"s"'), 'public state has no play log');
  const d = new Engine({ rng: seeded(6), now: () => 0 }); d.setMode('dice');
  d.addPlayer('n', 'nekojita'); d.addPlayer('o', 'other'); d.addBot(['CPU']); d.start();
  const dx = d.privateFor(d.seatOf('n')).x;
  ok(dx && dx.dd.filter(Boolean).length === 3 && dx.dd.every(v => !v || v.length === 5), 'neko sees all dice');
  ok(!d.privateFor(d.seatOf('o')).x, 'other player gets no dice of others');
}
// 死亡して観戦中の人だけ、生きている全員の手札／ダイスを受け取る
{
  const e = new Engine({ rng: seeded(9), now: () => 0 });
  e.addPlayer('a', 'a'); e.addPlayer('b', 'b'); e.addPlayer('c', 'c'); e.start();
  const a = e.seatOf('a'), b = e.seatOf('b'), c = e.seatOf('c');
  ok(!e.privateFor(a).x && !e.privateFor(b).x, 'alive players get no extra data');
  e.seats[a].alive = false; e.seats[a].hand = [];
  const x = e.privateFor(a).x;
  ok(x && x.dead && x.hs[b].join() === e.seats[b].hand.join() && x.hs[c].join() === e.seats[c].hand.join() && x.hs[a] === null, 'dead player sees all living hands');
  ok(!e.privateFor(b).x, 'living player still sees nothing extra');
  ok(!JSON.stringify(e.publicState()).includes('"hs"'), 'public state has no hands');
  const d = new Engine({ rng: seeded(10), now: () => 0 }); d.setMode('dice');
  d.addPlayer('a', 'a'); d.addPlayer('b', 'b'); d.addPlayer('c', 'c'); d.start();
  const da = d.seatOf('a'); d.seats[da].alive = false;
  const dx = d.privateFor(da).x;
  ok(dx && dx.dead && dx.dd.filter(Boolean).length === 2 && dx.dd[da] === null, 'dead player sees all living dice');
  ok(!d.privateFor(d.seatOf('b')).x, 'living dice player sees nothing extra');
}
console.log(JSON.stringify(stats));
if (fail) { console.error(fail + ' failures'); process.exit(1); }
console.log('すべてのテストに合格しました');
