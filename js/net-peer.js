// 通信方式その2: PeerJS（WebRTC の P2P）。GitHub Pages など claude.ai 以外で使う。
// ホストを中心とした星型接続で、claude.ai 版の「presence」と同じ形のデータを中継する。

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
// PeerJS の既定設定と同じ（STUN ＋ PeerJS の無料 TURN 中継）。
// 以前は STUN だけを渡していたため PeerJS の TURN が外れ、携帯回線どうし・別ネットワーク間で
// つながらず「ロビーが見つからない」と表示されていた。
const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
const OPEN_TIMEOUT = 20000;      // 仲介サーバーにつながるまでの待ち時間
const CONNECT_TIMEOUT = 20000;   // ホストとの P2P 接続が開くまでの待ち時間
const OPEN_TRIES = 3;            // 仲介サーバーが一時的に不調なときのやり直し回数
const RETRYABLE = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'timeout']);

export function p2pSupported() { return typeof window !== 'undefined' && typeof window.RTCPeerConnection !== 'undefined'; }

let peerLoad = null;
export function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!p2pSupported()) return Promise.resolve(null);
  if (peerLoad) return peerLoad;   // 読み込み中なら同じ Promise を使う（スクリプトを二重に入れない）
  peerLoad = new Promise((res, rej) => {
    const s = document.createElement('script');
    let done = false;
    const fail = (msg) => { if (done) return; done = true; s.remove(); peerLoad = null; rej({ code: 'load', message: msg }); };
    const to = setTimeout(() => fail('PeerJS load timeout'), 15000);
    s.src = PEERJS_URL; s.async = true;
    s.onload = () => { if (done) return; done = true; clearTimeout(to); window.Peer ? res(window.Peer) : (peerLoad = null, rej({ code: 'load', message: 'PeerJS missing' })); };
    s.onerror = () => { clearTimeout(to); fail('PeerJS load failed'); };
    document.head.appendChild(s);
  });
  return peerLoad;
}

