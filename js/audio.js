// 効果音はすべて Web Audio で合成（音声ファイル不要）
export const Snd = {
  ctx: null, master: null, rev: null, revIn: null, muted: false, noiseBuf: null, amb: null, hbTimer: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(c.destination);
    // reverb
    const len = c.sampleRate * 2.2, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.rev = c.createConvolver(); this.rev.buffer = ir;
    this.revIn = c.createGain(); this.revIn.gain.value = 0.5;
    this.revIn.connect(this.rev); this.rev.connect(this.master);
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    this.startAmbience();
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05); },
  t() { return this.ctx ? this.ctx.currentTime : 0; },
  out(gain = 1, rev = 0.2) {
    const c = this.ctx, g = c.createGain(); g.gain.value = gain; g.connect(this.master);
    if (rev > 0) { const s = c.createGain(); s.gain.value = rev; g.connect(s); s.connect(this.revIn); }
    return g;
  },
  noise(dest, t0, dur, filt, f, q, env) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const fl = c.createBiquadFilter(); fl.type = filt; fl.frequency.value = f; fl.Q.value = q || 1;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(fl); fl.connect(g); g.connect(dest);
    env(g.gain, t0, fl);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
    return { src, fl, g };
  },
  tone(dest, t0, dur, type, f0, f1, peak, att = 0.005) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + att); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  },
  ok() { return !!this.ctx && !this.muted; },

  startAmbience() {
    const c = this.ctx;
    // low room tone + distant hum
    const g = c.createGain(); g.gain.value = 0.05; g.connect(this.master);
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    src.connect(lp); lp.connect(g); src.start();
    const hum = c.createOscillator(); hum.frequency.value = 55; const hg = c.createGain(); hg.gain.value = 0.012;
    hum.connect(hg); hg.connect(this.master); hum.start();
    this.amb = { g, hg };
    const clink = () => {
      if (!this.ctx) return;
      if (!this.muted && Math.random() < 0.6) { const t = this.t(); const o = this.out(0.025, 0.8); this.tone(o, t, 0.5, 'sine', 2400 + Math.random() * 1500, 0, 0.5, 0.002); }
      setTimeout(clink, 4000 + Math.random() * 9000);
    };
    setTimeout(clink, 5000);
  },
  duckAmbience(v) { if (this.amb) { this.amb.g.gain.setTargetAtTime(0.05 * v, this.t(), 0.3); } },

  click() { if (!this.ok()) return; const t = this.t(); const o = this.out(0.25, 0); this.tone(o, t, 0.05, 'square', 900, 500, 0.3, 0.001); },
  card() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.5, 0.15);
    this.noise(o, t, 0.12, 'bandpass', 2500, 0.8, (g) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.9, t + 0.005); g.exponentialRampToValueAtTime(0.001, t + 0.1); });
  },
  flip() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.4, 0.1);
    this.noise(o, t, 0.15, 'highpass', 3000, 0.7, (g, t0, fl) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.6, t + 0.04); g.exponentialRampToValueAtTime(0.001, t + 0.14); fl.frequency.linearRampToValueAtTime(6000, t + 0.14); });
  },
  slam(v = 1) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.9 * v, 0.35);
    this.tone(o, t, 0.35, 'sine', 120, 45, 1, 0.003);
    this.noise(o, t, 0.25, 'lowpass', 600, 1, (g) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + 0.004); g.exponentialRampToValueAtTime(0.001, t + 0.22); });
    // rattling glasses
    for (let i = 0; i < 4; i++) this.tone(o, t + 0.03 + i * 0.03, 0.2, 'sine', 3000 + Math.random() * 2000, 0, 0.04, 0.002);
  },
  stinger() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.22, 0.6);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2500, t + 0.15); lp.frequency.exponentialRampToValueAtTime(400, t + 1.4);
    lp.connect(o);
    for (const f of [110, 116.5, 164.8, 220]) this.tone(lp, t, 1.6, 'sawtooth', f, f * 0.97, 0.5, 0.02);
  },
  heartbeat(v = 1) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.9 * v, 0.05);
    this.tone(o, t, 0.18, 'sine', 70, 40, 1, 0.01);
    this.tone(o, t + 0.22, 0.16, 'sine', 60, 35, 0.7, 0.01);
  },
  heartbeatLoop(bpm, dur, v = 1, accel = 0) {
    this.stopHeartbeat();
    let t = 0; let b = bpm;
    const step = () => {
      if (t >= dur) return;
      this.heartbeat(v);
      const iv = 60000 / b; t += iv; b += accel;
      this.hbTimer = setTimeout(step, iv);
    };
    step();
  },
  stopHeartbeat() { if (this.hbTimer) clearTimeout(this.hbTimer); this.hbTimer = 0; },
  spin() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.35, 0.2);
    let tt = t;
    for (let i = 0; i < 14; i++) {
      const dt = 0.035 + i * i * 0.0012;
      this.noise(o, tt, 0.03, 'bandpass', 4200, 6, (g) => { g.setValueAtTime(0, tt); g.linearRampToValueAtTime(0.8, tt + 0.001); g.exponentialRampToValueAtTime(0.001, tt + 0.025); });
      tt += dt;
    }
  },
  // シリンダーを振り出す「カチャ」
  swing() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.55, 0.25);
    this.noise(o, t, 0.06, 'bandpass', 2400, 4, (g) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.9, t + 0.001); g.exponentialRampToValueAtTime(0.001, t + 0.05); });
    this.noise(o, t + 0.05, 0.08, 'bandpass', 1500, 3, (g) => { g.setValueAtTime(0, t + 0.05); g.linearRampToValueAtTime(0.7, t + 0.052); g.exponentialRampToValueAtTime(0.001, t + 0.12); });
  },
  // シリンダーが回るラチェット音（だんだん遅くなる）
  spinLong(dur = 1.2) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.42, 0.2);
    let tt = t, dt = 0.022;
    while (tt - t < dur) {
      const q = tt;
      this.noise(o, q, 0.025, 'bandpass', 3800 + Math.random() * 800, 7, (g) => { g.setValueAtTime(0, q); g.linearRampToValueAtTime(0.8, q + 0.0008); g.exponentialRampToValueAtTime(0.001, q + 0.02); });
      tt += dt; dt *= 1.075;
    }
  },
  // シリンダーを戻す「ガチャン」
  clack() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.9, 0.35);
    this.noise(o, t, 0.09, 'bandpass', 1800, 2.5, (g) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + 0.001); g.exponentialRampToValueAtTime(0.001, t + 0.08); });
    this.tone(o, t, 0.12, 'triangle', 700, 300, 0.25, 0.001);
  },
  // カップを持ち上げる音
  cupLift() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.5, 0.2);
    this.noise(o, t, 0.25, 'bandpass', 900, 1.2, (g, t0, fl) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.5, t + 0.03); g.exponentialRampToValueAtTime(0.001, t + 0.22); fl.frequency.exponentialRampToValueAtTime(2400, t + 0.2); });
    this.rattle(0.15);
  },
  // 該当する目を数えるたびの音（だんだん高く）
  tick(n = 1) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.35, 0.35);
    const f = 660 * Math.pow(2, Math.min(n - 1, 18) / 12);
    this.tone(o, t, 0.35, 'triangle', f, 0, 0.6, 0.002); this.tone(o, t, 0.25, 'sine', f * 2, 0, 0.2, 0.002);
  },
  // 該当なし
  dud() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.35, 0.2);
    this.tone(o, t, 0.3, 'sine', 180, 120, 0.6, 0.01);
  },
  // 発表前のドラムロール
  drumroll(dur = 0.9) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.6, 0.3);
    const n = Math.floor(dur / 0.045);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.045, v = 0.25 + 0.6 * (i / n);
      this.noise(o, tt, 0.05, 'bandpass', 220, 1.5, (g) => { g.setValueAtTime(0, tt); g.linearRampToValueAtTime(v, tt + 0.003); g.exponentialRampToValueAtTime(0.001, tt + 0.045); });
    }
    this.tone(o, t + dur, 0.5, 'sine', 90, 45, 1, 0.004);
  },
  cock() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.6, 0.2);
    [0, 0.09].forEach((d, i) => this.noise(o, t + d, 0.05, 'bandpass', i ? 2600 : 1800, 5, (g) => { g.setValueAtTime(0, t + d); g.linearRampToValueAtTime(1, t + d + 0.001); g.exponentialRampToValueAtTime(0.001, t + d + 0.045); }));
  },
  dryFire() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(1.0, 0.4);
    this.noise(o, t, 0.08, 'bandpass', 3200, 8, (g) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + 0.0008); g.exponentialRampToValueAtTime(0.001, t + 0.07); });
    this.tone(o, t, 0.09, 'triangle', 1900, 1200, 0.25, 0.001);
  },
  gunshot(near = true) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(near ? 1.4 : 1.1, 0.9);
    // crack
    this.noise(o, t, 0.05, 'highpass', 1500, 0.7, (g) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(1.6, t + 0.0005); g.exponentialRampToValueAtTime(0.001, t + 0.045); });
    // body
    this.noise(o, t, 0.6, 'lowpass', 1800, 0.8, (g, t0, fl) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(1.4, t + 0.002); g.exponentialRampToValueAtTime(0.001, t + 0.55); fl.frequency.setValueAtTime(5000, t); fl.frequency.exponentialRampToValueAtTime(300, t + 0.4); });
    // thump
    this.tone(o, t, 0.3, 'sine', 140, 38, 1.5, 0.001);
    if (near) setTimeout(() => this.tinnitus(5), 120);
    this.duckAmbience(0.1); setTimeout(() => this.duckAmbience(1), 6000);
  },
  tinnitus(sec) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(1, 0);
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.frequency.value = 5800; osc.type = 'sine';
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + sec + 0.1);
  },
  thud() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.9, 0.3);
    this.tone(o, t, 0.4, 'sine', 90, 35, 1, 0.004);
    this.noise(o, t, 0.3, 'lowpass', 400, 1, (g) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.9, t + 0.006); g.exponentialRampToValueAtTime(0.001, t + 0.28); });
  },
  metalDrop() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.5, 0.4);
    [0, 0.12, 0.2].forEach((d, i) => { this.tone(o, t + d, 0.3, 'triangle', 900 - i * 120, 600, 0.3 / (i + 1), 0.001); this.noise(o, t + d, 0.06, 'bandpass', 2000, 2, (g) => { g.setValueAtTime(0, t + d); g.linearRampToValueAtTime(0.6 / (i + 1), t + d + 0.002); g.exponentialRampToValueAtTime(0.001, t + d + 0.06); }); });
  },
  rattle(dur = 1.4) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.35, 0.15);
    const n = Math.floor(dur * 26);
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * dur;
      this.noise(o, tt, 0.03, 'bandpass', 1500 + Math.random() * 2500, 4, (g) => { g.setValueAtTime(0, tt); g.linearRampToValueAtTime(0.5 + Math.random() * 0.5, tt + 0.001); g.exponentialRampToValueAtTime(0.001, tt + 0.025); });
    }
  },
  knock() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.5, 0.2);
    [0, 0.16].forEach(d => this.tone(o, t + d, 0.12, 'sine', 180, 90, 0.8, 0.002));
  },
  clink() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.25, 0.4);
    this.tone(o, t, 0.6, 'sine', 2637, 0, 0.6, 0.001); this.tone(o, t, 0.4, 'sine', 3951, 0, 0.3, 0.001);
  },
  gulp(n = 3) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.6, 0.1);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.38;
      this.tone(o, tt, 0.14, 'sine', 260, 120, 0.6, 0.01);
      this.noise(o, tt, 0.16, 'lowpass', 500, 2, (g) => { g.setValueAtTime(0, tt); g.linearRampToValueAtTime(0.4, tt + 0.02); g.exponentialRampToValueAtTime(0.001, tt + 0.15); });
    }
  },
  cough(n = 3, v = 1) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.7 * v, 0.25);
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.28 + Math.random() * 0.1);
      this.noise(o, tt, 0.25, 'bandpass', 700 + Math.random() * 300, 1.6, (g, t0, fl) => { g.setValueAtTime(0, tt); g.linearRampToValueAtTime(1, tt + 0.012); g.exponentialRampToValueAtTime(0.001, tt + 0.22); fl.frequency.exponentialRampToValueAtTime(380, tt + 0.2); });
      this.tone(o, tt, 0.12, 'sawtooth', 140, 90, 0.08, 0.01);
    }
  },
  choke(sec = 2.5) {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.55, 0.2);
    const n = this.noise(o, t, sec, 'bandpass', 500, 3, (g) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.6, t + 0.2); g.linearRampToValueAtTime(0.0001, t + sec); });
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain(); lfo.frequency.value = 9; lg.gain.value = 300;
    lfo.connect(lg); lg.connect(n.fl.frequency); lfo.start(t); lfo.stop(t + sec);
  },
  breath() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.35, 0.1);
    this.noise(o, t, 0.9, 'bandpass', 900, 0.6, (g) => { g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.5, t + 0.25); g.exponentialRampToValueAtTime(0.001, t + 0.85); });
  },
  deal() { if (!this.ok()) return; for (let i = 0; i < 5; i++) setTimeout(() => this.card(), i * 110); },
  win() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.25, 0.6);
    [220, 277, 330, 440].forEach((f, i) => this.tone(o, t + i * 0.12, 1.6, 'triangle', f, 0, 0.4, 0.01));
  },
  death() {
    if (!this.ok()) return; const t = this.t(); const o = this.out(0.25, 0.7);
    for (const f of [55, 58.3]) this.tone(o, t, 4, 'sawtooth', f, f * 0.8, 0.4, 0.4);
  },
};
