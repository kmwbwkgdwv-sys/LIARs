// 暗号化: 各プレイヤーの手札・ダイスは ECDH(P-256) + AES-GCM で本人だけが読めるように送る
export const B64 = {
  enc(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); },
  dec(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; },
};
export function sha256js(ascii) {
  // compact fallback SHA-256 (UTF-8 input)
  const str = unescape(encodeURIComponent(ascii));
  const rr = (v, a) => (v >>> a) | (v << (32 - a));
  const K = [], H = [];
  let primeCounter = 0;
  const isComp = {};
  for (let c = 2; primeCounter < 64; c++) {
    if (!isComp[c]) {
      for (let i = 0; i < 313; i += c) isComp[i] = c;
      H[primeCounter] = (Math.pow(c, 0.5) * 4294967296) | 0;
      K[primeCounter++] = (Math.pow(c, 1 / 3) * 4294967296) | 0;
    }
  }
  const hash = H.slice(0, 8);
  const words = [];
  let s = str + '\x80';
  while (s.length % 64 - 56) s += '\x00';
  for (let i = 0; i < s.length; i++) words[i >> 2] |= s.charCodeAt(i) << ((3 - i) % 4) * 8;
  words[words.length] = ((str.length * 8) / 4294967296) | 0;
  words[words.length] = (str.length * 8) | 0;
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const old = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + K[i] +
        (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
      const t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash.unshift((t1 + t2) | 0);
      hash[4] = (hash[4] + t1) | 0;
      hash.length = 8;
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) { const b = (hash[i] >> (j * 8)) & 255; out += (b < 16 ? '0' : '') + b.toString(16); }
  return out;
}
export const Sec = {
  ok: !!(globalThis.crypto && crypto.subtle && globalThis.isSecureContext !== false),
  kp: null, pub: null, keys: new Map(),
  async init() {
    if (!this.ok) return;
    try {
      this.kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
      this.pub = B64.enc(await crypto.subtle.exportKey('raw', this.kp.publicKey));
    } catch (e) { console.warn('crypto unavailable', e); this.ok = false; }
  },
  async keyFor(pubB64) {
    if (!this.ok || !pubB64) return null;
    if (this.keys.has(pubB64)) return this.keys.get(pubB64);
    const p = (async () => {
      const pk = await crypto.subtle.importKey('raw', B64.dec(pubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      return crypto.subtle.deriveKey({ name: 'ECDH', public: pk }, this.kp.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    })().catch(() => null);
    this.keys.set(pubB64, p);
    return p;
  },
  async seal(pubB64, text) {
    const k = await this.keyFor(pubB64);
    if (!k) return 'p:' + B64.enc(new TextEncoder().encode(text));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text));
    return 'e:' + B64.enc(iv) + '.' + B64.enc(ct);
  },
  async open(pubB64, sealed) {
    if (!sealed) return null;
    try {
      if (sealed.startsWith('p:')) return new TextDecoder().decode(B64.dec(sealed.slice(2)));
      const k = await this.keyFor(pubB64);
      if (!k) return null;
      const [iv, ct] = sealed.slice(2).split('.');
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B64.dec(iv) }, k, B64.dec(ct));
      return new TextDecoder().decode(pt);
    } catch (e) { return null; }
  },
  async hash(text) {
    try {
      if (this.ok) {
        const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* fall through */ }
    return sha256js(text);
  },
};

