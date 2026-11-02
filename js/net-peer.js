// 通信方式その2: PeerJS（WebRTC の P2P）。GitHub Pages など claude.ai 以外で使う。
// ホストを中心とした星型接続で、claude.ai 版の「presence」と同じ形のデータを中継する。
import { randId } from './util.js';

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function p2pSupported() { return typeof window !== 'undefined' && typeof window.RTCPeerConnection !== 'undefined'; }

export async function loadPeerJS() {
  if (window.Peer) return window.Peer;
  if (!p2pSupported()) return null;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = PEERJS_URL; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('PeerJS load failed'));
    document.head.appendChild(s);
    setTimeout(() => rej(new Error('PeerJS load timeout')), 15000);
  });
  return window.Peer || null;
}

function mapErr(err) {
  const t = err && err.type;
  if (t === 'unavailable-id') return { code: 'inuse' };
  if (t === 'peer-unavailable') return { code: 'notfound' };
  if (t === 'browser-incompatible') return { code: 'unsupported' };
  return { code: 'network', message: (err && (err.type || err.message)) || 'error' };
}

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
  }
  async enter(key, role) {
    this.role = role;
    this.hostId = 'liarstable-' + key.slice(0, 32);
    const opts = Object.assign({ debug: 0, config: { iceServers: this.cfg.iceServers || DEFAULT_ICE } }, this.cfg.peerServer || {});
    const peer = this.peer = new this.Peer(role === 'host' ? this.hostId : undefined, opts);
    let enterErr = null;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej({ code: 'network', message: 'timeout' }), 15000);
      peer.on('open', id => { clearTimeout(to); this.me = id; res(); });
      peer.on('error', err => {
        if (!this.me) { clearTimeout(to); rej(mapErr(err)); return; }
        const m = mapErr(err);
        if (m.code === 'notfound' && this.connectRej) { this.connectRej(m); return; }
        enterErr = m;
      });
    }).catch(async e => { this.destroy(); throw e; });
    this.states.set(this.me, this.mine);
    peer.on('disconnected', () => { if (!this.closed) { try { peer.reconnect(); } catch (e) { /* */ } } });
    if (role === 'host') {
      peer.on('connection', conn => this.accept(conn));
    } else {
      try { await this.connectHost(); } catch (e) { this.destroy(); throw e; }
    }
    this.hb = setInterval(() => this.heartbeat(), 2000);
  }
  connectHost() {
    return new Promise((res, rej) => {
      const to = setTimeout(() => { this.connectRej = null; rej({ code: 'notfound' }); }, 14000);
      this.connectRej = (e) => { clearTimeout(to); this.connectRej = null; rej(e); };
      const conn = this.peer.connect(this.hostId, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        clearTimeout(to); this.connectRej = null;
        this.hostConn = conn; this.lastHost = Date.now();
        conn.send({ t: 'p', d: this.mine });
        res();
      });
      conn.on('data', d => this.onData(conn, d));
      conn.on('close', () => this.hostGone());
      conn.on('error', () => {});
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
    conn.on('close', () => this.dropGuest(conn.peer));
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
    try { this.peer && this.peer.destroy(); } catch (e) { /* */ }
  }
  async leave() {
    if (this.role === 'host') for (const [, g] of this.conns) this.safeSend(g.conn, { t: 'gone', id: this.me });
    await new Promise(r => setTimeout(r, 120));
    this.destroy();
  }
}
