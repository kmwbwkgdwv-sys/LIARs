// プロシージャル（コードで生成する）テクスチャ。外部画像を使わずに高解像度の質感を作る。
import * as THREE from 'three';
import { clamp, smooth, gauss } from './util.js';
import { faceMasks, HEADS } from './face.js';

// ---- ノイズ ----
function hash(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s = 0, oct = 4) { let a = 0, amp = 0.5, f = 1; for (let i = 0; i < oct; i++) { a += amp * vnoise(x * f, y * f, s + i * 17); f *= 2; amp *= 0.5; } return a; }
// 顔UVの各ピクセルに対応する単位ベクトルを高速に回す（三角関数は表引き）
function facePixels(W, H, fn) {
  const cp = new Float32Array(W), sp = new Float32Array(W), ct = new Float32Array(H), st = new Float32Array(H);
  for (let x = 0; x < W; x++) { const phi = (x + 0.5) / W * Math.PI * 2; cp[x] = Math.cos(phi); sp[x] = Math.sin(phi); }
  for (let y = 0; y < H; y++) { const th = (y + 0.5) / H * Math.PI; ct[y] = Math.cos(th); st[y] = Math.sin(th); }
  for (let py = 0; py < H; py++) {
    const sT = st[py], cT = ct[py];
    for (let px = 0; px < W; px++) {
      // unitFromAngles: (-sz, sy, sx) with sx=-cosφ sinθ, sy=cosθ, sz=sinφ sinθ
      fn(px, py, -sp[px] * sT, cT, -cp[px] * sT);
    }
  }
}
function hex(c) { const v = new THREE.Color(c); return [v.r * 255, v.g * 255, v.b * 255]; }

