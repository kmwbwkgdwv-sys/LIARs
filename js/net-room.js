// 通信方式その1: claude.ai のアーティファクト「room」機能（presence）を使う
import { randId } from './util.js';

export async function getRoomCapability(maxWaitMs = 2000) {
  for (let t = 0; t < maxWaitMs && !(window.claude && typeof window.claude.use === 'function'); t += 100) await new Promise(r => setTimeout(r, 100));
  if (!(window.claude && typeof window.claude.use === 'function')) return null;
  try {
    const r = await Promise.race([window.claude.use('room'), new Promise(res => setTimeout(() => res(null), 12000))]);
    return r || null;
  } catch (e) { return null; }
}

export class RoomNet {
  constructor(room) {
    this.kind = 'room';
    this.room = room; this.ch = null; this.named = false; this.key = null;
    this.pending = {}; this.flushT = 0; this.me = null; this.onLost = null;
    this.unsubs = []; this.mine = {};
  }
  // role: 'host' | 'guest'
  async enter(key, role) {
    this.key = key;
    try { this.ch = await this.room.join('lt-' + key.slice(0, 40)); this.named = true; } catch (e) { this.ch = this.room; this.named = false; }
    this.unsubs.push(this.ch.onPeers(chg => {
      const me = chg.peers.find(p => p.sameTab);
      if (me) this.me = me.peer;
    }, err => { if (this.onLost) this.onLost(err && err.code); }));
    for (let i = 0; i < 60 && !this.me; i++) {
      await new Promise(r => setTimeout(r, 100));
      const me = this.ch.peers().find(p => p.sameTab);
      if (me) this.me = me.peer;
    }
    if (!this.me) this.me = 'me-' + randId(8);
    const findHost = () => this.peers().find(p => !p.sameTab && p.presence && p.presence.role === 'host');
    if (role === 'host') {
      this.set({ role: 'probe' }, true);
      await new Promise(r => setTimeout(r, 2200));
      if (findHost()) { await this.leave(); throw { code: 'inuse' }; }
    } else {
      let host = null;
      for (let i = 0; i < 80 && !host; i++) { await new Promise(r => setTimeout(r, 100)); host = findHost(); }
      if (!host) { await this.leave(); throw { code: 'notfound' }; }
    }
  }
  peers() {
    if (!this.ch) return [];
    const ps = this.ch.peers();
    return this.named ? ps : ps.filter(p => p.sameTab || (p.presence && p.presence.lb === this.key));
  }
  set(patch, now) {
    Object.assign(this.pending, patch);
    Object.assign(this.mine, patch);
    if (now) { if (this.flushT) clearTimeout(this.flushT); this.flushT = 0; this.flush(); return; }
    if (!this.flushT) this.flushT = setTimeout(() => this.flush(), 70);
  }
  flush() {
    this.flushT = 0;
    if (!this.ch) return;
    const p = this.pending; this.pending = {};
    if (!this.named) p.lb = this.key;
    if (!Object.keys(p).length) return;
    this.ch.presence(p).catch(e => {
      if (e && e.code === 'invalid_argument' && p.st) {
        const st = Object.assign({}, p.st, { ev: (p.st.ev || []).slice(-3) });
        this.ch && this.ch.presence(Object.assign({}, p, { st })).catch(() => {});
      }
    });
  }
  async leave() {
    const ch = this.ch; this.ch = null;
    if (this.flushT) clearTimeout(this.flushT);
    this.unsubs.forEach(u => { try { u(); } catch (e) { /* */ } }); this.unsubs = [];
    try {
      if (this.named) await ch.leave();
      else if (ch) { const clear = {}; for (const k of Object.keys(this.mine)) clear[k] = null; clear.lb = null; await ch.presence(clear); }
    } catch (e) { /* ignore */ }
  }
}