function mapErr(err) {
  const t = err && err.type;
  if (t === 'unavailable-id') return { code: 'inuse' };
  if (t === 'peer-unavailable') return { code: 'notfound' };
  if (t === 'browser-incompatible') return { code: 'unsupported' };
  return { code: 'network', message: (err && (err.type || err.message)) || 'error' };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

export class PeerNet {
  constructor(PeerCls) {
    this.kind = 'p2p';
    this.Peer = PeerCls;
    this.cfg = (window.LIARS_TABLE_CONFIG || {});
    this.states = new Map();   // peerId -> presence object
    this.conns = new Map();    // host: guestId -> { conn, last }
    this.hostConn = null; this.lastHost = 0;
    this.me = null; this.role = null; this.onLost = null;
    this.pending = {}; this.flushT = 0; this.mine = {};
    this.snap = []; this.dirty = true; this.closed = false;
    this.reconnT = 0; this.reconnDelay = 1000;
  }
  // 仲介サーバー（PeerJS）につなぐ。一時的な失敗は少し待ってやり直す
  async openPeer(id) {
    const opts = Object.assign({ debug: 0, config: { iceServers: this.cfg.iceServers || DEFAULT_ICE, sdpSemantics: 'unified-plan' } }, this.cfg.peerServer || {});
    let last = null;
    for (let tryNo = 1; tryNo <= OPEN_TRIES && !this.closed; tryNo++) {
      const peer = new this.Peer(id, opts);
      try {
        const myId = await new Promise((res, rej) => {
          const to = setTimeout(() => rej({ code: 'network', message: 'timeout' }), OPEN_TIMEOUT);
          peer.on('open', pid => { clearTimeout(to); res(pid); });
          peer.on('error', err => { if (!peer.open) { clearTimeout(to); rej(Object.assign(mapErr(err), { raw: err && err.type })); } });
        });
        return { peer, myId };
      } catch (e) {
        try { peer.destroy(); } catch (er) { /* */ }
        last = e;
        const retry = e.code === 'network' && (RETRYABLE.has(e.raw) || e.message === 'timeout');
        if (!retry || tryNo === OPEN_TRIES) break;
        console.warn('PeerJS server not ready, retrying', e);
        await wait(1200 * tryNo);
      }
    }
    throw last || { code: 'network', message: 'closed' };
  }
  async enter(key, role) {
    this.role = role;
    this.hostId = 'liarstable-' + key.slice(0, 32);
    const { peer, myId } = await this.openPeer(role === 'host' ? this.hostId : undefined);
    this.peer = peer; this.me = myId;
    this.states.set(this.me, this.mine);
    peer.on('open', () => { this.reconnDelay = 1000; });
    peer.on('error', err => {
      const m = mapErr(err);
      if (m.code === 'notfound' && this.connectRej) { this.connectRej(m); return; }
      if (m.code !== 'notfound') console.warn('PeerJS error', err && err.type, err && err.message);
    });
    // 仲介サーバーとの接続が切れたら、少し間をあけてつなぎ直す（つながっている相手とのP2Pはそのまま）
    peer.on('disconnected', () => this.scheduleReconnect());
    this.onVis = () => { if (document.visibilityState === 'visible') this.scheduleReconnect(true); };
    document.addEventListener('visibilitychange', this.onVis);
    if (role === 'host') {
      peer.on('connection', conn => this.accept(conn));
    } else {
      try { await this.connectHost(); } catch (e) { this.destroy(); throw e; }
    }
    this.hb = setInterval(() => this.heartbeat(), 2000);
  }
  scheduleReconnect(now) {
    const peer = this.peer;
    if (this.closed || !peer || peer.destroyed || !peer.disconnected) return;
    if (this.reconnT) { if (!now) return; clearTimeout(this.reconnT); }
    this.reconnT = setTimeout(() => {
      this.reconnT = 0;
      if (this.closed || peer.destroyed || !peer.disconnected) return;
      try { peer.reconnect(); } catch (e) { /* */ }
      this.reconnDelay = Math.min(this.reconnDelay * 2, 15000);
      // まだ切れたままなら、もう一度
      setTimeout(() => this.scheduleReconnect(), 4000);
    }, now ? 0 : this.reconnDelay);
  }
  connectHost() {
    return new Promise((res, rej) => {
      let settled = false, conn = null, to = 0;
      const finish = (err) => {
        if (settled) return; settled = true;
        clearTimeout(to); this.connectRej = null;
        if (err) { try { conn && conn.close(); } catch (e) { /* */ } rej(err); } else res();
      };
      // 時間切れ: 仲介サーバーは「その相手はいない」と言っていない＝ホストはいるが P2P が開けなかった
      to = setTimeout(() => finish({ code: 'p2pfail', message: 'timeout' }), CONNECT_TIMEOUT);
      this.connectRej = (e) => finish(e);
      conn = this.peer.connect(this.hostId, { reliable: true, serialization: 'json' });
      if (!conn) { finish({ code: 'network', message: 'disconnected' }); return; }
      conn.on('open', () => {
        if (settled) return;
        this.hostConn = conn; this.lastHost = Date.now();
        conn.send({ t: 'p', d: this.mine });
        finish(null);
      });
      conn.on('data', d => this.onData(conn, d));
      conn.on('close', () => { if (!settled) finish({ code: 'p2pfail', message: 'closed' }); else if (conn === this.hostConn) this.hostGone(); });
      conn.on('error', e => { if (!settled) finish({ code: 'p2pfail', message: (e && e.type) || 'error' }); });
    });
  }
  accept(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, { conn, last: Date.now() });
      if (!this.states.has(conn.peer)) this.states.set(conn.peer, {});
      const all = {}; for (const [k, v] of this.states) all[k] = v;
      this.safeSend(conn, { t: 'snap', s: all });
      this.dirty = true;
    });
    conn.on('data', d => this.onData(conn, d));
    conn.on('close', () => { const g = this.conns.get(conn.peer); if (g && g.conn === conn) this.dropGuest(conn.peer); });
    conn.on('error', () => {});
  }
  safeSend(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* */ } }
  merge(id, patch) {
    if (!patch || typeof patch !== 'object') return;
    const cur = Object.assign({}, this.states.get(id) || {});
    for (const k of Object.keys(patch)) { if (patch[k] === null) delete cur[k]; else cur[k] = patch[k]; }
    this.states.set(id, Object.freeze(cur));
    this.dirty = true;
  }
  onData(conn, d) {
    if (!d || typeof d !== 'object') return;
    if (this.role === 'host') {
      const id = conn.peer, c = this.conns.get(id);
      if (c) c.last = Date.now();
      if (d.t === 'p') {
        this.merge(id, d.d);
        for (const [gid, g] of this.conns) if (gid !== id) this.safeSend(g.conn, { t: 'p', id, d: d.d });
      }
    } else {
      this.lastHost = Date.now();
      if (d.t === 'snap' && d.s && typeof d.s === 'object') {
        this.states = new Map();
        for (const k of Object.keys(d.s)) if (k !== this.me) this.states.set(k, Object.freeze(Object.assign({}, d.s[k])));
        this.states.set(this.me, this.mine);
        this.dirty = true;
      } else if (d.t === 'p' && typeof d.id === 'string' && d.id !== this.me) this.merge(d.id, d.d);
      else if (d.t === 'gone' && typeof d.id === 'string') { this.states.delete(d.id); this.dirty = true; }
    }
  }
  dropGuest(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id); this.states.delete(id); this.dirty = true;
    for (const [, g] of this.conns) this.safeSend(g.conn, { t: 'gone', id });
  }
  hostGone() {
    if (this.closed) return;
    this.states.delete(this.hostId); this.dirty = true;
  }
  heartbeat() {
    const now = Date.now();
    if (this.role === 'host') {
      for (const [id, g] of this.conns) {
        if (now - g.last > 15000) { try { g.conn.close(); } catch (e) { /* */ } this.dropGuest(id); }
        else this.safeSend(g.conn, { t: 'ping' });
      }
    } else if (this.hostConn) {
      this.safeSend(this.hostConn, { t: 'ping' });
      if (now - this.lastHost > 15000) this.hostGone();
    }
  }
  peers() {
    if (this.dirty) {
      this.dirty = false;
      this.snap = Object.freeze([...this.states.entries()].map(([peer, presence]) => Object.freeze({ peer, sameTab: peer === this.me, isMe: peer === this.me, presence: presence || {} })));
    }
    return this.snap;
  }
  set(patch, now) {
    Object.assign(this.pending, patch);
    if (now) { if (this.flushT) clearTimeout(this.flushT); this.flushT = 0; this.flush(); return; }
    if (!this.flushT) this.flushT = setTimeout(() => this.flush(), 60);
  }
  flush() {
    this.flushT = 0;
    const p = this.pending; this.pending = {};
    if (!Object.keys(p).length || this.closed) return;
    const next = Object.assign({}, this.mine);
    for (const k of Object.keys(p)) { if (p[k] === null) delete next[k]; else next[k] = p[k]; }
    this.mine = Object.freeze(next);
    if (this.me) this.states.set(this.me, this.mine);
    this.dirty = true;
    if (this.role === 'host') { for (const [, g] of this.conns) this.safeSend(g.conn, { t: 'p', id: this.me, d: p }); }
    else this.safeSend(this.hostConn, { t: 'p', d: p });
  }
  destroy() {
    this.closed = true;
    if (this.hb) clearInterval(this.hb);
    if (this.flushT) clearTimeout(this.flushT);
    if (this.reconnT) clearTimeout(this.reconnT);
    if (this.onVis) document.removeEventListener('visibilitychange', this.onVis);
    try { this.peer && this.peer.destroy(); } catch (e) { /* */ }
  }
  async leave() {
    if (this.role === 'host') for (const [, g] of this.conns) this.safeSend(g.conn, { t: 'gone', id: this.me });
    await new Promise(r => setTimeout(r, 120));
    this.destroy();
  }
}