export const Tex = {
  cache: {},
  hi: !(typeof window !== 'undefined' && window.__lowgfx),
  canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
  tex(c, repeat, srgb = true) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  },
  rnd(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; },

  // 高さマップ（グレースケールのcanvas）から法線マップを作る
  normalFrom(src, strength = 2) {
    const w = src.width, h = src.height;
    const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
    const out = this.canvas(w, h), oc = out.getContext('2d'), od = oc.createImageData(w, h);
    const H = (x, y) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      od.data[i] = (-dx / l * 0.5 + 0.5) * 255; od.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; od.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; od.data[i + 3] = 255;
    }
    oc.putImageData(od, 0, 0);
    return out;
  },

  // 木目（ピクセル単位で生成: 板目・年輪・節・継ぎ目・すり傷）
  wood(key, base, dark, planks = 1, w = 1024, h = 1024, seed = 7) {
    if (this.cache[key]) return this.cache[key];
    if (!this.hi) { w = Math.max(64, w >> 2); h = Math.max(64, h >> 2); }
    const c = this.canvas(w, h), g = c.getContext('2d'), id = g.createImageData(w, h), d = id.data;
    const hc = this.canvas(w, h), hg = hc.getContext('2d'), hd = hg.createImageData(w, h), hdd = hd.data;
    const B = hex(base), D = hex(dark);
    const ph = h / planks;
    const knots = [];
    const r = this.rnd(seed);
    for (let p = 0; p < planks; p++) for (let k = 0; k < 2; k++) if (r() < 0.55) knots.push([r() * w, p * ph + ph * (0.25 + r() * 0.5), 10 + r() * 16]);
    for (let y = 0; y < h; y++) {
      const plank = Math.floor(y / ph), yy = y - plank * ph;
      const pr = hash(plank, 3, seed), shift = pr * 400;
      const tone = 0.86 + pr * 0.22;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const xx = x + shift;
        const warp = vnoise(xx / 220, yy / 18, seed) * 16 + vnoise(xx / 60, yy / 6, seed + 1) * 2.2;
        let gy = yy + warp;
        for (let k = 0; k < knots.length; k++) {
          const kn = knots[k];
          if (Math.abs(y - kn[1]) > kn[2] * 3) continue;
          const dx = (x - kn[0]) / (kn[2] * 3), dy = (y - kn[1]) / kn[2];
          const dd = dx * dx + dy * dy;
          if (dd < 9) gy += (kn[1] - y) * Math.exp(-dd) * 0.9 + Math.sqrt(dd) * kn[2] * 0.6 * Math.exp(-dd);
        }
        const ring = Math.sin(gy * (0.55 + pr * 0.2) + pr * 9);
        const line = Math.pow(0.5 + 0.5 * ring, 6);
        const fine = hash(x, y, seed) - 0.5;
        const streak = vnoise(xx / 300, yy / 2.5, seed + 5) - 0.5;
        let k = tone * (1 - line * 0.32 + streak * 0.14 + fine * 0.05);
        let hgt = 0.55 - line * 0.35 + fine * 0.08 + streak * 0.1;
        if (planks > 1 && (yy < 2.5 || yy > ph - 1.5)) { k *= 0.35; hgt = 0.05; }
        const t = clamp(line * 0.55, 0, 1);
        d[i] = clamp((B[0] + (D[0] - B[0]) * t) * k, 0, 255);
        d[i + 1] = clamp((B[1] + (D[1] - B[1]) * t) * k, 0, 255);
        d[i + 2] = clamp((B[2] + (D[2] - B[2]) * t) * k, 0, 255);
        d[i + 3] = 255;
        hdd[i] = hdd[i + 1] = hdd[i + 2] = clamp(hgt, 0, 1) * 255; hdd[i + 3] = 255;
      }
    }
    g.putImageData(id, 0, 0); hg.putImageData(hd, 0, 0);
    // すり傷
    for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h, l = 20 + r() * 90, a = r() * 6; hg.strokeStyle = 'rgba(0,0,0,0.55)'; hg.lineWidth = 1; hg.beginPath(); hg.moveTo(x, y); hg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); hg.stroke(); g.strokeStyle = 'rgba(255,230,190,0.06)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    const res = { map: c, normal: this.normalFrom(hc, 3) };
    return (this.cache[key] = res);
  },
  felt() {
    if (this.cache.felt) return this.cache.felt;
    const w = this.hi ? 1024 : 256, c = this.canvas(w, w), g = c.getContext('2d'), r = this.rnd(3);
    g.fillStyle = '#17402a'; g.fillRect(0, 0, w, w);
    const id = g.getImageData(0, 0, w, w), d = id.data;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, n = fbm(x / 90, y / 90, 3, 3) - 0.5, f = (hash(x, y, 9) - 0.5) * 0.18;
      const k = 1 + n * 0.35 + f;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
    g.putImageData(id, 0, 0);
    for (let i = 0; i < 9; i++) {
      const x = r() * w, y = r() * w, rad = 20 + r() * 70;
      const gr = g.createRadialGradient(x, y, rad * 0.4, x, y, rad);
      gr.addColorStop(0, 'rgba(10,20,5,0)'); gr.addColorStop(0.85, 'rgba(10,20,5,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 5; i++) { const x = r() * w, y = r() * w; g.fillStyle = 'rgba(25,12,0,0.75)'; g.beginPath(); g.arc(x, y, 4 + r() * 5, 0, Math.PI * 2); g.fill(); }
    const vg = g.createRadialGradient(w / 2, w / 2, w * 0.25, w / 2, w / 2, w * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = vg; g.fillRect(0, 0, w, w);
    const hc = this.canvas(256, 256), hg = hc.getContext('2d'), hd = hg.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) { const v = 100 + hash(i, 7, 2) * 80; hd.data[i * 4] = hd.data[i * 4 + 1] = hd.data[i * 4 + 2] = v; hd.data[i * 4 + 3] = 255; }
    hg.putImageData(hd, 0, 0);
    return (this.cache.felt = { map: c, normal: this.normalFrom(hc, 1.2) });
  },
  wall() {
    if (this.cache.wall) return this.cache.wall;
    const w = this.hi ? 1024 : 256, h = w, c = this.canvas(w, h), g = c.getContext('2d'), r = this.rnd(11);
    const hc = this.canvas(w, h), hg = hc.getContext('2d');
    g.fillStyle = '#2a1a12'; g.fillRect(0, 0, w, h); hg.fillStyle = '#808080'; hg.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) { g.fillStyle = x % 128 ? '#3a2418' : '#33201a'; g.fillRect(x, 0, 64, h * 0.62); }
    for (let y = 32; y < h * 0.6; y += 96) for (let x = 32; x < w; x += 128) {
      const ox = x + ((y / 96) % 2) * 64;
      g.fillStyle = 'rgba(170,120,60,0.13)'; g.beginPath(); g.ellipse(ox, y, 16, 28, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(170,120,60,0.1)'; g.lineWidth = 3; g.beginPath(); g.arc(ox, y, 34, 0, Math.PI * 2); g.stroke();
    }
    const wood = this.wood('wallwood', '#3b2416', '#1c0f08', 1, 1024, 512, 21);
    g.drawImage(wood.map, 0, h * 0.62, w, h * 0.38);
    hg.drawImage(wood.map, 0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#1c100a'; g.fillRect(0, h * 0.6, w, 20); hg.fillStyle = '#fff'; hg.fillRect(0, h * 0.6, w, 8);
    for (let x = 0; x < w; x += 256) { g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 6; g.strokeRect(x + 24, h * 0.67, 208, h * 0.27); hg.strokeStyle = '#000'; hg.lineWidth = 6; hg.strokeRect(x + 24, h * 0.67, 208, h * 0.27); }
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.1})`; g.fillRect(r() * w, r() * h, 2, 2); }
    // water stains
    for (let i = 0; i < 5; i++) { const x = r() * w, y = r() * h * 0.5; const gr = g.createLinearGradient(x, y, x, y + 300); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 20 - r() * 30, y, 50 + r() * 60, 300); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.4, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    return (this.cache.wall = { map: c, normal: this.normalFrom(hc, 2) });
  },
  roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); },
  cardBack() {
    if (this.cache.back) return this.cache.back;
    const S = 2, w = 256 * S, h = 368 * S, c = this.canvas(w, h), g = c.getContext('2d');
    g.scale(S, S);
    this.roundRect(g, 2, 2, 252, 364, 22); g.fillStyle = '#efe6d2'; g.fill();
    this.roundRect(g, 14, 14, 228, 340, 14); g.fillStyle = '#5a1018'; g.fill();
    g.save(); this.roundRect(g, 14, 14, 228, 340, 14); g.clip();
    g.strokeStyle = 'rgba(214,170,90,0.55)'; g.lineWidth = 1.6;
    for (let i = -368; i < 256 + 368; i += 14) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 368, 368); g.stroke(); g.beginPath(); g.moveTo(i, 368); g.lineTo(i + 368, 0); g.stroke(); }
    g.restore();
    g.strokeStyle = '#d6aa5a'; g.lineWidth = 3; this.roundRect(g, 22, 22, 212, 324, 10); g.stroke();
    g.lineWidth = 1; this.roundRect(g, 27, 27, 202, 314, 8); g.stroke();
    g.save(); g.translate(128, 184);
    g.fillStyle = '#2a0508'; g.strokeStyle = '#d6aa5a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, -62); g.lineTo(46, 0); g.lineTo(0, 62); g.lineTo(-46, 0); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-30, 0); g.quadraticCurveTo(0, -24, 30, 0); g.quadraticCurveTo(0, 24, -30, 0); g.fillStyle = '#efe6d2'; g.fill();
    g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fillStyle = '#5a1018'; g.fill();
    g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fillStyle = '#000'; g.fill();
    g.restore();
    return (this.cache.back = c);
  },
  glyph(g, type, s) {
    g.save();
    if (type === 'K') {
      g.fillStyle = '#b8862b'; g.strokeStyle = '#3a2508'; g.lineWidth = 3 * s;
      g.beginPath(); g.moveTo(-40 * s, 22 * s); g.lineTo(-46 * s, -24 * s); g.lineTo(-22 * s, -2 * s); g.lineTo(0, -34 * s); g.lineTo(22 * s, -2 * s); g.lineTo(46 * s, -24 * s); g.lineTo(40 * s, 22 * s); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#8e1b22'; for (const x of [-24, 0, 24]) { g.beginPath(); g.arc(x * s, 10 * s, 5 * s, 0, Math.PI * 2); g.fill(); }
    } else if (type === 'Q') {
      g.fillStyle = '#8e1b22'; g.strokeStyle = '#3a0508'; g.lineWidth = 2.5 * s;
      for (let i = 0; i < 5; i++) { g.save(); g.rotate(i * Math.PI * 2 / 5); g.beginPath(); g.ellipse(0, -18 * s, 14 * s, 20 * s, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore(); }
      g.beginPath(); g.arc(0, 0, 13 * s, 0, Math.PI * 2); g.fillStyle = '#b8262e'; g.fill(); g.stroke();
      g.beginPath(); g.arc(0, 0, 5 * s, 0, Math.PI * 1.6); g.stroke();
    } else if (type === 'A') {
      g.fillStyle = '#1d1a14'; g.strokeStyle = '#b8862b'; g.lineWidth = 3 * s;
      g.beginPath();
      for (let i = 0; i < 16; i++) { const r = (i % 2 ? 16 : 44) * s, a = i * Math.PI / 8 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.arc(0, 0, 8 * s, 0, Math.PI * 2); g.fillStyle = '#b8862b'; g.fill();
    } else {
      g.lineWidth = 3 * s; g.strokeStyle = '#1a1a1a';
      g.beginPath(); g.arc(0, 0, 40 * s, Math.PI / 2, Math.PI * 1.5); g.fillStyle = '#6a2a8a'; g.fill();
      g.beginPath(); g.arc(0, 0, 40 * s, -Math.PI / 2, Math.PI / 2); g.fillStyle = '#c99a25'; g.fill();
      g.beginPath(); g.arc(0, 0, 40 * s, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#111';
      g.beginPath(); g.ellipse(-15 * s, -8 * s, 7 * s, 10 * s, 0.3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(15 * s, -8 * s, 7 * s, 10 * s, -0.3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(-24 * s, 12 * s); g.quadraticCurveTo(0, 36 * s, 24 * s, 12 * s); g.quadraticCurveTo(0, 24 * s, -24 * s, 12 * s); g.fill();
    }
    g.restore();
  },
  cardFace(type) {
    const key = 'face' + type;
    if (this.cache[key]) return this.cache[key];
    const S = 2, w = 256 * S, h = 368 * S, c = this.canvas(w, h), g = c.getContext('2d'), r = this.rnd(type.charCodeAt(0));
    g.scale(S, S);
    this.roundRect(g, 2, 2, 252, 364, 22); g.fillStyle = '#f1e8d4'; g.fill();
    g.save(); this.roundRect(g, 2, 2, 252, 364, 22); g.clip();
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(90,60,20,${r() * 0.06})`; g.fillRect(r() * 256, r() * 368, 1.5, 1.5); }
    const vg = g.createRadialGradient(128, 184, 60, 128, 184, 220); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(90,60,20,0.25)');
    g.fillStyle = vg; g.fillRect(0, 0, 256, 368); g.restore();
    const col = type === 'J' ? '#4a1a6a' : (type === 'Q' ? '#8e1b22' : '#1d1a14');
    g.strokeStyle = col; g.lineWidth = 3; this.roundRect(g, 16, 16, 224, 336, 12); g.stroke();
    g.lineWidth = 1; this.roundRect(g, 22, 22, 212, 324, 9); g.stroke();
    const label = type === 'J' ? 'J' : type;
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 46px Georgia, "Times New Roman", serif';
    g.fillText(label, 44, 52);
    g.save(); g.translate(212, 316); g.rotate(Math.PI); g.fillText(label, 0, 0); g.restore();
    g.save(); g.translate(128, 150); this.glyph(g, type, 1.25); g.restore();
    g.font = type === 'J' ? 'bold 40px Georgia, serif' : 'bold 92px Georgia, "Times New Roman", serif';
    g.fillText(type === 'J' ? 'JOKER' : label, 128, 260);
    return (this.cache[key] = c);
  },
  die(n) {
    const key = 'die' + n;
    if (this.cache[key]) return this.cache[key];
    const s = 256, c = this.canvas(s, s), g = c.getContext('2d');
    g.fillStyle = '#efe7d6'; g.fillRect(0, 0, s, s);
    const vg = g.createRadialGradient(s / 2, s / 2, 60, s / 2, s / 2, 190); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,40,10,0.35)');
    g.fillStyle = vg; g.fillRect(0, 0, s, s);
    const P = { 1: [[0.5, 0.5]], 2: [[0.27, 0.27], [0.73, 0.73]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]], 4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]], 6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]] };
    for (const [x, y] of P[n]) {
      const rr = n === 1 ? 30 : 22;
      const gr = g.createRadialGradient(x * s - 3, y * s - 3, 2, x * s, y * s, rr);
      gr.addColorStop(0, n === 1 ? '#5a0008' : '#000'); gr.addColorStop(0.85, n === 1 ? '#b0141c' : '#1e1a12'); gr.addColorStop(1, 'rgba(0,0,0,0.3)');
      g.fillStyle = gr; g.beginPath(); g.arc(x * s, y * s, rr, 0, Math.PI * 2); g.fill();
    }
    return (this.cache[key] = c);
  },
  bottleLabel(seed) {
    const c = this.canvas(256, 256), g = c.getContext('2d'), r = this.rnd(seed + 1);
    g.fillStyle = ['#d8c79a', '#c8b07a', '#e8dcc0', '#b89a5a'][seed % 4]; g.fillRect(0, 0, 256, 256);
    g.fillStyle = ['#5a1018', '#1a3a20', '#1d1a14', '#2a2a6a'][seed % 4];
    g.fillRect(0, 40, 256, 28); g.fillRect(0, 188, 256, 16);
    g.font = 'bold 44px Georgia'; g.textAlign = 'center'; g.fillText(['RUM', 'GIN', 'XXX', 'RYE'][seed % 4], 128, 140);
    for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.1})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
    return c;
  },
  skullLabel() {
    if (this.cache.skull) return this.cache.skull;
    const c = this.canvas(256, 256), g = c.getContext('2d');
    g.scale(2, 2);
    g.fillStyle = '#d9cfb0'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#1a1a1a';
    g.beginPath(); g.arc(64, 54, 26, 0, Math.PI * 2); g.fill();
    g.fillRect(48, 70, 32, 18);
    g.fillStyle = '#d9cfb0';
    g.beginPath(); g.arc(54, 52, 7, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(74, 52, 7, 0, Math.PI * 2); g.fill();
    g.fillRect(56, 78, 3, 10); g.fillRect(63, 78, 3, 10); g.fillRect(70, 78, 3, 10);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(30, 96); g.lineTo(98, 116); g.moveTo(98, 96); g.lineTo(30, 116); g.stroke();
    return (this.cache.skull = c);
  },

  // ---- 人物用 ----
  // 肌（顔のUVに合わせて頬の赤み・唇・ひげの青み・しわを描く）
  skin(ci, C) {
    const key = 'skin' + ci;
    if (this.cache[key]) return this.cache[key];
    const P = HEADS[ci];
    const W = this.hi ? 1024 : 512, H = W / 2;
    const c = this.canvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H), d = id.data;
    const hc = this.canvas(W, H), hg = hc.getContext('2d'), hd = hg.createImageData(W, H), hdd = hd.data;
    const base = hex(C.skin), lip = hex(C.lip), stub = hex(C.hair);
    facePixels(W, H, (px, py, x, y, z) => {
        const i = (py * W + px) * 4;
        let r = base[0], gg = base[1], b = base[2];
        const n = fbm(px / 40, py / 40, ci * 7, 2) - 0.5;
        const pore = hash(px, py, ci) - 0.5;
        let k = 1 + n * 0.08 + pore * 0.035;
        let height = 0.5 + pore * 0.25 + n * 0.2;
        if (z > -0.4) {
          const M = faceMasks(x, y, z, P);
          const red = 0.3 * M.cheeks + 0.38 * M.noseTip + 0.25 * M.ears;
          r += red * 26; gg -= red * 8; b -= red * 4;
          k -= 0.10 * M.socket;
          if (M.lips > 0.02) { const t = clamp(M.lips * 1.3, 0, 1) * C.lipAmt; r = lerp3(r, lip[0], t); gg = lerp3(gg, lip[1], t); b = lerp3(b, lip[2], t); height += M.lips * 0.1; }
          if (C.stubble > 0) {
            const sm = clamp(M.jawBeard + M.mustache, 0, 1) * C.stubble;
            if (sm > 0.01) { const sp = hash(px * 3, py * 3, 5) < 0.55 ? 1 : 0.3; const t = sm * 0.35 * sp; r = lerp3(r, stub[0] * 0.6, t); gg = lerp3(gg, stub[1] * 0.6, t); b = lerp3(b, stub[2] * 0.7 + 10, t); }
          }
          if (P.age > 0.2) {
            const fl = M.forehead * (Math.sin(y * 120) > 0.75 ? 1 : 0) * P.age;
            const cf = M.crow * (Math.sin((y + x * 0.4) * 140) > 0.7 ? 1 : 0) * P.age;
            k -= (fl + cf) * 0.12; height -= (fl + cf) * 0.35;
          }
          if (C.blush) { r += M.cheeks * 22 * C.blush; gg -= M.cheeks * 6; }
          if (C.eyeShadow) { const es = M.socket * smooth(0.05, 0.2, y); r = lerp3(r, 70, es * C.eyeShadow); gg = lerp3(gg, 40, es * C.eyeShadow); b = lerp3(b, 50, es * C.eyeShadow); }
        }
        d[i] = clamp(r * k, 0, 255); d[i + 1] = clamp(gg * k, 0, 255); d[i + 2] = clamp(b * k, 0, 255); d[i + 3] = 255;
        const hv = clamp(height, 0, 1) * 255; hdd[i] = hdd[i + 1] = hdd[i + 2] = hv; hdd[i + 3] = 255;
    });
    g.putImageData(id, 0, 0); hg.putImageData(hd, 0, 0);
    return (this.cache[key] = { map: c, normal: this.normalFrom(hc, 1.6) });
  },
  // 手や首など顔以外の肌（タイル状）
  bodySkin(ci, C) {
    const key = 'bskin' + ci;
    if (this.cache[key]) return this.cache[key];
    const W = 256, c = this.canvas(W, W), g = c.getContext('2d'), id = g.createImageData(W, W), d = id.data;
    const hc = this.canvas(W, W), hg = hc.getContext('2d'), hd = hg.createImageData(W, W);
    const base = hex(C.skin);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, n = fbm(x / 30, y / 30, ci, 3) - 0.5, p = hash(x, y, ci + 3) - 0.5;
      const k = 1 + n * 0.08 + p * 0.03;
      d[i] = clamp(base[0] * k + 6, 0, 255); d[i + 1] = clamp(base[1] * k, 0, 255); d[i + 2] = clamp(base[2] * k, 0, 255); d[i + 3] = 255;
      const hv = 128 + p * 60 + n * 40; hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = hv; hd.data[i + 3] = 255;
    }
    g.putImageData(id, 0, 0); hg.putImageData(hd, 0, 0);
    return (this.cache[key] = { map: c, normal: this.normalFrom(hc, 1.2) });
  },
  // 眼球（虹彩・瞳孔・血管）。顔の正面方向（u=0.5）に虹彩が来る。
  eye(iris) {
    const key = 'eye' + iris;
    if (this.cache[key]) return this.cache[key];
    const W = 512, H = 256, c = this.canvas(W, H), g = c.getContext('2d'), r = this.rnd(iris.length * 31);
    g.fillStyle = '#f1ece4'; g.fillRect(0, 0, W, H);
    // veins
    g.strokeStyle = 'rgba(170,40,40,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 40; i++) { let x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 20; g.lineTo(x, y); } g.stroke(); }
    // shading to the sides
    const cx = W * 0.5, cy = H * 0.5;
    const sh = g.createRadialGradient(cx, cy, 20, cx, cy, W * 0.45); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(120,90,80,0.35)');
    g.fillStyle = sh; g.fillRect(0, 0, W, H);
    // iris (stretched horizontally because of sphere UV)
    g.save(); g.translate(cx, cy);
    const ir = 39;
    const ig = g.createRadialGradient(0, 0, 4, 0, 0, ir);
    const col = new THREE.Color(iris);
    const dk = col.clone().multiplyScalar(0.45), lt = col.clone().lerp(new THREE.Color(0xffffff), 0.25);
    ig.addColorStop(0, '#000'); ig.addColorStop(0.28, '#' + dk.getHexString()); ig.addColorStop(0.55, '#' + lt.getHexString()); ig.addColorStop(0.9, '#' + col.getHexString()); ig.addColorStop(1, '#1a1410');
    g.fillStyle = ig; g.beginPath(); g.arc(0, 0, ir, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.8;
    for (let i = 0; i < 70; i++) { const a = r() * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * 10, Math.sin(a) * 10); g.lineTo(Math.cos(a + 0.1) * ir * 0.95, Math.sin(a + 0.1) * ir * 0.95); g.stroke(); }
    g.fillStyle = '#050403'; g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.0)';
    g.restore();
    return (this.cache[key] = c);
  },
  // 髪・ひげ・眉（顔のUVに合わせたマスク。毛の流れを細い線で描く）
  hairMask(ci, C, kind, side = 0) {
    const key = 'hm' + ci + kind + side;
    if (this.cache[key]) return this.cache[key];
    const P = HEADS[ci];
    const W = (this.hi && kind !== 'brow') ? 1024 : 512, H = W / 2;
    const c = this.canvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H), d = id.data;
    const col = hex(kind === 'brow' ? (C.brow || C.hair) : C.hair);
    const lipsW = 0.22 + 0.03 * P.lips;
    facePixels(W, H, (px, py, x, y, z) => {
        const i = (py * W + px) * 4;
        let a = 0;
        const ax = Math.abs(x);
        if (kind === 'scalp') {
          // 生え際: 前は高く、耳の上で下がり、うなじまで
          const front = smooth(-0.1, 0.6, z);
          const line = lerp3(-0.62, 0.40 + 0.12 * smooth(0.2, 0.55, ax) * (C.recede || 0.5), front);
          const aroundEar = gauss(ax - 0.96, 0.14) * gauss(y + 0.05, 0.22);
          a = smooth(line - 0.02, line + 0.05, y) * (1 - aroundEar * 0.95);
        } else if (kind === 'beard') {
          if (y > 0.05 || z < -0.35) { d[i + 3] = 0; return; }
          const front = smooth(0.15, 0.75, z);
          const lipsX = gauss(x, lipsW);
          let jb = 0, mu = 0;
          if (C.beard) jb = smooth(-0.1, -0.35, y + 0.25 * (1 - ax)) * smooth(-0.2, 0.25, z) * (1 - front * lipsX * gauss(y + 0.55, 0.09));
          if (C.mustache) mu = front * gauss(x, 0.32) * gauss(y + 0.415, 0.05) * (1 - gauss(x, 0.04) * 0.4);
          a = clamp(jb * 1.2 + mu * 1.6, 0, 1);
          if (!C.beard) a *= smooth(0.2, 0.4, z);
        } else {
          if (y < 0.15 || y > 0.5 || z < 0.3 || side * x <= 0) { d[i + 3] = 0; return; }
          const front = smooth(0.15, 0.75, z);
          const bm = front * gauss(y - 0.30 - 0.04 * Math.cos((ax - 0.38) * 4), 0.035) * smooth(0.1, 0.18, ax) * smooth(0.66, 0.56, ax);
          a = clamp(bm * 1.6 * (C.browThick || 1), 0, 1);
        }
        if (a < 0.02) { d[i + 3] = 0; return; }
        const strand = kind === 'brow' ? hash(Math.floor(px / 1.5), Math.floor(py / 3), 3) : hash(px, Math.floor(py / 6), ci + 11);
        const fine = 0.6 + 0.4 * strand;
        const shade = 0.7 + 0.5 * (vnoise(px / 50, py / 50, ci) - 0.5) + (kind === 'scalp' ? 0.25 * Math.sin(px * 0.9 + strand * 4) : 0);
        const gr = C.gray ? 60 * strand : 0;
        d[i] = clamp(col[0] * fine * shade + gr, 0, 255);
        d[i + 1] = clamp(col[1] * fine * shade + gr, 0, 255);
        d[i + 2] = clamp(col[2] * fine * shade + gr, 0, 255);
        const edgeNoise = kind === 'scalp' ? 0.9 : (0.55 + 0.6 * hash(px * 2, py * 2, 7));
        d[i + 3] = clamp(a * edgeNoise * 255 * (kind === 'beard' ? 1.25 : 1.1), 0, 255);
    });
    g.putImageData(id, 0, 0);
    return (this.cache[key] = c);
  },
  hairStrands(col, key) {
    if (this.cache['hs' + key]) return this.cache['hs' + key];
    const W = 512, c = this.canvas(W, W), g = c.getContext('2d'), r = this.rnd(key.length * 13 + 5);
    const cc = new THREE.Color(col);
    g.fillStyle = '#' + cc.getHexString(); g.fillRect(0, 0, W, W);
    for (let i = 0; i < 2600; i++) {
      const x = r() * W, l = 60 + r() * 200, y = r() * W;
      const k = 0.6 + r() * 0.8;
      g.strokeStyle = `rgba(${cc.r * 255 * k | 0},${cc.g * 255 * k | 0},${cc.b * 255 * k | 0},0.5)`;
      g.lineWidth = 0.6 + r() * 1.4;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (r() - 0.5) * 20, y + l * 0.3, x + (r() - 0.5) * 20, y + l * 0.6, x + (r() - 0.5) * 16, y + l); g.stroke();
    }
    return (this.cache['hs' + key] = c);
  },
  // 布地: suit(ヘリンボーン/ピンストライプ), plaid(チェック), velvet, knit, felt, dress
  fabric(kind, color, key) {
    const ck = 'fab' + kind + color + (key || '');
    if (this.cache[ck]) return this.cache[ck];
    const W = this.hi ? 512 : 128, c = this.canvas(W, W), g = c.getContext('2d'), id = g.createImageData(W, W), d = id.data;
    const hc = this.canvas(W, W), hg = hc.getContext('2d'), hd = hg.createImageData(W, W), hdd = hd.data;
    const base = hex(color), alt = hex(key || '#d9cbb0');
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let k = 1, h = 0.5, mix = 0;
      const n = fbm(x / 60, y / 60, 4, 2) - 0.5;
      if (kind === 'suit') {
        const tw = ((x + y) % 6 < 3) ? 0.06 : -0.06;
        k = 1 + tw + n * 0.08; h = 0.5 + tw * 3;
        if (key && x % 48 < 2) mix = 0.35;
      } else if (kind === 'plaid') {
        const bx = Math.floor(x / 32) % 4, by = Math.floor(y / 32) % 4;
        const band = (bx === 1 ? 0.5 : 0) + (by === 1 ? 0.5 : 0);
        mix = band * 0.8;
        if (x % 32 < 3 || y % 32 < 3) mix = Math.max(mix, 0.15);
        const tw = ((x + y) % 4 < 2) ? 0.05 : -0.05; k = 1 + tw + n * 0.06; h = 0.5 + tw * 3;
      } else if (kind === 'velvet') {
        k = 1 + n * 0.25 + (hash(x, y, 2) - 0.5) * 0.06; h = 0.5 + (hash(x, y, 2) - 0.5) * 0.2;
      } else if (kind === 'knit') {
        const rib = Math.sin(x * 0.8) * 0.5 + 0.5, row = Math.sin(y * 0.5 + Math.sin(x * 0.8) * 1.2);
        k = 0.82 + rib * 0.25 + row * 0.05; h = rib * 0.6 + row * 0.2 + 0.2;
      } else if (kind === 'shirt') {
        const tw = ((x + y) % 2) ? 0.03 : -0.03; k = 1 + tw + n * 0.04; h = 0.5 + tw * 4;
      } else if (kind === 'felt') {
        k = 1 + n * 0.18 + (hash(x, y, 8) - 0.5) * 0.08; h = 0.5 + (hash(x, y, 8) - 0.5) * 0.3;
      } else if (kind === 'leather') {
        const cell = fbm(x / 9, y / 9, 6, 2); k = 0.85 + cell * 0.3 + n * 0.1; h = cell;
      }
      d[i] = clamp(lerp3(base[0], alt[0], mix) * k, 0, 255); d[i + 1] = clamp(lerp3(base[1], alt[1], mix) * k, 0, 255); d[i + 2] = clamp(lerp3(base[2], alt[2], mix) * k, 0, 255); d[i + 3] = 255;
      hdd[i] = hdd[i + 1] = hdd[i + 2] = clamp(h, 0, 1) * 255; hdd[i + 3] = 255;
    }
    g.putImageData(id, 0, 0); hg.putImageData(hd, 0, 0);
    return (this.cache[ck] = { map: c, normal: this.normalFrom(hc, kind === 'knit' ? 3 : 1.5) });
  },
  // 胸元のVゾーン（シャツ＋ネクタイ / 肌＋ネックレス / チェックシャツ）
  vzone(kind, shirtCol, tieCol) {
    const key = 'vz' + kind + shirtCol + tieCol;
    if (this.cache[key]) return this.cache[key];
    const W = 256, H = 512, c = this.canvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    // V shape: wide at top (y=0), narrowing to bottom point at y≈0.62H
    const vb = kind === 'vest' ? 0.78 : 0.62;
    g.beginPath(); g.moveTo(W * 0.02, 0); g.lineTo(W * 0.98, 0); g.lineTo(W * 0.5, H * vb); g.closePath();
    if (kind === 'skin') {
      g.fillStyle = shirtCol; g.fill();
      g.strokeStyle = '#d9b26a'; g.lineWidth = 3; g.beginPath(); g.moveTo(W * 0.28, H * 0.02); g.quadraticCurveTo(W * 0.5, H * 0.3, W * 0.72, H * 0.02); g.stroke();
      g.fillStyle = '#c9a14a'; g.beginPath(); g.arc(W * 0.5, H * 0.17, 7, 0, Math.PI * 2); g.fill();
    } else {
      const f = this.fabric(kind === 'plaid' ? 'plaid' : 'shirt', shirtCol, kind === 'plaid' ? tieCol : undefined);
      g.save(); g.clip(); g.drawImage(f.map, 0, 0, W, H); g.restore();
      if (kind !== 'plaid') {
        // collar
        g.fillStyle = '#f4efe6';
        g.beginPath(); g.moveTo(W * 0.2, 0); g.lineTo(W * 0.5, H * 0.1); g.lineTo(W * 0.36, H * 0.13); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(W * 0.8, 0); g.lineTo(W * 0.5, H * 0.1); g.lineTo(W * 0.64, H * 0.13); g.closePath(); g.fill();
        if (kind === 'tie') {
          g.fillStyle = tieCol;
          g.beginPath(); g.moveTo(W * 0.44, H * 0.08); g.lineTo(W * 0.56, H * 0.08); g.lineTo(W * 0.535, H * 0.15); g.lineTo(W * 0.465, H * 0.15); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(W * 0.465, H * 0.15); g.lineTo(W * 0.535, H * 0.15); g.lineTo(W * 0.58, H * 0.6); g.lineTo(W * 0.5, H * 0.66); g.lineTo(W * 0.42, H * 0.6); g.closePath(); g.fill();
          g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2;
          for (let y = H * 0.2; y < H * 0.6; y += 14) { g.beginPath(); g.moveTo(W * 0.43, y); g.lineTo(W * 0.57, y + 10); g.stroke(); }
        } else if (kind === 'bow' || kind === 'vest') {
          g.fillStyle = tieCol;
          g.beginPath(); g.moveTo(W * 0.5, H * 0.11); g.lineTo(W * 0.32, H * 0.06); g.lineTo(W * 0.32, H * 0.17); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(W * 0.5, H * 0.11); g.lineTo(W * 0.68, H * 0.06); g.lineTo(W * 0.68, H * 0.17); g.closePath(); g.fill();
          g.beginPath(); g.arc(W * 0.5, H * 0.11, 9, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = H * 0.22; y < H * 0.7; y += 46) { g.beginPath(); g.arc(W * 0.5, y, 4, 0, Math.PI * 2); g.fill(); }
        }
      }
    }
    // lapel shadow edge
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(W * 0.02, 0); g.lineTo(W * 0.5, H * vb); g.lineTo(W * 0.98, 0); g.stroke();
    return (this.cache[key] = c);
  },
  // グリップのチェッカリング（ひし形の滑り止め）用の法線マップ
  checker() {
    if (this.cache.checker) return this.cache.checker;
    const W = 128, hc = this.canvas(W, W), g = hc.getContext('2d'), id = g.createImageData(W, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const a = ((x + y) % 16) / 16, b = ((x - y + 256) % 16) / 16;
      const v = Math.min(Math.abs(a - 0.5), Math.abs(b - 0.5)) * 2;
      const i = (y * W + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = v * 255; id.data[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return (this.cache.checker = this.normalFrom(hc, 4));
  },
  flash() {
    if (this.cache.flash) return this.cache.flash;
    const c = this.canvas(128, 128), x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,200,90,0.85)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    // spikes
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.3; x.strokeStyle = 'rgba(255,220,140,0.6)'; x.lineWidth = 3; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * 64, 64 + Math.sin(a) * 64); x.stroke(); }
    return (this.cache.flash = c);
  },
  blood() {
    if (this.cache.blood) return this.cache.blood;
    const c = this.canvas(512, 512), x = c.getContext('2d'), r = this.rnd(77);
    for (let i = 0; i < 16; i++) {
      const a = r() * 6.28, rr = r() * 100;
      const cx = 256 + Math.cos(a) * rr, cy = 256 + Math.sin(a) * rr, rad = 60 + r() * 100;
      const gr = x.createRadialGradient(cx, cy, rad * 0.5, cx, cy, rad);
      gr.addColorStop(0, 'rgba(70,2,6,1)'); gr.addColorStop(0.9, 'rgba(55,0,4,0.95)'); gr.addColorStop(1, 'rgba(40,0,3,0)');
      x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
    }
    return (this.cache.blood = c);
  },
};
function lerp3(a, b, t) { return a + (b - a) * t; }
