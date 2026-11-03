// アプリ本体: 画面遷移、ロビー、通信、HUD
import { $, $$, esc, clamp, randId, lsGet, lsSet, cleanName, dieHTML, cardHTML, CARD_LABEL, CARD_JP, BOT_NAMES } from './util.js';
import { Engine, isNeko } from './engine.js';
import { Sec } from './crypto.js';
import { getRoomCapability, RoomNet } from './net-room.js';
import { loadPeerJS, PeerNet, p2pSupported } from './net-peer.js';
import { Snd } from './audio.js';
import { World } from './world.js';
import { RULES_TABS, QUICK } from './rules.js';

export const App = {
  role: null, net: null, room: null, engine: null, world: null,
  myId: 'local', mySeat: -1, st: null, priv: null, lastEv: null, stRecv: 0,
  neck: { len: 0, dir: 0 }, neckOK: false, cheat: false, neckShow: false,   // 隠しコマンド nekojita
  hostPeer: null, hostPk: null, lastPvStr: '', actSeq: 0, processed: {}, missing: {},
  pubVer: 0, lastPub: 0, sealCache: {}, lobbyId: '', mode: 'card',
  bidQ: 1, bidF: 2, lastHd: '', hdT: 0, bubbles: {}, botLook: {}, hostMissingSince: 0,
  name: 'Player', transport: null, qualityPref: 'auto', hints: true, fpsLow: 0,

  async init() {
    this.world = new World($('#c'));
    this.world.onSelect = () => this.updateActions();
    this.world.onDiceReveal = (o) => {
      const R = this.revealInfo && this.revealInfo.ev === o.ev ? this.revealInfo : (this.revealInfo = { ev: o.ev, rows: {}, order: [], total: 0 });
      if (o.type === 'start') R.order = o.order;
      else if (o.type === 'open') R.rows[o.seat] = { dice: o.dice, hl: [], cnt: 0 };
      else if (o.type === 'count') { const r = R.rows[o.seat]; if (r) { r.cnt = o.hits; if (o.k >= 0) r.hl.push(o.k); r.done = o.k < 0; } R.total = o.total; R.cur = o.seat; this.bubble(o.seat, o.hits ? `+${o.hits}個` : '0個', 6000); }
      else if (o.type === 'final') { R.final = true; R.cur = -1; }
      else if (o.type === 'done') R.done = true;
      this.renderBid();
    };
    this.bindUI();
    this.name = lsGet('lt_name', '') || ('Player' + Math.floor(Math.random() * 90 + 10));
    $('#nameIn').value = this.name;
    $('#cId').value = randId(6);
    // empty table in the background
    this.world.resetTable('card');
    this.world.look.yaw = 0; this.world.look.pitch = -0.2;
    this.world.mySeat = 0;
    setInterval(() => { try { this.logic(); } catch (e) { console.error(e); } }, 80);
    let last = performance.now();
    const loop = (t) => {
      const rawDt = Math.max(0, (t - last) / 1000), dt = Math.min(0.25, rawDt); last = Math.max(last, t);
      this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05 : 30;
      try { this.tick(dt, rawDt); this.autoQuality(dt); } catch (e) { console.error(e); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    Sec.init();
    this.buildRules();
    this.qualityPref = lsGet('lt_quality', 'auto');
    this.hints = lsGet('lt_hints', '1') === '1';
    this.applyQualityPref();
    this.room = await getRoomCapability(window.claude ? 4000 : 1500);
    const ns = $('#netstat');
    if (this.room) { this.transport = 'room'; ns.textContent = '● オンライン対戦: 利用可能（claude.ai ルーム）'; ns.className = 'ok'; }
    else if (window.claude) {
      // claude.ai 上だが room が使えない（公開リンクやサインインしていない等）
      ns.innerHTML = 'オンライン対戦は、claude.ai にサインインし、このページの共有（招待）を受けた人どうしで使えます（CPU練習は可能）。';
      $('#goCreate').disabled = true; $('#goJoin').disabled = true;
    } else if (p2pSupported()) {
      this.transport = 'p2p'; ns.textContent = '● オンライン対戦: 利用可能（P2P）'; ns.className = 'ok';
      loadPeerJS().catch(() => { ns.textContent = 'P2Pライブラリを読み込めませんでした（CPU練習は可能）'; ns.className = ''; });
    } else {
      ns.innerHTML = 'このブラウザではオンライン対戦が使えません（CPU練習は可能）。';
      $('#goCreate').disabled = true; $('#goJoin').disabled = true;
    }
  },
  async makeNet() {
    if (this.transport === 'room') return new RoomNet(this.room);
    const Peer = await loadPeerJS();
    if (!Peer) throw { code: 'unsupported' };
    return new PeerNet(Peer);
  },
  errText(e) {
    const c = e && e.code;
    if (c === 'inuse') return 'このロビーIDとパスワードは既に使用中です。別のIDにしてください';
    if (c === 'notfound') return 'ロビーが見つからないか、パスワードが違います';
    if (c === 'unsupported') return 'このブラウザではオンライン対戦が使えません';
    if (c === 'network') return '接続に失敗しました（ネットワークを確認してください）';
    return '接続に失敗しました: ' + ((e && (e.code || e.message)) || e);
  },
  // ---- 画質 ----
  applyQualityPref() {
    const q = this.qualityPref === 'auto' ? 'high' : this.qualityPref;
    this.world.setQuality(q);
    const label = { auto: '自動', high: '高', medium: '中', low: '低' }[this.qualityPref];
    $('#mQuality').textContent = '🖥 画質: ' + label;
  },
  autoQuality(dt) {
    if (this.qualityPref !== 'auto' || !this.fps) return;
    if (this.fps < 28) this.fpsLow += dt; else this.fpsLow = Math.max(0, this.fpsLow - dt * 0.5);
    if (this.fpsLow > 4) {
      this.fpsLow = 0;
      const next = this.world.quality === 'high' ? 'medium' : this.world.quality === 'medium' ? 'low' : null;
      if (next) { this.world.setQuality(next); this.toast(`動作を軽くするため画質を「${next === 'medium' ? '中' : '低'}」にしました`); }
    }
  },
  // ---- ルール画面 ----
  buildRules() {
    const tabs = $('#rulesTabs'), body = $('#rulesBody');
    tabs.innerHTML = ''; body.innerHTML = '';
    RULES_TABS.forEach((t, i) => {
      const b = document.createElement('button'); b.textContent = t.label; b.dataset.tab = t.id; if (!i) b.classList.add('on');
      b.onclick = () => this.rulesTab(t.id);
      tabs.appendChild(b);
      const sec = document.createElement('section'); sec.dataset.tab = t.id; sec.innerHTML = t.html; if (i) sec.classList.add('hidden');
      body.appendChild(sec);
    });
  },
  rulesTab(id) {
    $$('#rulesTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    $$('#rulesBody section').forEach(s => s.classList.toggle('hidden', s.dataset.tab !== id));
    $('#rulesBody').scrollTop = 0;
  },
  openRules(tab, back) {
    this.rulesBack = back;
    this.renderCheatBox();
    if (tab) this.rulesTab(tab);
    $('#rulesScr').classList.remove('hidden');
    if (back === 'title') $('#title').classList.add('hidden');
  },
  // ---- 隠しコマンド nekojita ----
  isNekoMe() {
    const me = this.st && this.mySeat >= 0 ? this.st.pl[this.mySeat] : null;
    return isNeko(me ? me.n : (cleanName($('#nameIn').value) || this.name));
  },
  // 「？」→「操作」タブのいちばん下に、nekojita だけ ON/OFF を出す（首のばしの表示／チート）
  renderCheatBox() {
    const sec = document.querySelector('#rulesBody section[data-tab="ctrl"]');
    if (!sec) return;
    let box = sec.querySelector('.cheatBox');
    if (!box) { box = document.createElement('div'); box.className = 'cheatBox'; sec.appendChild(box); }
    const row = (k, label, on) => `<div class="ckRow"><span>${label}</span><div class="seg ckSeg" data-k="${k}"><button data-v="0" class="${on ? '' : 'on'}">OFF</button><button data-v="1" class="${on ? 'on' : ''}">ON</button></div></div>`;
    box.innerHTML = row('neck', '首のばし', this.neckShow) + (this.isNekoMe() ? row('cheat', 'チート', this.cheat) : '');   // 首のばしは全員、チートは nekojita だけ
    box.querySelectorAll('.ckSeg button').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.v === '1', k = b.parentElement.dataset.k;
        if (k === 'neck') { this.neckShow = v; if (!v) this.resetNeck(); }
        else this.cheat = v;
        Snd.click(); this.renderCheatBox(); this.updateHUD();
      };
    });
  },
  setupNeckUI() {
    const drag = (el, fn) => {
      let id = null;
      const at = e => { const r = el.getBoundingClientRect(); fn(e.clientX - r.left, e.clientY - r.top, r); };
      el.addEventListener('pointerdown', e => { id = e.pointerId; try { el.setPointerCapture(id); } catch (er) { /* */ } at(e); e.preventDefault(); e.stopPropagation(); });
      el.addEventListener('pointermove', e => { if (e.pointerId === id) { at(e); e.preventDefault(); } });
      const end = e => { if (e.pointerId === id) id = null; };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    };
    drag($('#ngLen'), (x, y, r) => { this.neck.len = clamp(1 - (y - 12) / (r.height - 24), 0, 1); this.renderNeckUI(); });
    drag($('#ngDir'), (x, y, r) => { let d = clamp((x - 12) / (r.width - 24) * 2 - 1, -1, 1); if (Math.abs(d) < 0.08) d = 0; this.neck.dir = d; this.renderNeckUI(); });
    $('#ngReset').onclick = () => { this.neck.len = 0; this.neck.dir = 0; this.renderNeckUI(); Snd.click(); };
    this.renderNeckUI();
  },
  renderNeckUI() {
    $('#ngLen').style.setProperty('--v', this.neck.len.toFixed(3));
    $('#ngLenVal').textContent = Math.round(this.neck.len * 100);
    $('#ngDir').style.setProperty('--v', ((this.neck.dir + 1) / 2).toFixed(3));
  },
  resetNeck() { this.neck.len = 0; this.neck.dir = 0; this.renderNeckUI(); },
  // チート（カード）: 場に出されたカードの中身を、山の上に表示
  renderCheat(st, inGame) {
    const el = $('#cheatPile'), x = this.priv && this.priv.x;
    const on = this.cheat && inGame && st.md === 'card' && this.isNekoMe() && x && Array.isArray(x.pl);
    el.classList.toggle('hidden', !on);
    if (!on) return;
    const rows = x.pl.slice(-4).map((p, k, arr) => {
      const last = k === arr.length - 1, nm = st.pl[p.s] ? st.pl[p.s].n : '?';
      const cards = (p.c || []).map(c => cardHTML(c, c !== st.tc && c !== 'J' ? 'lie' : '')).join('');
      return `<div class="cr${last ? ' last' : ''}"><span class="cn">${last ? '直前 ' : ''}${esc(nm)}</span><span class="cc">${cards}</span></div>`;
    }).join('');
    const html = `<div class="ch">🐱 場のカード${x.pl.length > 4 ? `（最新4回／全${x.pl.length}回）` : ''}</div>${rows || '<div class="cr none">まだ出ていません</div>'}`;
    if (html !== this._cheatHtml) { el.innerHTML = html; this._cheatHtml = html; }
  },
  placeCheat() {
    const el = $('#cheatPile');
    if (el.classList.contains('hidden')) return;
    const p = this.world.screenOf(0, 0.84, 0), w = innerWidth, h = innerHeight;
    const ew = el.offsetWidth || 180, eh = el.offsetHeight || 80;
    const dock = this._dock || 160;
    let x = p.behind ? w / 2 : p.x, y = p.behind ? h * 0.45 : p.y - 14;
    x = clamp(x, ew / 2 + 8, w - ew / 2 - 8); y = clamp(y, 70 + eh, h - dock - 8);
    el.style.transform = `translate(${(x - ew / 2).toFixed(0)}px, ${(y - eh).toFixed(0)}px)`;
  },
  // ---- クイックガイド ----
  showQuick(mode, force) {
    const key = 'lt_quick_' + mode;
    if (!force && lsGet(key, '') === '1') return;
    const steps = QUICK[mode];
    let i = 0;
    const box = $('#quick');
    const draw = () => {
      $('#quickStep').textContent = `${i + 1} / ${steps.length}`;
      $('#quickTitle').textContent = (mode === 'card' ? 'カード' : 'ダイス') + '：' + steps[i].t;
      $('#quickBody').textContent = steps[i].b;
      $('#quickNext').textContent = i < steps.length - 1 ? '次へ' : 'わかった';
    };
    $('#quickNext').onclick = () => { Snd.click(); if (i < steps.length - 1) { i++; draw(); } else { box.classList.add('hidden'); lsSet(key, '1'); } };
    $('#quickSkip').onclick = () => { box.classList.add('hidden'); lsSet(key, '1'); };
    $('#quickRules').onclick = () => { box.classList.add('hidden'); lsSet(key, '1'); this.openRules(mode, 'game'); };
    draw();
    box.classList.remove('hidden');
  },

  // ---------------- UI ----------------
  show(id) {
    for (const s of ['title', 'createScr', 'joinScr']) $('#' + s).classList.toggle('hidden', s !== id);
  },
  toast(msg, ms = 3200) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), ms);
  },
  feed(msg) {
    const f = $('#feed'), d = document.createElement('div');
    d.textContent = msg; f.appendChild(d);
    while (f.children.length > 3) f.removeChild(f.firstChild);
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 5000);
  },
  bindUI() {
    const unlock = () => Snd.init();
    for (const evn of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(evn, unlock, { capture: true });
    const saveName = () => { const v = cleanName($('#nameIn').value); if (v) { this.name = v; lsSet('lt_name', v); } };
    $('#nameIn').addEventListener('change', saveName);
    $('#goCreate').onclick = () => { saveName(); Snd.click(); this.show('createScr'); };
    $('#goJoin').onclick = () => { saveName(); Snd.click(); this.show('joinScr'); };
    $('#goSolo').onclick = () => { saveName(); Snd.click(); this.startOffline(); };
    $('#goRules').onclick = () => { Snd.click(); this.openRules('basic', 'title'); };
    $('#rulesClose').onclick = () => { $('#rulesScr').classList.add('hidden'); if (this.rulesBack === 'title') this.show('title'); };
    $('#lobbyRules').onclick = () => { Snd.click(); this.openRules(this.st ? this.st.md : 'card', 'game'); };
    $('#lobbyQuick').onclick = () => { Snd.click(); this.showQuick(this.st ? this.st.md : 'card', true); };
    $('#helpBtn').onclick = () => { Snd.click(); this.openRules(this.st && this.st.ph !== 'lobby' ? this.st.md : 'basic', 'game'); };
    this.setupNeckUI();
    $$('.back').forEach(b => b.onclick = () => this.show('title'));
    $$('#cMode button').forEach(b => b.onclick = () => { $$('#cMode button').forEach(x => x.classList.toggle('on', x === b)); this.mode = b.dataset.m; });
    $$('#lMode button').forEach(b => b.onclick = () => { if (this.engine && this.role !== 'guest') { this.engine.setMode(b.dataset.m); Snd.click(); } });
    $('#doCreate').onclick = () => this.createLobby();
    $('#doJoin').onclick = () => this.joinLobby();
    $('#addBot').onclick = () => { if (this.engine) { this.engine.addBot(BOT_NAMES); Snd.click(); } };
    $('#rmBot').onclick = () => { if (this.engine) { this.engine.removeBot(); Snd.click(); } };
    $('#startBtn').onclick = () => { if (this.engine && this.engine.start()) Snd.click(); };
    $('#leaveBtn').onclick = () => this.leave();
    $('#overLeave').onclick = () => this.leave();
    $('#againBtn').onclick = () => { if (this.engine) this.engine.toLobby(); };
    $('#copyId').onclick = () => {
      const txt = this.lobbyId;
      try { navigator.clipboard.writeText(txt).then(() => this.toast('ロビーIDをコピーしました'), () => this.toast('コピーできませんでした')); } catch (e) { this.toast('コピーできませんでした'); }
    };
    $('#menuBtn').onclick = () => $('#menu').classList.toggle('hidden');
    $('#mSound').onclick = () => { Snd.setMuted(!Snd.muted); $('#mSound').textContent = Snd.muted ? '🔇 サウンド: OFF' : '🔊 サウンド: ON'; };
    $('#mRules').onclick = () => { $('#menu').classList.add('hidden'); this.openRules(this.st && this.st.ph !== 'lobby' ? this.st.md : 'basic', 'game'); };
    $('#mQuality').onclick = () => {
      const order = ['auto', 'high', 'medium', 'low'];
      this.qualityPref = order[(order.indexOf(this.qualityPref) + 1) % order.length];
      lsSet('lt_quality', this.qualityPref); this.applyQualityPref();
    };
    $('#mHints').onclick = () => { this.hints = !this.hints; lsSet('lt_hints', this.hints ? '1' : '0'); $('#mHints').textContent = '💡 ヒント: ' + (this.hints ? 'ON' : 'OFF'); this.updateActions(); };
    $('#mHints').textContent = '💡 ヒント: ' + (this.hints ? 'ON' : 'OFF');
    $('#mLeave').onclick = () => { $('#menu').classList.add('hidden'); this.leave(); };
    // actions
    $('#playBtn').onclick = () => {
      const sel = [...this.world.selected].sort((a, b) => a - b);
      if (sel.length < 1 || sel.length > 5) return;
      this.world.lastPlayed = sel;
      this.act({ t: 'play', i: sel });
    };
    $('#liarBtn').onclick = () => this.act({ t: 'liar' });
    $('#dLiarBtn').onclick = () => this.act({ t: 'liar' });
    $('#bidBtn').onclick = () => this.act({ t: 'bid', q: this.bidQ, f: this.bidF });
    $('#qMinus').onclick = () => { this.bidQ = Math.max(1, this.bidQ - 1); Snd.click(); this.updateActions(); };
    $('#qPlus').onclick = () => { this.bidQ = Math.min(this.totalDice(), this.bidQ + 1); Snd.click(); this.updateActions(); };
    const fc = $('#faces');
    for (let f = 1; f <= 6; f++) {
      const b = document.createElement('button'); b.innerHTML = dieHTML(f); b.dataset.f = f;
      b.onclick = () => {
        this.bidF = f; Snd.click();
        // その目が今の個数で出せないときは、出せる最小の個数まで自動で上げる（個数を増やせばどの目でもOK）
        const bid = this.st && this.st.bid;
        if (bid && !this.validBid(this.bidQ, f)) this.bidQ = Math.min(this.totalDice(), f > bid.f ? Math.max(this.bidQ, bid.q) : Math.max(this.bidQ, bid.q + 1));
        this.updateActions();
      };
      fc.appendChild(b);
    }
  },

  // ---------------- session setup ----------------
  async lobbyKey(id, pw) {
    const h = await Sec.hash('liars-table|v1|' + id.trim().toUpperCase() + '|' + pw);
    return h.slice(0, 40);
  },
  resetSession() {
    this.st = null; this.priv = null; this.lastEv = null; this.mySeat = -1; this.hostPeer = null; this.hostPk = null; this.lastPvStr = '';
    this.processed = {}; this.missing = {}; this.sealCache = {}; this.engine = null; this.bubbles = {};
    this.hostMissingSince = 0;
  },
  async createLobby() {
    const id = $('#cId').value.trim().toUpperCase(), pw = $('#cPw').value;
    const err = $('#cErr'); err.textContent = '';
    if (!/^[A-Z0-9_-]{3,16}$/.test(id)) { err.textContent = 'ロビーIDは英数字3〜16文字にしてください'; return; }
    if (!pw) { err.textContent = 'パスワードを入力してください'; return; }
    if (!this.transport) { err.textContent = 'オンライン機能が使えません'; return; }
    $('#doCreate').disabled = true; err.textContent = '接続中…';
    try {
      this.resetSession();
      const net = await this.makeNet();
      net.set({ v: 1, nm: this.name, pk: Sec.pub || null });
      await net.enter(await this.lobbyKey(id, pw), 'host');
      this.net = net; this.role = 'host'; this.myId = net.me; this.lobbyId = id;
      this.engine = new Engine({ evStart: Math.floor(Math.random() * 1e6) });
      this.engine.setMode(this.mode);
      this.engine.addPlayer(this.myId, this.name);
      net.set({ v: 1, nm: this.name, role: 'host', pk: Sec.pub || null }, true);
      net.onLost = () => { this.toast('接続が切れました'); this.leave(true); };
      err.textContent = '';
      this.enterLobbyUI();
    } catch (e) {
      console.warn(e); err.textContent = this.errText(e);
    } finally { $('#doCreate').disabled = false; }
  },
  async joinLobby() {
    const id = $('#jId').value.trim().toUpperCase(), pw = $('#jPw').value;
    const err = $('#jErr'); err.textContent = '';
    if (!id || !pw) { err.textContent = 'ロビーIDとパスワードを入力してください'; return; }
    if (!this.transport) { err.textContent = 'オンライン機能が使えません'; return; }
    $('#doJoin').disabled = true; err.textContent = 'ロビーを探しています…';
    try {
      this.resetSession();
      const net = await this.makeNet();
      net.set({ v: 1, nm: this.name, role: 'guest', pk: Sec.pub || null });
      await net.enter(await this.lobbyKey(id, pw), 'guest');
      net.set({ v: 1, nm: this.name, role: 'guest', pk: Sec.pub || null }, true);
      let host = null;
      for (let i = 0; i < 60 && !host; i++) {
        host = net.peers().find(p => !p.sameTab && p.presence && p.presence.role === 'host');
        if (!host) await new Promise(r => setTimeout(r, 100));
      }
      if (!host) { await net.leave(); throw { code: 'notfound' }; }
      this.net = net; this.role = 'guest'; this.myId = net.me; this.lobbyId = id;
      this.hostPeer = host.peer;
      net.onLost = () => { this.toast('接続が切れました'); this.leave(true); };
      err.textContent = '';
      this.enterLobbyUI();
    } catch (e) {
      console.warn(e); err.textContent = this.errText(e);
    } finally { $('#doJoin').disabled = false; }
  },
  startOffline() {
    this.resetSession();
    this.role = 'offline'; this.net = null; this.myId = 'local'; this.lobbyId = '';
    this.engine = new Engine();
    this.engine.setMode(this.mode);
    this.engine.addPlayer(this.myId, this.name);
    this.engine.addBot(BOT_NAMES); this.engine.addBot(BOT_NAMES); this.engine.addBot(BOT_NAMES);
    this.enterLobbyUI();
  },
  enterLobbyUI() {
    this.show(null);
    $('#lobbyScr').classList.remove('hidden');
    $('#hud').classList.remove('hidden');
    $('#overScr').classList.add('hidden');
    this.world.resetTable(this.engine ? this.engine.mode : 'card');
    this.world.look.yaw = 0; this.world.look.pitch = this.world.defaultPitch();
    setTimeout(() => { if (this.st && this.st.ph === 'lobby') this.showQuick(this.st.md); }, 700);
  },
  async leave(silent) {
    const net = this.net;
    this.net = null; this.role = null;
    if (net) await net.leave();
    this.resetSession();
    this.world.resetTable('card');
    this.world.setPlayers({ pl: [null, null, null, null] }, 0);
    this.world.setHand([], '');
    this.world.canSelect = false;
    $('#lobbyScr').classList.add('hidden'); $('#overScr').classList.add('hidden'); $('#hud').classList.add('hidden');
    $('#rulesScr').classList.add('hidden'); $('#menu').classList.add('hidden'); $('#quick').classList.add('hidden');
    $('#bidBanner').classList.add('hidden'); $('#hud').classList.remove('withBid'); this.revealInfo = null;
    $$('.plabel').forEach(l => l.remove()); this.world.seats.forEach(s => s.label = null);
    this.show('title');
  },

  // ---------------- actions ----------------
  act(a) {
    Snd.click();
    if (this.role === 'guest') {
      this.actSeq++;
      this.net.set({ act: Object.assign({ s: this.actSeq, r: this.st ? this.st.rn : 0 }, a) }, true);
      this.actPending = performance.now();
      this.updateActions();
    } else if (this.engine) {
      const err = this.engine.act(this.mySeat, a);
      if (err) console.warn('act rejected', err);
    }
    if (a.t === 'play' || a.t === 'liar') this.world.canSelect = false;
  },
  totalDice() { return this.st ? this.st.pl.filter(p => p && p.a).length * 5 : 20; },

  // ---------------- per-frame ----------------
  logic() {
    const now = performance.now();
    if ((this.role === 'host' || this.role === 'offline') && this.engine) {
      if (this.role === 'host' && this.net) this.hostPeers(now);
      this.engine.update();
      if (this.engine.dirty || (this.role === 'host' && now - this.lastPub > 1500)) this.publish();
    } else if (this.role === 'guest' && this.net) this.guestPoll(now);
    // heads
    if (this.net && now - this.hdT > 90) {
      this.hdT = now;
      const hd = [Math.round(this.world.look.yaw * 100) / 100, Math.round(this.world.look.pitch * 100) / 100];
      const nk = this.neckOK ? [Math.round(this.neck.len * 100) / 100, Math.round(this.neck.dir * 100) / 100] : [0, 0];
      const k = hd.join(',') + '|' + (nk ? nk.join(',') : '');
      if (k !== this.lastHd) { this.lastHd = k; this.net.set(nk ? { hd, nk } : { hd }); }
    }
  },
  tick(dt, rawDt = dt) {
    const now = performance.now();
    if (this.st) this.applyLooks(dt);
    this.world.update(dt, rawDt);
    this.world.render();
    this.placeCheat();
    this.updateTimer();
    if (this.st && now - (this._lastSync || 0) > 300) { this._lastSync = now; this.world.sync(this.st, this.priv); this.refreshLabels(); this.updateDock(); }
  },

  // ---------------- host ----------------
  hostPeers(now) {
    const eng = this.engine, net = this.net;
    const peers = net.peers();
    const present = new Set();
    for (const p of peers) {
      if (p.sameTab) continue;
      const pr = p.presence || {};
      if (pr.v !== 1 || pr.role !== 'guest') continue;
      present.add(p.peer);
      const nm = cleanName(pr.nm) || 'Player';
      let seat = eng.seatOf(p.peer);
      if (seat < 0 && eng.phase === 'lobby') seat = eng.addPlayer(p.peer, nm);
      if (seat >= 0) {
        eng.rename(p.peer, nm);
        const a = pr.act;
        if (a && typeof a === 'object' && typeof a.s === 'number') {
          if (this.processed[p.peer] === undefined) this.processed[p.peer] = a.s;
          else if (a.s > this.processed[p.peer]) {
            this.processed[p.peer] = a.s;
            const err = eng.act(seat, a);
            if (err) console.warn('guest act rejected', seat, err);
            else this.dirtyAt = now;
          }
        } else if (this.processed[p.peer] === undefined) this.processed[p.peer] = 0;
      }
    }
    // remove players who left (grace 4s)
    for (const s of eng.seats) {
      if (!s || s.bot || s.id === this.myId || s.left) continue;
      if (present.has(s.id)) { delete this.missing[s.id]; continue; }
      if (!this.missing[s.id]) this.missing[s.id] = now;
      else if (now - this.missing[s.id] > 4000) { eng.removePlayer(s.id); delete this.missing[s.id]; }
    }
  },
  async publish() {
    const eng = this.engine;
    eng.dirty = false;
    this.lastPub = performance.now();
    const st = eng.publicState();
    this.priv = eng.privateFor(this.mySeat >= 0 ? this.mySeat : eng.seatOf(this.myId));
    this.applyState(st);
    if (!this.net) return;
    const ver = ++this.pubVer;
    const peers = this.net.peers();
    const pv = {};
    for (let i = 0; i < 4; i++) {
      const s = eng.seats[i];
      if (!s || s.bot || s.id === this.myId || s.left) continue;
      const peer = peers.find(p => p.peer === s.id);
      const pk = peer && peer.presence && peer.presence.pk;
      const txt = JSON.stringify(eng.privateFor(i));
      const ck = i + '|' + pk + '|' + txt;
      if (!this.sealCache[ck]) {
        try { this.sealCache[ck] = await Sec.seal(pk, txt); } catch (e) { continue; }
      }
      pv['s' + i] = this.sealCache[ck];
    }
    if (ver !== this.pubVer || !this.net) return;
    const keys = Object.keys(this.sealCache); if (keys.length > 80) this.sealCache = {};
    this.net.set({ st, pv }, true);
  },

  // ---------------- guest ----------------
  guestPoll(now) {
    const peers = this.net.peers();
    let host = peers.find(p => p.peer === this.hostPeer);
    if (!host || !host.presence || host.presence.role !== 'host') {
      if (!this.hostMissingSince) this.hostMissingSince = now;
      else if (now - this.hostMissingSince > 6000) { this.toast('ホストが退出しました'); this.leave(true); }
      return;
    }
    this.hostMissingSince = 0;
    const pr = host.presence;
    this.hostPk = pr.pk || null;
    const st = pr.st;
    if (st && st.v === 1 && (!this.st || st.seq !== this.st.seq || st !== this._lastStObj)) {
      this._lastStObj = st;
      if (!this.st || st.seq !== this.st.seq) this.applyState(st);
    }
    const ms = this.st ? this.st.pl.findIndex(p => p && p.id === this.myId) : -1;
    const sealed = ms >= 0 && pr.pv ? pr.pv['s' + ms] : null;
    if (sealed && sealed !== this.lastPvStr) {
      this.lastPvStr = sealed;
      Sec.open(this.hostPk, sealed).then(txt => {
        if (!txt || sealed !== this.lastPvStr) return;
        try { this.priv = JSON.parse(txt); this.world.sync(this.st, this.priv); this.updateHUD(); } catch (e) { /* */ }
      });
    }
  },

  // ---------------- state ----------------
  applyState(st) {
    const prev = this.st;
    this.st = st; this.stRecv = performance.now();
    this.actPending = 0;
    const ms = st.pl.findIndex(p => p && p.id === this.myId);
    const seatChanged = ms !== this.mySeat;
    this.mySeat = ms;
    if (!prev) {
      this.world.resetTable(st.md);
      if (st.ph !== 'lobby' && st.ph !== 'over') { $('#lobbyScr').classList.add('hidden'); }
    }
    if (!prev || prev.md !== st.md) {
      if (st.ph === 'lobby') {
        this.world.resetTable(st.md);
        // モードを切り替えたら、そのモードのかんたん説明（未読なら）に差し替える
        if (prev && !$('#quick').classList.contains('hidden')) { $('#quick').classList.add('hidden'); this.showQuick(st.md); }
      }
    }
    this.world.setPlayers(st, ms);
    if (seatChanged && ms >= 0) { this.world.look.yaw = 0; this.world.look.pitch = this.world.defaultPitch(); }
    if (this.lastEv === null) this.lastEv = st.ev.reduce((m, e) => Math.max(m, e.i), 0);
    for (const ev of st.ev) {
      if (ev.i > this.lastEv) { this.lastEv = ev.i; this.onEvent(ev, st); }
    }
    this.world.sync(st, this.priv);
    this.updateHUD();
  },
  onEvent(ev, st) {
    const W = this.world, nm = i => (st.pl[i] ? st.pl[i].n : '?');
    switch (ev.t) {
      case 'start':
        $('#quick').classList.add('hidden');
        this.resetNeck();
        this.feed('席替え！ 今回の席順はランダムです');
        W.resetTable(ev.md); W.setPlayers(st, this.mySeat);
        $('#lobbyScr').classList.add('hidden'); $('#overScr').classList.add('hidden');
        W.look.yaw = 0; W.look.pitch = W.defaultPitch();
        this.feed('ゲーム開始！');
        break;
      case 'round': W.evRound(ev); this.feed(`ラウンド${ev.rn}: ${CARD_LABEL[ev.tc]}（${CARD_JP[ev.tc]}）のテーブル`); this.bubbles = {}; break;
      case 'play': W.evPlay(ev); this.feed(`${nm(ev.s)}：${CARD_LABEL[ev.tc]}を${ev.n}枚 出した`); this.bubble(ev.s, `${CARD_LABEL[ev.tc]} ×${ev.n}`); break;
      case 'liar': W.evLiar(ev); this.feed(`${nm(ev.s)} → ${nm(ev.tg)}「ライアー！」${ev.fz ? '（自動）' : ''}`); this.bubbles = {}; break;
      case 'shot':
        if (ev.s === this.mySeat) this.resetNeck();   // 自分が撃つときは首を戻す
        W.evShot(ev);
        this.feed(`${nm(ev.s)} がシリンダーを回す…`);
        break;
      case 'fire':
        W.evFire(ev);
        this.feed(ev.fatal ? `💀 ${nm(ev.s)} は死亡した` : `${nm(ev.s)} は生き延びた（残り${6 - ev.n}回）`);
        break;
      case 'roll': W.evRoll(ev); this.feed(`ラウンド${ev.rn}: ダイスを振った`); this.bubbles = {}; this.revealInfo = null; break;
      case 'bid': W.evBid(ev); this.feed(`${nm(ev.s)}：「${ev.f}の目が${ev.q}個以上」`); this.bubble(ev.s, `${ev.f}の目 ×${ev.q}`, 60000); break;
      case 'dliar': W.evDiceLiar(ev); this.feed(`${nm(ev.s)} → ${nm(ev.tg)}「ライアー！」`); this.revealInfo = { ev, rows: {}, order: [], total: 0 }; break;
      case 'drink':
        if (ev.s === this.mySeat) this.resetNeck();
        W.evDrink(ev);
        this.feed(`${nm(ev.s)} が毒を飲む…`);
        setTimeout(() => this.feed(ev.fatal ? `💀 ${nm(ev.s)} は死亡した` : `${nm(ev.s)} は耐えた（毒 ${ev.n}/2）`), 3400);
        break;
      case 'leave': W.evLeave(ev); this.feed(`${nm(ev.s)} が切断した`); break;
      case 'agari':
        W.evAgari(ev);
        this.feed(`${nm(ev.by)} はライアーと言わなかった…`);
        this.feed(`🏆 ${nm(ev.s)} が手札を出し切って あがり！${ev.lie ? '（ハッタリだった）' : ''}`);
        break;
      case 'over':
        setTimeout(() => {
          if (!this.st || this.st.ph !== 'over') return;
          const w = this.st.w;
          const wn = w >= 0 && this.st.pl[w] ? this.st.pl[w].n : null;
          const agari = ev.why === 'agari';
          $('#overTitle').textContent = wn ? `${wn} の勝利${agari ? '（あがり）' : ''}` : '全員死亡';
          $('#overSub').textContent = agari ? (w === this.mySeat ? 'カードを出し切って、告発を逃れた！' : '手札を出し切られ、告発しそびれた…')
            : (w === this.mySeat ? 'あなたが最後まで生き残った！' : (this.mySeat >= 0 ? 'またの挑戦を…' : ''));
          const canCtl = this.role !== 'guest';
          $('#againBtn').classList.toggle('hidden', !canCtl);
          $('#overNote').textContent = canCtl ? '' : 'ホストの操作を待っています…';
          $('#overScr').classList.remove('hidden');
          if (w === this.mySeat) Snd.win();
          if (ev.why !== 'agari') W.bigText(wn ? `${wn} WINS` : 'NO SURVIVORS', 'gold', 2.5);
        }, ev.why === 'agari' ? 3400 : (ev.w >= 0 ? 1500 : 800));
        break;
      case 'lobby':
        W.resetTable(st.md); W.setPlayers(st, this.mySeat);
        $('#overScr').classList.add('hidden'); $('#lobbyScr').classList.remove('hidden');
        break;
    }
  },
  bubble(seat, text, ms = 4000) {
    this.bubbles[seat] = { text, until: performance.now() + ms };
    this.refreshLabels();
  },

  applyLooks(dt) {
    const st = this.st, W = this.world;
    const peers = this.net ? this.net.peers() : [];
    for (let i = 0; i < 4; i++) {
      const p = st.pl[i], s = W.seats[i];
      if (!p || !s.av) continue;
      if (i === this.mySeat) { s.av.setNeck(this.neckOK ? this.neck.len : 0, this.neck.dir); continue; }
      if (p.b) { this.simBotLook(i, dt); continue; }
      const peer = peers.find(x => x.peer === p.id);
      const hd = peer && peer.presence && peer.presence.hd;
      if (Array.isArray(hd) && hd.length === 2 && isFinite(hd[0]) && isFinite(hd[1])) s.av.look(+hd[0], +hd[1]);
      // 首のばし（他の人の画面にも同じように見える）
      const nk = peer && peer.presence && peer.presence.nk;
      if (p.a && Array.isArray(nk) && nk.length === 2 && isFinite(nk[0]) && isFinite(nk[1])) s.av.setNeck(+nk[0], +nk[1]);
      else s.av.setNeck(0, 0);
    }
  },
  simBotLook(i, dt) {
    const st = this.st, av = this.world.seats[i].av;
    const b = this.botLook[i] || (this.botLook[i] = { t: 0, yaw: 0, pitch: -0.3 });
    b.t -= dt;
    if (b.t <= 0) {
      b.t = 0.8 + Math.random() * 2.5;
      const rel = j => { const d = (j - i + 4) % 4; return d === 1 ? 0.78 : d === 3 ? -0.78 : 0; };
      let yaw = 0, pitch = -0.35;
      if (st.ph === 'turn') {
        if (st.tu === i) { yaw = (Math.random() - 0.5) * 0.3; pitch = -0.55; }
        else if (Math.random() < 0.7) { yaw = rel(st.tu); pitch = -0.02; }
        else { yaw = (Math.random() - 0.5) * 1.6; pitch = -0.1 - Math.random() * 0.3; }
      } else if (st.ph === 'reveal') { yaw = 0; pitch = -0.6; }
      else { yaw = (Math.random() - 0.5) * 2; pitch = -0.1 - Math.random() * 0.3; }
      b.yaw = yaw; b.pitch = pitch;
    }
    av.look(b.yaw, b.pitch);
  },

  // ---------------- HUD ----------------
  refreshLabels() {
    const st = this.st;
    if (!st) return;
    const now = performance.now();
    for (let i = 0; i < 4; i++) {
      const p = st.pl[i];
      if (!p) { this.world.setLabel(i, null); continue; }
      const seat = this.world.seats[i];
      const inGame = st.ph !== 'lobby';
      let status;
      const visDead = seat.visualDead || (!p.a && !seat.busy);
      if (p.lf) status = '切断';
      else if (inGame && visDead) status = '💀 死亡';
      else if (st.md === 'card') {
        const busy = seat.busy && st.ph === 'shot';
        const sh = busy ? Math.max(0, p.sh - 1) : p.sh;
        status = inGame ? `🔫 残り ${6 - sh}/6　🂠 ${p.hc}` : '🔫 6/6';
      } else {
        const busy = seat.busy && st.ph === 'drink';
        const ps = busy ? Math.max(0, p.ps - 1) : p.ps;
        status = `☠ 毒 ${ps}/2`;
      }
      if (st.ph === 'lobby') status = p.b ? 'CPU' : '準備OK';
      const bb = this.bubbles[i];
      const cx = this.priv && this.priv.x;
      // 死亡して観戦中の人だけ: 生きている全員の手札・ダイスを頭の上に表示
      const meP = this.mySeat >= 0 ? st.pl[this.mySeat] : null;
      const spec = !!(inGame && cx && cx.dead && meP && !meP.a);
      const cheatOn = this.cheat && this.isNekoMe();
      const showDice = inGame && st.md === 'dice' && cx && Array.isArray(cx.dd) && Array.isArray(cx.dd[i]) && p.a && (spec || cheatOn);
      const showHand = spec && st.md === 'card' && Array.isArray(cx.hs) && Array.isArray(cx.hs[i]) && cx.hs[i].length && p.a;
      this.world.setLabel(i, {
        dice: showDice ? cx.dd[i] : null,
        diceCheat: showDice && !spec,
        hand: showHand ? cx.hs[i] : null,
        tc: st.tc,
        name: p.n + (i === this.mySeat ? '（あなた）' : ''),
        status,
        turn: st.ph === 'turn' && st.tu === i,
        dead: inGame && visDead,
        bubble: bb && bb.until > now ? bb.text : '',
      });
    }
  },
  updateHUD() {
    const st = this.st;
    if (!st) return;
    this.refreshLabels();
    // lobby panel
    if (st.ph === 'lobby') this.renderLobby();
    const inGame = st.ph !== 'lobby';
    const me = this.mySeat >= 0 ? st.pl[this.mySeat] : null;
    // 隠しコマンド nekojita: 首伸ばしゲージとチート表示
    this.neckOK = !!(this.neckShow && inGame && st.ph !== 'over' && me && me.a && !me.lf && !this.world.ghost);
    $('#neckUI').classList.toggle('hidden', !this.neckOK);
    if (!this.neckOK && this.neck.len) this.resetNeck();
    this.renderCheat(st, inGame);
    // table info
    const ti = $('#tableinfo');
    if (!inGame) ti.innerHTML = `<b>${st.md === 'card' ? 'カード' : 'ダイス'}</b><span class="sub">${this.role === 'offline' ? 'CPU練習' : 'ロビー ' + esc(this.lobbyId)}</span>`;
    else if (st.md === 'card') ti.innerHTML = st.tc ? `<b>${CARD_LABEL[st.tc]} のテーブル</b><span class="sub">場 ${st.pile}枚${st.lp ? '・直前 ' + (st.pl[st.lp.s] ? esc(st.pl[st.lp.s].n) : '') + ' ' + st.lp.n + '枚' : ''}</span>` : '';
    else ti.innerHTML = `<b>ダイス</b><span class="sub">場に全${this.totalDice()}個</span>`;
    // turn info
    const tt = $('#turntext'), tinfo = $('#turninfo');
    let txt = '';
    const myTurn = st.ph === 'turn' && st.tu === this.mySeat && me && me.a;
    if (!inGame) txt = '開始待ち';
    else if (st.ph === 'turn') txt = myTurn ? (st.fz ? 'あなたの番（告発のみ）' : 'あなたの番') : `${st.pl[st.tu] ? st.pl[st.tu].n : '?'} の番`;
    else if (st.ph === 'deal') txt = 'カードを配っています';
    else if (st.ph === 'roll') txt = 'ダイスを振っています';
    else if (st.ph === 'reveal') txt = '公開中…';
    else if (st.ph === 'shot') txt = '🔫 ロシアンルーレット';
    else if (st.ph === 'drink') txt = '☠ 毒';
    else if (st.ph === 'over') txt = 'ゲーム終了';
    tt.textContent = txt;
    tinfo.classList.toggle('me', !!myTurn);
    // my stat
    const ms = $('#mystat');
    if (inGame && me && st.md === 'dice' && me.a && !this.world.ghost) ms.classList.add('hidden');
    else if (inGame && me) {
      ms.classList.remove('hidden');
      const dead = !me.a || this.world.ghost;
      if (dead && !this.world.seats[this.mySeat].busy) ms.innerHTML = '<span class="big">💀 観戦中</span>';
      else if (st.md === 'card') ms.innerHTML = `<span class="big">🔫 残り ${6 - me.sh}/6</span>`;
      else ms.innerHTML = `<span class="big">☠ 毒 ${me.ps}/2</span>`;
    } else if (inGame && !me) { ms.classList.remove('hidden'); ms.innerHTML = '<span class="big">👁 観戦中</span>'; }
    else ms.classList.add('hidden');
    // my dice
    const md = $('#mydice');
    const d = st.md === 'dice' && inGame && me && me.a && this.priv && this.priv.d && this.priv.r === st.rn && st.ph !== 'roll' ? this.priv.d : null;
    if (d) { md.classList.remove('hidden'); md.innerHTML = `<span class="ps">☠ ${me.ps}/2</span>` + d.map(v => dieHTML(v)).join(''); }
    else md.classList.add('hidden');
    this.renderBid();
    this.updateDock();
    // turn change → reset bid stepper
    const turnKey = st.rn + ':' + st.tu + ':' + (st.bid ? st.bid.q + '-' + st.bid.f : '');
    if (myTurn && turnKey !== this._turnKey) {
      this._turnKey = turnKey;
      if (st.md === 'dice') {
        const b = st.bid;
        if (!b) { this.bidQ = 1; this.bidF = 2; }
        else if (b.f < 6) { this.bidQ = b.q; this.bidF = b.f + 1; }
        else { this.bidQ = b.q + 1; this.bidF = 2; }
        this.bidQ = Math.min(this.bidQ, this.totalDice());
      } else this.world.clearSelect();
      Snd.knock();
    }
    if (!myTurn) this._turnKey = null;
    this.updateActions();
  },
  // 自分のダイスで、その目の個数（宣言した目だけを数える）
  myCount(f) {
    const st = this.st, d = this.priv && this.priv.d;
    if (!st || !d || !d.length || this.priv.r !== st.rn) return null;
    return d.filter(v => v === f).length;
  },
  // ダイスモードのベット表示（いま「何の目」が「何個以上」か）
  renderBid() {
    const st = this.st, el = $('#bidBanner'), hud = $('#hud');
    const show = st && st.md === 'dice' && ['roll', 'turn', 'reveal', 'drink'].includes(st.ph);
    el.classList.toggle('hidden', !show); hud.classList.toggle('withBid', !!show);
    el.classList.remove('ok', 'ng');
    if (!show) return;
    const nm = i => esc(st.pl[i] ? st.pl[i].n : '?');
    const R = this.revealInfo;
    if (R && (st.ph === 'reveal' || st.ph === 'drink')) {
      const ev = R.ev;
      let rows = '';
      for (const i of R.order || []) {
        const r = R.rows[i];
        if (!r) continue;
        rows += `<div class="bb-row ${R.cur === i ? 'cur' : ''}"><span class="nm">${i === this.mySeat ? 'あなた' : nm(i)}</span><span class="dz">${r.dice.map((v, k) => dieHTML(v, r.hl.includes(k) ? 'hit' : 'miss')).join('')}</span><span class="cnt">${r.cnt ? '+' + r.cnt : (r.done || R.cur !== i ? '0' : '…')}</span></div>`;
      }
      el.innerHTML = `<div class="bb-label">${ev.tg === this.mySeat ? 'あなた' : nm(ev.tg)} の宣言</div><div class="bb-main">${dieHTML(ev.f)}<span>が <b>${ev.q}個</b> 以上</span></div>` +
        (rows ? `<div class="bb-rows">${rows}</div>` : '<div class="bb-sub">ダイスを公開します…</div>') +
        `<div class="bb-total">合計 <b>${R.total}</b> 個 <small>／宣言 ${ev.q}個</small></div>` +
        (R.done ? `<div class="bb-res">${ev.lie ? `足りない！ ハッタリ → ${nm(ev.lo)}` : `宣言どおり！ → ${nm(ev.lo)}`}</div>` : (R.final ? '<div class="bb-res wait">結果は…</div>' : ''));
      if (R.done) el.classList.add(ev.lie ? 'ng' : 'ok');
      return;
    }
    if (st.ph === 'roll') { el.innerHTML = '<div class="bb-main none">ダイスを振っています…</div>'; return; }
    if (!st.bid) {
      el.innerHTML = `<div class="bb-label">いまのベット</div><div class="bb-main none">まだありません</div><div class="bb-sub">${st.tu === this.mySeat ? 'あなた' : nm(st.tu)} が最初にベットします</div>`;
      return;
    }
    const { q, f, s } = st.bid;
    const mine = this.myCount(f);
    el.innerHTML = `<div class="bb-label">いまのベット（${s === this.mySeat ? 'あなた' : nm(s)}）</div>` +
      `<div class="bb-main">${dieHTML(f)}<span>が <b>${q}個</b> 以上</span></div>` +
      `<div class="bb-sub">場のダイス 全${this.totalDice()}個中</div>` +
      (mine != null ? `<div class="bb-mine">あなたの手元：${dieHTML(f)} ×${mine}</div>` : '') + this.cheatVerdict(f, q, 'bb');
  },
  // チート（nekojita・ダイス）: 全員のダイスから、その目が実際に何個あるか
  cheatCount(f) {
    const st = this.st, x = this.priv && this.priv.x;
    if (!this.cheat || !st || st.md !== 'dice' || !x || !Array.isArray(x.dd) || !this.isNekoMe()) return null;
    let n = 0; for (const d of x.dd) if (Array.isArray(d)) for (const v of d) if (v === f) n++;
    return n;
  },
  cheatVerdict(f, q, kind) {
    const n = this.cheatCount(f);
    if (n == null) return '';
    const ok = n >= q;
    if (kind === 'bb') return `<div class="bb-cheat ${ok ? 'ok' : 'ng'}">🐱 実際は ${dieHTML(f)} ×${n} → ${ok ? '足りている（本当）' : '足りない（ウソ）'}</div>`;
    return `<span class="cheatTag ${ok ? 'ok' : 'ng'}">🐱 実際${n}個・${ok ? '行ける' : '足りない'}</span>`;
  },
  updateDock() {
    const md = $('#mydice');
    let dock = this.world.handTopPx || 0;
    if (md && !md.classList.contains('hidden')) dock = Math.max(dock, md.offsetHeight + 10 + this.world.safeBottom());
    if (dock !== this._dock) { this._dock = dock; document.documentElement.style.setProperty('--dock-h', dock + 'px'); }
  },
  validBid(q, f) {
    const st = this.st; if (!st) return false;
    if (q < 1 || q > this.totalDice() || f < 1 || f > 6) return false;
    if (!st.bid) return true;
    return q > st.bid.q || (q === st.bid.q && f > st.bid.f);
  },
  updateActions() {
    const st = this.st;
    const acts = $('#actions'), hint = $('#hint');
    if (!st || st.ph === 'lobby') { acts.classList.add('hidden'); hint.classList.add('hidden'); this.world.canSelect = false; return; }
    if (!(st.ph === 'turn' && st.tu === this.mySeat)) $('#turnHint').classList.add('hidden');
    const me = this.mySeat >= 0 ? st.pl[this.mySeat] : null;
    const myTurn = st.ph === 'turn' && st.tu === this.mySeat && me && me.a;
    const pending = this.actPending && performance.now() - this.actPending < 3000;
    this.world.handDown = (st.ph === 'reveal' || st.ph === 'shot') ? 1 : 0;
    if (!myTurn || pending) {
      acts.classList.add('hidden');
      this.world.canSelect = false;
      let h = '';
      if (pending) h = '送信中…';
      else if (st.ph === 'turn' && me && me.a) h = `${st.pl[st.tu] ? st.pl[st.tu].n : '?'} の番を待っています`;
      else if (st.ph === 'turn' && (!me || !me.a)) h = me ? '観戦中：全員の手札・ダイスが見えます（ドラッグで見回せます）' : '観戦中：ドラッグで見回せます';
      hint.textContent = h; hint.classList.toggle('hidden', !h || st.ph === 'over');
      return;
    }
    hint.classList.add('hidden');
    acts.classList.remove('hidden');
    const card = st.md === 'card';
    const th = $('#turnHint');
    let tip = '';
    if (this.hints) {
      if (card) {
        const prevOut = st.lp && st.lp.s !== this.mySeat && st.pl[st.lp.s] && st.pl[st.lp.s].hc === 0;
        tip = st.fz ? '全員の手札が尽きました。最後のカードを告発します'
          : prevOut ? `⚠ ${st.pl[st.lp.s].n} は手札を出し切った！ 出すと相手の「あがり」。疑うなら「ライアー！」`
          : (st.lp && st.lp.s !== this.mySeat ? `${CARD_LABEL[st.tc]}を1〜5枚選んで出す（嘘でもOK）／疑うなら「ライアー！」` : `${CARD_LABEL[st.tc]}を1〜5枚選んで出す（嘘でもOK）`);
      }
      else tip = st.fz ? 'これ以上上乗せできません。告発してください' : (st.bid ? '個数を増やせば目は自由／同じ個数なら大きい目に／多すぎると思ったら「ライアー！」' : '「○の目が全員分でX個以上」をベット。数えるのはその目だけ');
    }
    th.textContent = tip; th.classList.toggle('hidden', !tip);
    $('#cardActs').classList.toggle('hidden', !card);
    $('#diceActs').classList.toggle('hidden', card);
    acts.classList.toggle('dice', !card);
    if (card) {
      this.world.canSelect = !st.fz;
      const n = this.world.selected.size;
      const pb = $('#playBtn');
      pb.classList.toggle('hidden', !!st.fz);
      pb.disabled = n < 1 || n > 5;
      pb.textContent = n ? `${CARD_LABEL[st.tc]}を${n}枚 出す` : 'カードを選択';
      $('#liarBtn').disabled = !(st.lp && st.lp.s !== this.mySeat);
    } else {
      $('#bidpanel').classList.toggle('hidden', !!st.fz);
      $('#bidBtn').classList.toggle('hidden', !!st.fz);
      $('#qVal').textContent = this.bidQ;
      $$('#faces button').forEach(b => { b.classList.toggle('on', +b.dataset.f === this.bidF); b.classList.toggle('dim', !this.validBid(this.bidQ, +b.dataset.f)); });
      const bd = st.bid;
      $('#bidRule').textContent = !bd ? '最初のベットは自由（1個以上・どの目でも）'
        : (bd.q + 1 <= this.totalDice() ? `${bd.q + 1}個以上なら どの目でもOK` : '') + (bd.f < 6 ? `／${bd.q}個のままなら ${bd.f + 1}〜6の目` : `／${bd.q}個のままは不可`);
      $('#bidBtn').disabled = !this.validBid(this.bidQ, this.bidF);
      $('#bidBtn').innerHTML = `${dieHTML(this.bidF)} ×${this.bidQ} ベット`;
      const mine = this.myCount(this.bidF);
      $('#bidPreview').innerHTML = `「${dieHTML(this.bidF)} が <b>${this.bidQ}個</b> 以上」` + (mine != null ? `　手元 ${mine}個` : '') + this.cheatVerdict(this.bidF, this.bidQ, 'tag');
      $('#dLiarBtn').disabled = !(st.bid && st.bid.s !== this.mySeat);
    }
  },
  updateTimer() {
    const st = this.st, el = $('#timer');
    if (!st || st.ph !== 'turn') { el.style.visibility = 'hidden'; return; }
    el.style.visibility = 'visible';
    let rem, total;
    if (this.engine) { rem = this.engine.phaseEnd - this.engine.now(); total = st.fz ? this.engine.T.forced : this.engine.T.turn; }
    else { rem = st.dl - (performance.now() - this.stRecv); total = st.fz ? 6000 : 30000; }
    const f = clamp(rem / total, 0, 1);
    el.firstElementChild.style.transform = `scaleX(${f.toFixed(3)})`;
    el.classList.toggle('low', rem < 8000);
  },
  renderLobby() {
    const st = this.st;
    const host = this.role !== 'guest';
    $('#lobbyTitle').textContent = this.role === 'offline' ? 'CPU練習' : 'ロビー';
    $('#lobbyIdBox').classList.toggle('hidden', this.role === 'offline');
    $('#lobbyId').textContent = this.lobbyId;
    $$('#lMode button').forEach(b => { b.classList.toggle('on', b.dataset.m === st.md); b.disabled = !host; });
    const cols = ['#9aa0aa', '#c23a44', '#8a9a5a', '#7a5aaa'];
    const ul = $('#seatList'); ul.innerHTML = '';
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const p = st.pl[i];
      const li = document.createElement('li');
      if (p) {
        n++;
        li.innerHTML = `<span class="dot" style="background:${cols[p.c % 4]}"></span><span class="nm"></span>${p.b ? '<span class="tag">CPU</span>' : ''}${p.id === (this.role === 'guest' ? this.hostPeer : this.myId) && this.role !== 'offline' ? '<span class="tag">ホスト</span>' : ''}${i === this.mySeat ? '<span class="tag">あなた</span>' : ''}`;
        li.querySelector('.nm').textContent = p.n;
      } else { li.className = 'empty'; li.innerHTML = '<span class="dot" style="background:#333"></span><span class="nm">空席</span>'; }
      ul.appendChild(li);
    }
    $('#hostCtl').classList.toggle('hidden', !host);
    $('#startBtn').disabled = n < 2;
    $('#addBot').disabled = n >= 4;
    $('#rmBot').disabled = !st.pl.some(p => p && p.b);
    let note = '';
    if (host && this.role === 'host') note = n < 2 ? 'ロビーIDとパスワードを友達に伝えてください。CPUを追加して始めることもできます。' : '準備ができたら開始してください。';
    else if (!host) note = this.mySeat >= 0 ? 'ホストの開始を待っています…' : '満席のため観戦します。';
    $('#lobbyNote').textContent = note;
  },
};

if (window.__ltDebug) window.__lt = App;

