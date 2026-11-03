// 3Dの世界: 描画、カメラ（一人称）、アニメーション、死亡演出
import * as THREE from 'three';
import { $, clamp, lerp, Ease, CARD_LABEL, dieHTML } from './util.js';
import { Tex } from './textures.js';
import { Models, CARD_W, CARD_H } from './models.js';
import { Avatar, V3, buildViewArm, neckPose } from './avatar.js';
import { Snd } from './audio.js';
import { Post } from './post.js';

const SEAT_R = 0.98;
const EYE = new THREE.Vector3(0, 1.33, 0.0);
const GHOST = new THREE.Vector3(0, 1.85, -0.45);
const HEAD0 = new THREE.Vector3(0, 1.185, -0.02);   // ふだんの頭の付け根（座席ローカル）
const CENTER = new THREE.Vector3(0, 0.79, 0);

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || Math.min(innerWidth, innerHeight) < 600;
    this.mobile = mobile;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    const S = this.scene = new THREE.Scene();
    S.background = new THREE.Color(0x070403);
    S.fog = new THREE.FogExp2(0x0b0705, 0.09);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.02, 40);
    S.add(this.camera);
    // lights
    S.add(new THREE.HemisphereLight(0x6a7590, 0x160c06, 0.5));   // 影側はわずかに青み（ランプの暖色と対比）
    const lamp = this.lamp = Models.lamp(); lamp.position.set(0, 2.05, 0); S.add(lamp);
    const spot = this.spot = new THREE.SpotLight(0xffd29a, 34, 7, 0.95, 0.55, 1.6);
    spot.position.set(0, 2.0, 0); spot.target.position.set(0, 0, 0);
    spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.00025; spot.shadow.normalBias = 0.01; spot.shadow.radius = 4;
    spot.shadow.camera.near = 0.3; spot.shadow.camera.far = 5;
    S.add(spot, spot.target);
    this.lampPt = new THREE.PointLight(0xffc080, 3.5, 6, 1.8); this.lampPt.position.set(0, 1.9, 0); S.add(this.lampPt);
    this.flashLight = new THREE.PointLight(0xffc870, 0, 6, 2); S.add(this.flashLight);
    Models.room(S);
    const table = this.tableObj = Models.table(); S.add(table);
    // 酒場そのものを映り込み（環境マップ）として撮影する → 金属・ガラス・瞳がリアルに反射
    if (!window.__lowgfx) try {
      const pm = new THREE.PMREMGenerator(r);
      S.position.y = -1.15; S.updateMatrixWorld(true);
      const env = pm.fromScene(S, 0.035, 0.05, 20);
      S.position.y = 0; S.updateMatrixWorld(true);
      S.environment = env.texture;
      pm.dispose();
    } catch (e) { console.warn('env capture failed', e); S.position.y = 0; }
    // dust motes in light cone
    const dg = new THREE.BufferGeometry(), N = 260, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const a = Math.random() * 6.28, rr = Math.random() * 0.9; pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = 0.9 + Math.random() * 1.1; pos[i * 3 + 2] = Math.sin(a) * rr; }
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffe0b0, size: 0.006, transparent: true, opacity: 0.5, depthWrite: false }));
    S.add(this.dust);
    // ランプの光の筋（ランプと一緒に揺れる）とタバコの煙（環境マップの撮影後に追加）
    this.beam = Models.lightBeam(); this.beam.position.y = (1.93 - 2.05) - this.beam.userData.h / 2; lamp.add(this.beam);
    this.initSmoke(table.userData.smokeSrc);

    // seats
    this.seats = [];
    for (let i = 0; i < 4; i++) {
      const a = -i * Math.PI / 2;
      const g = new THREE.Group();
      g.position.set(Math.sin(a) * SEAT_R, 0, Math.cos(a) * SEAT_R);
      g.rotation.y = a + Math.PI;
      S.add(g);
      const chair = Models.chair(); chair.position.z = -0.06; g.add(chair);
      // table props (seat-local)
      const gunHold = new THREE.Group(); gunHold.position.set(-0.2, 0.795, 0.56); gunHold.rotation.y = 0.9; g.add(gunHold);
      const gun = Models.revolver(); gun.rotation.z = Math.PI / 2; gun.scale.setScalar(1.1); gunHold.add(gun);
      const vials = [Models.vial(), Models.vial()];
      vials[0].position.set(-0.24, 0.783, 0.47); vials[1].position.set(-0.3, 0.783, 0.55);
      vials.forEach(v => g.add(v));
      const cup = Models.cup(); cup.position.set(0.06, 0.783, 0.56); g.add(cup);
      const dice = [];
      const offs = [[-0.02, -0.016], [0.019, -0.02], [0.0, 0.007], [-0.024, 0.027], [0.024, 0.024]];
      for (let k = 0; k < 5; k++) { const d = Models.die(); d.position.set(0.06 + offs[k][0], 0.796, 0.56 + offs[k][1]); d.visible = false; g.add(d); dice.push(d); }
      this.seats.push({ i, g, a, chair, gunHold, gun, vials, cup, dice, offs, av: null, ci: -1, label: null, busy: 0, deadKind: null, blood: null, visualDead: false, vialsLeft: 2 });
    }
    this.pile = new THREE.Group(); S.add(this.pile);
    this.pileCards = [];
    this.revealCards = []; this.revealFloat = false;
    // 動いている途中のカード（テーブル直下）を管理。ここにも公開カードにも属さないカードは自動で消す
    this.transient = new Set(); this.pileLocks = new Set(); this.tableTok = 0; this.strayT = 0;
    // viewmodel
    this.vm = new THREE.Group(); this.camera.add(this.vm);
    this.handCards = []; this.handKey = ''; this.selected = new Set();
    this.vmGun = new THREE.Group(); this.vmGun.visible = false; this.vm.add(this.vmGun);
    this.vmVial = new THREE.Group(); this.vmVial.visible = false; this.vm.add(this.vmVial);
    this.vmCards = new THREE.Group(); this.vm.add(this.vmCards);
    this.vmLeft = new THREE.Group(); this.vmLeft.visible = false; this.vm.add(this.vmLeft);
    this.vmChar = -1;
    this.vmScale = 1;
    this.vmLight = new THREE.PointLight(0xfff0e0, 0.35, 1.2, 2); this.vmLight.position.set(0.1, 0.3, 0.05); this.camera.add(this.vmLight);
    this.post = null;
    this.quality = 'high';
    // particles for mist
    this.particles = [];
    // anim
    this.tweens = []; this.gen = 0; this.time = 0; this.fireRes = {};
    // camera state
    this.mySeat = -1; this.ghost = false;
    this.look = { yaw: 0, pitch: -0.32 };
    this.fx = { shake: 0, roll: 0, dy: 0, dz: 0, pitch: 0, fov: 0, blur: 0, sat: 1, hue: 0, dbl: 0, bright: 1 };
    this.vfov = 70;
    this.st = null; this.priv = null; this.mode = 'card';
    this.labelsEl = $('#labels');
    this.tmpV = new THREE.Vector3(); this.tmpV2 = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.bloodTex = null;
    this.onSelect = null;
    this.setupInput();
    try { this.post = new Post(r, S, this.camera); } catch (e) { console.warn('post disabled', e); this.post = null; }
    this.setQuality(window.__lowgfx ? 'low' : 'high');
    window.addEventListener('resize', () => this.resize());
  }

  // ---------- タバコの煙 ----------
  initSmoke(src) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 28; i++) {
      const px = 64 + (rnd() - 0.5) * 56, py = 64 + (rnd() - 0.5) * 56, r = 12 + rnd() * 28;
      const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    }
    x.globalCompositeOperation = 'destination-in';
    const m = x.createRadialGradient(64, 64, 8, 64, 64, 64); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = m; x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.smokeSrc = src.clone(); this.smoke = []; this.smokeLife = 6.5;
    const N = 18;
    for (let k = 0; k < N; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xc2b29c, transparent: true, opacity: 0, depthWrite: false }));
      sp.userData.noAO = true; sp.renderOrder = 3; sp.visible = false;
      this.scene.add(sp);
      this.smoke.push({ sp, t: -k * this.smokeLife / N, seed: k * 7.31, rot: (k * 1.7) % 6.28 });
    }
  }
  updateSmoke(dt) {
    if (!this.smoke) return;
    const L = this.smokeLife, b = this.smokeSrc, T = this.time;
    for (const p of this.smoke) {
      p.t += dt;
      if (p.t > L) { p.t -= L; p.seed = Math.random() * 100; }
      if (p.t < 0) { p.sp.visible = false; continue; }
      const u = p.t / L;
      // ゆらゆら昇り、上ほど広がって薄くなる
      const sway = (0.012 + u * 0.07);
      const x = b.x + Math.sin(p.seed + T * 0.9 + u * 5) * sway + u * 0.06;
      const z = b.z + Math.cos(p.seed * 1.3 + T * 0.7 + u * 4) * sway - u * 0.03;
      const y = b.y + 0.01 + u * 0.62 + Math.sin(u * 3 + p.seed) * 0.01;
      p.sp.position.set(x, y, z);
      const sc = 0.025 + u * 0.24; p.sp.scale.set(sc, sc * 1.15, 1);
      p.sp.material.rotation = p.rot + p.t * 0.22;
      p.sp.material.opacity = 0.34 * Math.sin(Math.PI * Math.min(1, u * 1.1)) * (1 - u * 0.35);
      p.sp.visible = true;
    }
    const em = this.tableObj && this.tableObj.userData.ember;
    if (em) em.material.emissiveIntensity = 3 + Math.sin(T * 2.3) * 0.6 + Math.sin(T * 7.1) * 0.3;
  }

  // 画質: high = 高解像度+AO+ブルーム+フィルム+MSAA / medium = 解像度控えめ（AO・ブルームなし） / low = 軽量
  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.pr = window.__lowgfx ? 0.5 : (q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.4) : 1);
    this.renderer.setPixelRatio(this.pr);
    const shadows = q !== 'low';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    }
    const ms = q === 'high' ? 2048 : 1024;
    if (this.spot.shadow.mapSize.x !== ms) { this.spot.shadow.mapSize.set(ms, ms); if (this.spot.shadow.map) { this.spot.shadow.map.dispose(); this.spot.shadow.map = null; } }
    this.usePost = !!this.post && q !== 'low';
    if (this.post) { this.post.bloom.enabled = q === 'high'; this.post.ao.enabled = q === 'high'; this.post.film.uniforms.ca.value = q === 'high' ? 0.0018 : 0.0; }
    this.resize();
  }

  // ---------- anim helpers ----------
  tween(dur, fn, ease = Ease.inOut) {
    return new Promise(res => this.tweens.push({ t: 0, dur: Math.max(0.001, dur), fn, ease, res, gen: this.gen }));
  }
  wait(s) { return this.tween(s, () => {}); }
  alive(g) { return g === this.gen; }

  // ---------- input ----------
  setupInput() {
    const c = this.canvas;
    let down = null;
    c.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, lx: e.clientX, ly: e.clientY, moved: 0 };
      try { c.setPointerCapture(e.pointerId); } catch (er) { /* */ }
    });
    c.addEventListener('pointermove', e => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
      down.lx = e.clientX; down.ly = e.clientY;
      down.moved += Math.abs(dx) + Math.abs(dy);
      const sens = 0.0055 * (this.vfov / 70);
      const yl = this.yawLim(); this.look.yaw = clamp(this.look.yaw - dx * sens, -yl, yl);
      this.look.pitch = clamp(this.look.pitch - dy * sens, -1.0, 0.85);
    });
    const up = e => {
      if (!down || e.pointerId !== down.id) return;
      if (down.moved < 10 && performance.now() - down.t < 450) this.tap(e.clientX, e.clientY);
      down = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => { down = null; });
    window.addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = 0.08;
      const yl = this.yawLim();
      if (e.key === 'ArrowLeft') this.look.yaw = clamp(this.look.yaw + k, -yl, yl);
      if (e.key === 'ArrowRight') this.look.yaw = clamp(this.look.yaw - k, -yl, yl);
      if (e.key === 'ArrowUp') this.look.pitch = clamp(this.look.pitch + k, -1, 0.85);
      if (e.key === 'ArrowDown') this.look.pitch = clamp(this.look.pitch - k, -1, 0.85);
    });
  }
  tap(x, y) {
    if (!this.handCards.length) return;
    const rc = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((x - rc.left) / rc.width) * 2 - 1, -((y - rc.top) / rc.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects(this.handCards.map(c => c.obj), true);
    if (!hits.length) return;
    let o = hits[0].object; while (o && o.userData.idx === undefined) o = o.parent;
    if (o) this.toggleSelect(o.userData.idx);
  }
  toggleSelect(i) {
    if (!this.canSelect) return;
    if (this.selected.has(i)) this.selected.delete(i);
    else { if (this.selected.size >= 5) return; this.selected.add(i); }
    Snd.click();
    if (this.onSelect) this.onSelect(this.selected);
  }
  clearSelect() { this.selected.clear(); if (this.onSelect) this.onSelect(this.selected); }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.post) this.post.setSize(w, h, this.pr || 1);
    const asp = w / h;
    this.camera.aspect = asp;
    const hfov = 74;
    let v = 2 * Math.atan(Math.tan((hfov * Math.PI / 180) / 2) / asp) * 180 / Math.PI;
    this.vfov = clamp(v, 52, 92);
    this.camera.fov = this.vfov;
    this.camera.updateProjectionMatrix();
    this.layoutHand();
  }

  // ---------- seats / avatars ----------
  setPlayers(st, mySeat) {
    this.mySeat = mySeat;
    for (let i = 0; i < 4; i++) {
      const s = this.seats[i], p = st.pl[i];
      if (!p) { if (s.av) { s.g.remove(s.av.root); s.av = null; } s.ci = -1; s.wantAv = false; this.setLabel(i, null); continue; }
      if (!s.av || s.ci !== p.c) {
        if (s.av) { s.g.remove(s.av.root); s.av = null; }
        s.ci = p.c; s.wantAv = true;   // 1フレームに1体ずつ生成（読み込み中に固まらないように）
        continue;
      }
      s.av.root.visible = i !== mySeat || this.ghost;
      if (p.lf) s.av.root.visible = false;
    }
    if (this.ghost && mySeat >= 0) { this.look.pitch = -0.55; }
    const myC = mySeat >= 0 && st.pl[mySeat] ? st.pl[mySeat].c : 0;
    if (myC !== this.vmChar) this.buildViewArms(myC);
  }
  // 一人称で見える自分の腕（右手=銃・毒瓶、左手=手札）
  buildViewArms(ci) {
    this.vmChar = ci;
    for (const g of [this.vmGun, this.vmVial, this.vmCards, this.vmLeft]) while (g.children.length) g.remove(g.children[0]);
    const mk = (side) => buildViewArm(ci, side);
    const _m = new THREE.Matrix4();
    // 右手: 指先が前(-Z)、親指が上 → 銃身が前、銃の上が上
    const gunArm = mk(-1);
    gunArm.hand.group.quaternion.setFromRotationMatrix(_m.makeBasis(V3(0, -1, 0), V3(0, 0, 1), V3(-1, 0, 0)));
    const gun = Models.revolver(); gun.scale.setScalar(1.1);
    gun.quaternion.setFromRotationMatrix(_m.makeBasis(V3(0, 0, 1), V3(-1, 0, 0), V3(0, -1, 0)));
    gun.position.set(-0.02, -0.083, 0.022);
    gunArm.hand.group.add(gun);
    gunArm.hand.setCurl(0.82, 0.45);
    this.vmGun.add(gunArm.group); this.vmGun.userData.gun = gun;
    const armMeshes = []; gunArm.hand.group.children.forEach(o => { if (o.isMesh && o.position.y > 0.005) armMeshes.push(o); });
    this.vmGun.userData.armMeshes = armMeshes;
    // 左手（シリンダーを回す）: 手のひらを銃の側面へ向ける
    const leftArm = mk(1);
    const fd = V3(0.35, 0.55, -0.75).normalize(), Y = fd.clone().negate();
    const pal = V3(1, 0.1, 0.2); const Z = pal.sub(Y.clone().multiplyScalar(pal.dot(Y))).normalize();
    leftArm.hand.group.quaternion.setFromRotationMatrix(_m.makeBasis(new THREE.Vector3().crossVectors(Y, Z), Y, Z));
    leftArm.hand.setCurl(0.25);
    this.vmLeft.add(leftArm.group);
    const vialArm = mk(-1);
    vialArm.hand.group.quaternion.copy(gunArm.hand.group.quaternion);
    const hold = new THREE.Group(); hold.position.set(0, -0.05, 0.024);
    hold.quaternion.setFromRotationMatrix(_m.makeBasis(V3(0, 0, 1), V3(-1, 0, 0), V3(0, -1, 0)));
    const vial = Models.vial(); vial.position.y = -0.045; vial.scale.setScalar(1.15); hold.add(vial);
    vialArm.hand.group.add(hold);
    vialArm.hand.setCurl(0.75);
    this.vmVial.add(vialArm.group); this.vmVial.userData.vial = vial;
    // 左手: 手のひらをこちらに向けて扇形の手札を支える
    const cardArm = mk(1);
    cardArm.hand.group.quaternion.setFromRotationMatrix(_m.makeBasis(V3(-1, 0, 0), V3(0, -1, 0), V3(0, 0, 1)));
    cardArm.group.rotation.z = -0.4;
    cardArm.hand.setCurl(0.06);
    this.vmCards.add(cardArm.group);
    this.vm.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }
  resetTable(mode) {
    this.gen++;
    this.tweens.forEach(t => t.res()); this.tweens = [];
    this.mode = mode;
    this.ghost = false;
    this.tableTok++;
    this.handBusy = false; this.handHide = 0; this.handKey = '';
    this.pileLocks.clear();
    this.dropTransient();
    this.clearPile();
    this.clearReveal();
    this.sweepStray();
    for (const s of this.seats) {
      if (s.av) s.av.reset();
      s.busy = 0; s.visualDead = false; s.deadKind = null; s.vialsLeft = 2;
      if (s.blood) { this.scene.remove(s.blood); s.blood = null; }
      s.gunHold.visible = mode === 'card';
      s.vials.forEach(v => { v.visible = mode === 'dice'; v.userData.liq.visible = true; v.userData.cork.visible = true; });
      s.cup.visible = mode === 'dice';
      s.cup.position.set(0.06, 0.783, 0.56); s.cup.rotation.set(0, 0, 0);
      s.dice.forEach(d => d.visible = false);
    }
    this.vmGun.visible = false; this.vmVial.visible = false; this.vmLeft.visible = false;
    Object.assign(this.fx, { shake: 0, roll: 0, dy: 0, dz: 0, pitch: 0, fov: 0, blur: 0, sat: 1, hue: 0, dbl: 0, bright: 1 });
    this.setOverlay({ black: 0, red: 0, green: 0, flash: 0, vig: 0.35 });
    Snd.stopHeartbeat();
    this.particles.forEach(p => this.scene.remove(p.pts)); this.particles = [];
    this.fireRes = {};
  }
  // 視点の左右の可動域: ふだんは約±97°、首を伸ばすと後ろ（約±175°）まで振り向ける
  yawLim() {
    const s = this.mySeat >= 0 ? this.seats[this.mySeat] : null;
    const n = s && s.av && !this.ghost ? s.av.nkLen : 0;
    return 1.7 + 1.35 * clamp(n / 0.3, 0, 1);
  }
  defaultPitch() { return this.camera.aspect < 0.85 ? -0.14 : -0.3; }
  seatLocal(i, x, y, z) { return this.seats[i].g.localToWorld(new THREE.Vector3(x, y, z)); }

  // ---------- sync (non-animated state) ----------
  sync(st, priv) {
    this.st = st; this.priv = priv;
    const md = st.md;
    for (let i = 0; i < 4; i++) {
      const s = this.seats[i], p = st.pl[i];
      if (!p || !s.av) { this.setLabel(i, null); continue; }
      if (p.lf) { s.av.root.visible = false; }
      const inGame = st.ph !== 'lobby';
      if (!s.busy) {
        if (inGame && !p.a && !p.lf && !s.visualDead) {
          s.visualDead = true; s.deadKind = md === 'card' ? 'gun' : 'poison';
          s.av.setDeadPose(s.deadKind);
          if (i === this.mySeat) this.enterGhost();
        }
        if (s.visualDead) s.gunHold.visible = false;
        const meOut = i === this.mySeat && !this.ghost && s.av.nkLen > 0.02;   // 首を伸ばしている間は自分の体も見える
        const showHeld = inGame && md === 'card' && p.a && p.hc > 0 && (i !== this.mySeat || meOut);
        s.av.setHeld(showHeld ? p.hc : 0);
        if (!s.visualDead && !s.av.handMoves.length) {
          const tgt = showHeld ? 'cards' : 'rest';
          if (s.av.lhT !== tgt && typeof s.av.lhT === 'string') s.av.hands(tgt, tgt, 0.5);
        }
        if (md === 'dice') {
          const left = Math.max(0, 2 - (p.ps || 0));
          s.vials.forEach((v, k) => { v.visible = k < left && inGame || st.ph === 'lobby'; });
        }
      }
    }
    // pile（公開中のカードは山から抜いてあるので、その分を引いた枚数に合わせる）
    if (md === 'card' || st.ph === 'lobby') {
      // 公開カードが残ってよいのは「告発〜撃つ〜結果」の間だけ。それ以外の場面で残っていたら消す
      const noReveal = st.ph === 'lobby' || st.ph === 'deal' || st.ph === 'turn';
      if (noReveal && this.revealCards.length) this.clearReveal();
      if (!this.pileBusy) {
        const want = st.ph === 'lobby' ? 0 : Math.max(0, (st.pile || 0) - this.revealCards.length);
        if (this.pileCards.length !== want) this.setPileCount(want);
      }
      if (st.ph === 'lobby' && !this.pileBusy) this.sweepStray(true);
    }
    // own hand
    const myP = this.mySeat >= 0 ? st.pl[this.mySeat] : null;
    const hand = (md === 'card' && myP && myP.a && priv && priv.h && st.ph !== 'lobby' && st.ph !== 'over') ? priv.h : [];
    const key = hand.join(',') + '|' + (priv ? priv.r : '');
    if (key !== this.handKey && !this.handBusy) this.setHand(hand, key);
    // own dice
    if (md === 'dice' && this.mySeat >= 0 && !this.diceReveal) {
      const s = this.seats[this.mySeat];
      const d = (priv && priv.d && myP && myP.a && st.ph !== 'lobby') ? priv.d : null;
      const dk = d ? d.join('') + priv.r : '';
      if (dk !== this.myDiceKey && !this.rolling) {
        this.myDiceKey = dk;
        s.dice.forEach((m, k) => {
          if (d && d[k]) {
            m.visible = true; m.quaternion.copy(Models.dieQuat(d[k], (k * 1.7) % 1 - 0.5));
            m.position.set(-0.08 + k * 0.04, 0.796, 0.74 + (k % 2) * 0.02);
          } else m.visible = false;
        });
        if (d) { s.cup.position.set(0.17, 0.783, 0.7); s.cup.rotation.set(0, 0, 0); }
      }
    }
  }

  // ---------- pile ----------
  clearPile() { this.pileCards.forEach(c => this.pile.remove(c)); this.pileCards = []; }
  clearReveal() { this.revealCards.forEach(c => { if (c.parent) c.parent.remove(c); }); this.revealCards = []; this.revealFloat = false; }
  get pileBusy() { return this.pileLocks.size > 0; }
  lockPile() { const k = {}; this.pileLocks.add(k); return () => this.pileLocks.delete(k); }
  // テーブル上を動かすカード：今のラウンド(tok)の印を付けて登録
  track(c, tok = this.tableTok) { c.userData.tok = tok; this.transient.add(c); if (c.parent !== this.scene) this.scene.add(c); return c; }
  untrack(c) { this.transient.delete(c); if (c.parent) c.parent.remove(c); }
  dropTransient() { this.transient.forEach(c => { if (c.parent) c.parent.remove(c); }); this.transient.clear(); }
  // 山・公開・移動中のどれにも属さないカードを消す（取り残し防止の安全網）
  sweepStray(all = false) {
    for (const o of this.scene.children.slice()) {
      if (!o.userData || !o.userData.front) continue;
      if (this.revealCards.includes(o)) continue;
      if (!all && this.transient.has(o) && o.userData.tok === this.tableTok) continue;
      this.transient.delete(o); this.scene.remove(o);
    }
  }
  pileSpot(k) {
    const a = (k * 2.39996) % 6.283;
    const r = 0.02 + (k % 5) * 0.012;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.786 + k * 0.0011, ry: (k * 1.37) % 6.283 };
  }
  addPileCard(face) {
    const c = Models.card(face || null);
    const p = this.pileSpot(this.pileCards.length);
    c.position.set(p.x, p.y, p.z); c.rotation.set(-Math.PI / 2, 0, p.ry);
    this.pile.add(c); this.pileCards.push(c);
    return c;
  }
  setPileCount(n) {
    while (this.pileCards.length > n) this.pile.remove(this.pileCards.pop());
    while (this.pileCards.length < n) this.addPileCard(null);
  }

  // ---------- own hand (viewmodel) ----------
  setHand(cards, key) {
    this.handKey = key;
    this.handCards.forEach(c => this.vm.remove(c.obj));
    this.handCards = cards.map((f, i) => {
      const obj = Models.card(f);
      obj.userData.idx = i;
      obj.traverse(o => { if (o.isMesh) { o.castShadow = false; o.material = o.material; } });
      this.vm.add(obj);
      return { obj, f, lift: 0 };
    });
    this.selected = new Set([...this.selected].filter(i => i < cards.length));
    if (this.onSelect) this.onSelect(this.selected);
    this.layoutHand();
  }
  // 手札の配置: 画面の幅・高さ・セーフエリア（iPhoneのホームバー）から計算し、カードが必ず画面内に収まるようにする
  layoutHand() {
    const n = this.handCards.length;
    const H = this.canvas.clientHeight || innerHeight;
    if (!n) { this.handTopPx = 0; return; }
    const d = 0.42;
    const halfH = d * Math.tan(this.vfov * Math.PI / 360);
    const halfW = halfH * this.camera.aspect;
    const portrait = this.camera.aspect < 0.85;
    const R = 0.42, step = 0.13;
    // 扇の幅（倍率1のとき）
    const amax = (n - 1) / 2 * step;
    const fanW = 2 * Math.sin(amax) * R + CARD_W * Math.cos(amax) + CARD_H * Math.sin(amax);
    const sc = Math.min((portrait ? 0.9 : 0.6) * 2 * halfW / fanW, (portrait ? 0.2 : 0.27) * 2 * halfH / CARD_H, 1.0);
    // 一番低いカードの下端（中央カード中心からの距離）
    let low = 0, high = 0;
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * step;
      const cy = (Math.cos(a) * R - R) * sc;
      const ext = (CARD_H / 2 * Math.cos(a) + CARD_W / 2 * Math.abs(Math.sin(a))) * sc;
      low = Math.min(low, cy - ext); high = Math.max(high, cy + ext);
    }
    const pxToW = 2 * halfH / H;
    const margin = (12 + this.safeBottom()) * pxToW;
    const baseY = -halfH + margin - low;
    this.handCards.forEach((c, i) => {
      const a = (i - (n - 1) / 2) * step;
      c.base = { x: Math.sin(a) * R * sc, y: baseY + (Math.cos(a) * R - R) * sc, z: -d - i * 0.0015, rz: -a * 0.9, sc };
    });
    this.handCardH = CARD_H * sc;
    // 手札の上端（画面下からのpx）をCSSに渡し、ボタン類を手札の上に置く
    this.handTopPx = Math.round((baseY + high + 0.035 * sc + halfH) / pxToW);
  }
  safeBottom() {
    if (this._sb == null || this._sbT !== innerHeight) {
      const p = document.createElement('div');
      p.style.cssText = 'position:fixed;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden';
      document.body.appendChild(p); this._sb = p.offsetHeight || 0; p.remove(); this._sbT = innerHeight;
    }
    return this._sb;
  }
  updateHand(dt) {
    const k = 1 - Math.exp(-dt * 14);
    const hasHand = this.handCards.length > 0 && !(this.handHide >= 0.99);
    this.vmCards.visible = hasHand;
    if (hasHand && this.handCards[0].base) {
      const b0 = this.handCards[0].base, sc = b0.sc || 0.85;
      this.vmCards.position.set(-0.03 * sc, b0.y - 0.09 * sc - (this.handDownS || 0) * (this.handCardH || 0.1) * 0.35 + (this.handHide || 0) * -0.25, b0.z - 0.03);
      this.vmCards.scale.setScalar(sc * 0.95);
    }
    for (let i = 0; i < this.handCards.length; i++) {
      const c = this.handCards[i];
      if (!c.base) continue;
      const tl = this.selected.has(i) ? 1 : 0;
      c.lift += (tl - c.lift) * k;
      const b = c.base;
      this.handDownS = (this.handDownS || 0) + ((this.handDown || 0) - (this.handDownS || 0)) * k * 0.6;
      c.obj.scale.setScalar(b.sc);
      c.obj.position.set(b.x, b.y + c.lift * 0.03 * b.sc - this.handDownS * (this.handCardH || 0.1) * 0.35 + (this.handHide || 0) * -0.25, b.z + c.lift * 0.01);
      c.obj.rotation.set(-0.2, 0, b.rz);
      c.obj.visible = !(this.handHide >= 0.99);
    }
  }

  // ---------- labels ----------
  setLabel(i, info) {
    const s = this.seats[i];
    if (!info) { if (s.label) { s.label.remove(); s.label = null; } return; }
    if (!s.label) {
      s.label = document.createElement('div'); s.label.className = 'plabel';
      s.label.innerHTML = '<div class="pn"></div><div class="ps"></div><div class="pd"></div><div class="pb"></div>';
      this.labelsEl.appendChild(s.label);
    }
    const L = s.label;
    L.querySelector('.pn').textContent = info.name;
    L.querySelector('.ps').textContent = info.status;
    // チート（nekojita）: その人のサイコロの目
    const pd = L.querySelector('.pd'), dk = info.dice ? info.dice.join('') : '';
    if (pd.dataset.k !== dk) { pd.dataset.k = dk; pd.innerHTML = info.dice ? info.dice.map(v => dieHTML(v)).join('') : ''; pd.style.display = info.dice ? 'flex' : 'none'; }
    const pb = L.querySelector('.pb');
    pb.textContent = info.bubble || ''; pb.style.display = info.bubble ? 'block' : 'none';
    L.classList.toggle('turn', !!info.turn);
    L.classList.toggle('dead', !!info.dead);
    L.classList.toggle('me', i === this.mySeat);
    s.labelInfo = info;
  }
  // ワールド座標 → 画面座標（CSSピクセル）
  screenOf(x, y, z) {
    const v = this.tmpV.set(x, y, z);
    const cs = this.tmpV2.copy(v).applyMatrix4(this.camera.matrixWorldInverse);
    v.project(this.camera);
    return { x: (v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - v.y) / 2 * this.canvas.clientHeight, behind: cs.z > 0 };
  }
  updateLabels() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    for (let i = 0; i < 4; i++) {
      const s = this.seats[i];
      if (!s.label || !s.av) continue;
      if (i === this.mySeat && !this.ghost) { s.label.style.display = 'none'; continue; }
      const p = s.visualDead ? s.g.localToWorld(this.tmpV.set(0, 1.35, -0.05)) : s.av.headWorld(this.tmpV);
      p.y += 0.3;
      // camera-space test for "behind"
      const cs = this.tmpV2.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
      p.project(this.camera);
      let x = p.x, y = p.y, edge = false;
      if (cs.z > 0) { x = cs.x >= 0 ? 1.6 : -1.6; y = 0; edge = true; }
      let sx = (x + 1) / 2 * w, sy = (1 - y) / 2 * h;
      const lw = (s.label.offsetWidth || 90) / 2 + 6, lh = s.label.offsetHeight || 40;
      const top = 70 + lh, bot = h - 70;
      if (sx < lw || sx > w - lw || sy < top || sy > bot) edge = true;
      sx = clamp(sx, lw, w - lw); sy = clamp(sy, top, bot);
      s.label.style.display = 'block';
      s.label.classList.toggle('edge', edge);
      s.label.style.transform = `translate(-50%,-100%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    }
  }

  // ---------- overlay fx ----------
  setOverlay(o) {
    for (const k of Object.keys(o)) {
      const el = document.getElementById('fx-' + k);
      if (el) el.style.opacity = o[k];
    }
  }
  bigText(text, cls = '', dur = 1.6) {
    const el = $('#bigtext');
    el.textContent = text; el.className = 'show ' + cls;
    clearTimeout(this._btT);
    this._btT = setTimeout(() => { el.className = cls; }, dur * 1000);
  }
  shakeCam(amount, dur) {
    const g = this.gen;
    this.fx.shake = Math.max(this.fx.shake, amount);
    return this.tween(dur, e => { if (this.alive(g)) this.fx.shake = amount * (1 - e); }, Ease.lin);
  }

  // ---------- events ----------
  name(i) { const p = this.st && this.st.pl[i]; return p ? p.n : '?'; }
  isMe(i) { return i === this.mySeat; }

  async evRound(ev) {
    const g = this.gen, tok = ++this.tableTok;
    // 前のラウンドのアニメーションが遅れて残っていても、ここで全部片付ける
    this.transient.forEach(c => { if (c.userData.tok !== tok) this.untrack(c); });
    this.pileLocks.clear();
    // sweep old pile + revealed cards together
    const old = this.pileCards.concat(this.revealCards); this.pileCards = []; this.revealCards = []; this.revealFloat = false;
    if (old.length) {
      const unlock = this.lockPile();
      old.forEach(c => { const wp = c.getWorldPosition(new THREE.Vector3()); c.position.copy(wp); this.track(c, tok); });
      const from = old.map(c => c.position.clone()), s0 = old.map(c => c.scale.x);
      await this.tween(0.45, e => { old.forEach((c, k) => { c.position.set(from[k].x * (1 - e), from[k].y + e * 0.05, from[k].z * (1 - e)); c.scale.setScalar(s0[k] * (1 - e * 0.9)); }); });
      old.forEach(c => this.untrack(c));
      unlock();
    }
    if (!this.alive(g) || tok !== this.tableTok) return;
    this.bigText(`${CARD_LABEL[ev.tc]} のテーブル`, 'gold', 2.0);
    // deal: cards fly from center to each alive player
    this.handHide = 1; this.handBusy = true;
    Snd.deal();
    const fly = [];
    for (let i = 0; i < 4; i++) {
      const p = this.st && this.st.pl[i];
      const s = this.seats[i];
      if (!p || !p.a || !s.av) continue;
      s.av.setHeld(0);
      const to = i === this.mySeat ? this.camera.localToWorld(new THREE.Vector3(0, -0.25, -0.4)) : s.av.held.getWorldPosition(new THREE.Vector3());
      for (let k = 0; k < 5; k++) {
        const c = Models.card(null); c.position.copy(CENTER); c.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
        this.track(c, tok);
        fly.push({ c, to, delay: k * 0.09 + i * 0.03 });
      }
    }
    await this.tween(1.0, (e, raw) => {
      fly.forEach(f => {
        const t = clamp((raw * 1.0 - f.delay) / 0.55, 0, 1), te = Ease.out(t);
        f.c.position.lerpVectors(CENTER, f.to, te); f.c.position.y += Math.sin(te * Math.PI) * 0.15;
        f.c.rotation.z += 0.3;
        f.c.visible = t < 1;
      });
    }, Ease.lin);
    fly.forEach(f => this.untrack(f.c));
    if (tok !== this.tableTok) return; // 次のラウンドがもう始まっている（その処理に任せる）
    this.handBusy = false; this.handKey = '';
    if (this.priv) this.sync(this.st, this.priv);
    await this.tween(0.35, e => { this.handHide = 1 - e; });
    this.handHide = 0;
  }

  async evPlay(ev) {
    const g = this.gen, tok = this.tableTok;
    const s = this.seats[ev.s];
    Snd.card();
    let from;
    let faces = [];
    if (this.isMe(ev.s)) {
      // fly selected cards from viewmodel
      const idx = [...(this.lastPlayed || [])];
      from = [];
      idx.forEach(i => { const hc = this.handCards[i]; if (hc) { from.push(hc.obj.getWorldPosition(new THREE.Vector3())); hc.obj.visible = false; } });
      while (from.length < ev.n) from.push(this.camera.localToWorld(new THREE.Vector3(0, -0.2, -0.4)));
      this.clearSelect();
    } else if (s.av) {
      const av = s.av;
      s.busy++;
      av.setHeld(Math.max(0, (av.heldN || 0) - ev.n));
      av.hands(null, () => av.seatToTorso(-0.05, 0.84, 0.62), 0.25, Ease.out).then(() => av.hands('cards', 'cards', 0.4));
      const hp = av.held.getWorldPosition(new THREE.Vector3());
      from = Array.from({ length: ev.n }, () => hp.clone());
      setTimeout(() => { s.busy = Math.max(0, s.busy - 1); }, 700);
    } else from = Array.from({ length: ev.n }, () => CENTER.clone());
    const unlock = this.lockPile();
    const cards = [];
    for (let k = 0; k < ev.n; k++) {
      const c = Models.card(null);
      const spot = this.pileSpot(this.pileCards.length + k);
      c.userData.spot = spot; c.position.copy(from[k]);
      this.track(c, tok); cards.push(c);
    }
    const starts = cards.map(c => c.position.clone());
    await this.tween(0.5, (e) => {
      cards.forEach((c, k) => {
        const sp = c.userData.spot;
        const t = clamp(e * 1.15 - k * 0.07, 0, 1);
        c.position.set(lerp(starts[k].x, sp.x, t), lerp(starts[k].y, sp.y, t) + Math.sin(t * Math.PI) * 0.08, lerp(starts[k].z, sp.z, t));
        c.rotation.set(lerp(0, -Math.PI / 2, t), 0, lerp(0, sp.ry, t));
      });
    }, Ease.out);
    cards.forEach(c => this.untrack(c));
    if (!this.alive(g) || tok !== this.tableTok) { unlock(); return; }
    for (let k = 0; k < ev.n; k++) this.addPileCard(null);
    unlock();
    // 実際の枚数に合わせ直す（遅れて届いた場合のずれを防ぐ）
    if (this.st && this.st.md === 'card' && !this.pileBusy && this.st.ph === 'turn') {
      const want = Math.max(0, (this.st.pile || 0) - this.revealCards.length);
      if (this.pileCards.length !== want) this.setPileCount(want);
    }
    Snd.card();
  }

  async slamBy(i) {
    const s = this.seats[i], av = s.av;
    Snd.stinger();
    this.bigText('LIAR!', 'red', 1.5);
    if (av && !this.isMe(i)) {
      s.busy++;
      await av.hands('raise', 'raise', 0.25, Ease.out);
      av.pose.lean = 0.25;
      await av.hands('slam', 'slam', 0.12, Ease.in);
      Snd.slam(1);
      this.shakeCam(0.012, 0.35);
      av.pose.lean = 0.12;
      setTimeout(() => { if (!av.dead) av.pose.lean = 0; s.busy = Math.max(0, s.busy - 1); }, 600);
    } else {
      await this.wait(0.35);
      Snd.slam(1.2);
      this.shakeCam(0.03, 0.4);
    }
  }

  // 山の最後の n 枚を抜いて、自分の目の前に浮かせて表を見せる（各プレイヤーが自分の方向に向けて見る）
  async liftReveal(faces, tok) {
    const unlock = this.lockPile();
    this.clearReveal();
    const n = faces.length;
    const take = this.pileCards.splice(Math.max(0, this.pileCards.length - n), n);
    take.forEach(c => { const wp = c.getWorldPosition(new THREE.Vector3()); c.position.copy(wp); this.track(c, tok); });
    while (take.length < n) { const c = Models.card(null); c.position.copy(CENTER); c.rotation.set(-Math.PI / 2, 0, 0); this.track(c, tok); take.push(c); }
    take.forEach((c, k) => c.setFace(faces[k]));
    const starts = take.map(c => c.position.clone());
    const startQ = take.map(c => new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, c.rotation.z)));
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const toCam = camPos.clone().sub(CENTER); toCam.y = 0; toCam.normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(toCam).normalize();
    const mid = CENTER.clone().addScaledVector(toCam, 0.12); mid.y = 0.97;
    const gapX = n > 3 ? 0.13 : 0.17, big = n > 3 ? 0.65 : 1.0;
    const targets = take.map((c, k) => mid.clone().addScaledVector(right, (k - (n - 1) / 2) * gapX));
    const look = new THREE.Object3D(); look.position.copy(mid); look.lookAt(camPos.x, camPos.y, camPos.z);
    const endQ = look.quaternion.clone();
    Snd.flip();
    await this.tween(0.75, e => {
      take.forEach((c, k) => {
        c.position.lerpVectors(starts[k], targets[k], e); c.position.y += Math.sin(e * Math.PI) * 0.08;
        c.quaternion.slerpQuaternions(startQ[k], endQ, e);
        c.scale.setScalar(1 + e * big);
      });
    });
    if (tok !== this.tableTok || !take.every(c => this.transient.has(c))) {
      // 途中で次のラウンド/ゲームに進んだ → このカードは捨てる
      take.forEach(c => this.untrack(c)); unlock(); return null;
    }
    take.forEach(c => this.transient.delete(c));
    this.clearReveal();
    this.revealCards = take; this.revealFloat = true;
    unlock();
    return take;
  }

  // 見せ終わったら、邪魔にならないよう自分の手前のテーブルに表向きで並べて置く
  async layDownReveal(take, tok) {
    if (!take || this.revealCards !== take || tok !== this.tableTok) return;
    this.revealFloat = false;
    const n = take.length;
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const toCam = camPos.clone().sub(CENTER); toCam.y = 0; toCam.normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(toCam).normalize();
    const base = CENTER.clone().addScaledVector(toCam, 0.21);
    const gap = CARD_W * 1.18;
    const endQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.atan2(toCam.x, toCam.z)));
    const starts = take.map(c => c.position.clone()), startQ = take.map(c => c.quaternion.clone()), s0 = take.map(c => c.scale.x);
    const targets = take.map((c, k) => { const v = base.clone().addScaledVector(right, (k - (n - 1) / 2) * gap); v.y = 0.79 + k * 0.0004; return v; });
    await this.tween(0.6, e => {
      if (this.revealCards !== take) return;
      take.forEach((c, k) => {
        c.position.lerpVectors(starts[k], targets[k], e); c.position.y += Math.sin(e * Math.PI) * 0.03;
        c.quaternion.slerpQuaternions(startQ[k], endQ, e);
        c.scale.setScalar(lerp(s0[k], 1, e));
      });
    });
  }

  async evLiar(ev) {
    const g = this.gen, tok = this.tableTok;
    this.slamBy(ev.s);
    await this.wait(1.0);
    if (!this.alive(g) || tok !== this.tableTok) return;
    // flip the last n cards
    const take = await this.liftReveal(ev.cards, tok);
    if (!take || !this.alive(g)) return;
    // mark each card
    take.forEach((c, k) => {
      const ok = ev.cards[k] === ev.tc || ev.cards[k] === 'J';
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 1.12, CARD_H * 1.1), new THREE.MeshBasicMaterial({ color: ok ? 0x3cff7a : 0xff2a2a, transparent: true, opacity: 0.0 }));
      ring.position.z = -0.002; c.add(ring);
      this.tween(0.4, e => { ring.material.opacity = e * 0.7; });
    });
    await this.wait(0.5);
    if (!this.alive(g) || tok !== this.tableTok) return;
    const loser = this.name(ev.lo);
    this.bigText(ev.lie ? `嘘だった！ → ${loser}` : `本物だった！ → ${loser}`, ev.lie ? 'red' : 'green', 2.2);
    await this.wait(2.4);
    if (!this.alive(g)) return;
    await this.layDownReveal(take, tok);
  }

  // あがり: 出し切った最後のカードを表にして見せる
  async evAgari(ev) {
    const g = this.gen, tok = this.tableTok;
    Snd.win();
    this.bigText('あがり！', 'gold', 2.0);
    await this.wait(0.6);
    if (!this.alive(g) || tok !== this.tableTok) return;
    const take = await this.liftReveal(ev.cards, tok);
    if (!take || !this.alive(g)) return;
    this.bigText(ev.lie ? `ハッタリで あがり！ → ${this.name(ev.s)}` : `あがり！ → ${this.name(ev.s)}`, 'gold', 2.4);
    await this.wait(2.8);
    if (!this.alive(g)) return;
    await this.layDownReveal(take, tok);
  }

  enterGhost() {
    this.ghost = true;
    const s = this.seats[this.mySeat];
    if (s && s.av) { s.av.root.visible = true; s.av.head.visible = true; }
    this.handHide = 1;
  }

  muzzleFlash(pos) {
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 80;
    const g = this.gen;
    this.tween(0.12, e => { if (this.alive(g)) this.flashLight.intensity = 80 * (1 - e); }, Ease.lin);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex(), color: 0xffd080, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sp.position.copy(pos); sp.scale.setScalar(0.25); this.scene.add(sp);
    this.tween(0.09, e => { sp.material.opacity = 1 - e; sp.scale.setScalar(0.25 + e * 0.15); }, Ease.lin).then(() => this.scene.remove(sp));
  }
  flashTex() { return this._ft || (this._ft = Tex.tex(Tex.flash())); }
  mist(pos, dir) {
    const N = 90, geo = new THREE.BufferGeometry(), p = new Float32Array(N * 3), v = [];
    for (let i = 0; i < N; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
      const s = 0.6 + Math.random() * 2.2;
      v.push(new THREE.Vector3(dir.x * s + (Math.random() - 0.5) * 1.2, dir.y * s + (Math.random() - 0.2) * 1.0, dir.z * s + (Math.random() - 0.5) * 1.2));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x5a0408, size: 0.018, transparent: true, opacity: 0.95, depthWrite: false }));
    this.scene.add(pts);
    this.particles.push({ pts, v, life: 0, max: 1.1 });
  }
  updateParticles(dt) {
    for (let k = this.particles.length - 1; k >= 0; k--) {
      const P = this.particles[k]; P.life += dt;
      const a = P.pts.geometry.attributes.position;
      for (let i = 0; i < P.v.length; i++) {
        P.v[i].y -= 9.8 * dt; P.v[i].multiplyScalar(1 - dt * 1.5);
        let y = a.getY(i) + P.v[i].y * dt;
        if (y < 0.005) { y = 0.005; P.v[i].set(0, 0, 0); }
        a.setXYZ(i, a.getX(i) + P.v[i].x * dt, y, a.getZ(i) + P.v[i].z * dt);
      }
      a.needsUpdate = true;
      P.pts.material.opacity = 0.95 * (1 - clamp((P.life - 0.5) / (P.max - 0.5), 0, 1) * 0.6);
      if (P.life > 6) { this.scene.remove(P.pts); this.particles.splice(k, 1); }
    }
  }
  bloodPool(pos, maxR) {
    if (!this.bloodTex) this.bloodTex = Tex.tex(Tex.blood());
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshPhysicalMaterial({ map: this.bloodTex, transparent: true, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6; m.position.set(pos.x, 0.004, pos.z); m.scale.setScalar(0.01);
    m.receiveShadow = true;
    this.scene.add(m);
    const g = this.gen;
    this.tween(7, e => { if (this.alive(g)) m.scale.setScalar(0.01 + e * maxR); }, Ease.out);
    return m;
  }

  // 引き金の結果（ホストが引き金の瞬間に送る）を待つ。届くまで震え続ける。
  // 結果のイベントを取りこぼしても、状態（生死・ラウンドの進行）から判断して必ず先へ進む。
  waitFire(seat, n) {
    const key = seat + ':' + n;
    return new Promise(res => {
      const t0 = performance.now();
      const chk = () => {
        if (this.fireRes[key] !== undefined) { const v = this.fireRes[key]; delete this.fireRes[key]; return res(v); }
        const st = this.st, p = st && st.pl[seat];
        if (p && !p.a) return res(true);
        const waited = performance.now() - t0;
        if (st && st.ph !== 'shot' && waited > 1200) return res(false);
        if (waited > 15000) return res(false);
        setTimeout(chk, 120);
      };
      chk();
    });
  }
  evFire(ev) { this.fireRes[ev.s + ':' + ev.n] = !!ev.fatal; }
  async evShot(ev) {
    const g = this.gen;
    const s = this.seats[ev.s];
    if (!s.av) return;
    s.busy++;
    try {
      if (this.isMe(ev.s) && !this.ghost) await this.shotFirstPerson(ev, s, g);
      else await this.shotThird(ev, s, g);
    } finally { s.busy = Math.max(0, s.busy - 1); }
  }
  // 他のプレイヤーから見た「自分撃ち」: 銃を取る → シリンダーを振り出して回す → 戻して撃鉄を起こす → こめかみに当てる → 引き金
  async shotThird(ev, s, g) {
    const av = s.av;
    const gun = av.gun, G = gun.userData;
    av.setHeld(0);
    av.lookW = 0.3;
    await av.hands('rest', 'gunTable', 0.6);
    if (!this.alive(g)) return;
    s.gunHold.visible = false; gun.visible = true;
    G.crane.rotation.z = 0; G.hammer.rotation.x = 0; G.trigger.rotation.x = 0;
    await av.hands('rest', 'chest', 0.5);
    if (!this.alive(g)) return;
    // シリンダーを振り出す
    av.hands('cyl', null, 0.3);
    Snd.swing();
    await this.tween(0.28, e => { G.crane.rotation.z = -1.45 * e; }, Ease.out);
    // 回す
    av.hands(() => av.rh.clone().add(V3(0.085, 0.02, 0.05)), null, 0.1, Ease.out).then(() => av.hands('cyl', null, 0.2));
    Snd.spinLong(1.2);
    const turns = Math.PI * 2 * 3 + Math.floor(Math.random() * 6) * Math.PI / 3, c0 = G.cyl.rotation.z;
    await this.tween(1.2, e => { G.cyl.rotation.z = c0 + turns * e; }, Ease.out);
    if (!this.alive(g)) return;
    // 戻す
    Snd.clack();
    await this.tween(0.15, e => { G.crane.rotation.z = -1.45 * (1 - e); av.pose.twist = 0.05 * Math.sin(e * Math.PI); }, Ease.in);
    av.hands('rest', null, 0.4);
    // 撃鉄を起こす
    Snd.cock();
    await this.tween(0.25, e => { G.hammer.rotation.x = -0.55 * e; });
    av.setExpr('fear');
    // 銃口を自分のこめかみへ
    await Promise.all([av.hands(null, 'temple', 1.0, Ease.inOut), this.tween(1.0, e => { av.pose.hRoll = 0.14 * e; av.pose.hYaw = -0.12 * e; })]);
    if (!this.alive(g)) return;
    av.pose.shake = 0.012;
    Snd.heartbeatLoop(80, 1.75, 0.35, 12);
    await this.tween(1.75, e => { av.pose.shake = 0.01 + e * 0.025; av.pose.hPitch = -0.1 * e; });
    Snd.stopHeartbeat();
    if (!this.alive(g)) return;
    av.pose.shake = 0.035;
    const fatal = await this.waitFire(ev.s, ev.n);
    if (!this.alive(g)) return;
    av.pose.shake = 0;
    G.trigger.rotation.x = -0.35; G.hammer.rotation.x = 0;
    const muzzle = gun.localToWorld(new THREE.Vector3(0, 0.05, 0.195));
    if (!fatal) {
      Snd.dryFire();
      av.pose.hRoll = 0.4; av.pose.lean = -0.1;
      await this.tween(0.3, e => { av.pose.hRoll = lerp(0.4, 0.14, e); av.pose.lean = lerp(-0.1, 0, e); });
      Snd.breath();
      av.setExpr('normal');
      await this.wait(0.5);
      G.trigger.rotation.x = 0;
      await Promise.all([av.hands('rest', 'gunTable', 0.8), this.tween(0.8, e => { av.pose.hRoll = 0.14 * (1 - e); av.pose.hYaw = -0.12 * (1 - e); av.pose.hPitch = -0.1 * (1 - e); })]);
      gun.visible = false; s.gunHold.visible = true;
      av.lookW = 1;
      await av.hands('rest', 'rest', 0.5);
      return;
    }
    // 実弾
    Snd.gunshot(false);
    this.muzzleFlash(muzzle);
    this.shakeCam(0.05, 0.5);
    const head = av.headWorld(new THREE.Vector3());
    const dir = this.seatDir(ev.s, 1, 0.15, 0);
    this.mist(head.clone().addScaledVector(dir, 0.1), dir);
    s.visualDead = true; s.deadKind = 'gun';
    av.setExpr('dead'); av.dead = true; av.lookW = 0;
    const gpos = gun.getWorldPosition(new THREE.Vector3()), gq = gun.getWorldQuaternion(new THREE.Quaternion());
    gun.visible = false;
    const dropped = Models.revolver(); dropped.scale.setScalar(1.1); dropped.position.copy(gpos); dropped.quaternion.copy(gq); this.scene.add(dropped);
    this.dropped = this.dropped || []; this.dropped.push(dropped);
    const gEnd = this.seatLocal(ev.s, -0.45, 0.02, 0.15);
    this.tween(0.55, e => { dropped.position.lerpVectors(gpos, gEnd, e); dropped.position.y = lerp(gpos.y, 0.02, Ease.in2(e)); dropped.rotation.z += 0.15; }, Ease.lin).then(() => { Snd.metalDrop(); dropped.rotation.set(0, Math.random() * 6, Math.PI / 2); });
    const P = av.pose;
    await this.tween(0.12, e => { P.hRoll = lerp(0.14, 0.9, e); P.hYaw = lerp(-0.12, 0.55, e); P.side = -0.25 * e; }, Ease.out);
    av.hands(V3(0.3, 0.2, 0.25), V3(-0.3, 0.3, 0.15), 0.6, Ease.in2);
    await this.tween(0.5, e => { P.side = lerp(-0.25, 0.25, e); P.lean = 0.35 * e; P.hPitch = 0.3 * e; }, Ease.in2);
    if (!this.alive(g)) return;
    await this.tween(0.75, e => {
      P.bodyRZ = lerp(0, -1.42, e); P.bodyX = lerp(0, 0.34, e); P.bodyY = lerp(0, -0.4, e); P.bodyRX = 0.05 * e;
    }, Ease.outBounce);
    Snd.thud();
    av.setDeadPose('gun');
    s.blood = this.bloodPool(av.headWorld(new THREE.Vector3()), 0.75);
  }
  seatDir(i, x, y, z) {
    // direction in world from seat-local direction
    return new THREE.Vector3(x, y, z).applyQuaternion(this.seats[i].g.quaternion).normalize();
  }
  // 一人称の「自分撃ち」: 銃を持ち上げる → シリンダーを振り出して回す → 戻す → 撃鉄 → 銃口をこちらへ向ける → こめかみへ → 引き金
  async shotFirstPerson(ev, s, g) {
    this.handHide = 1;
    s.gunHold.visible = false;
    const vg = this.vmGun, G = vg.userData.gun.userData, vl = this.vmLeft;
    const arm = vg.userData.armMeshes || [];
    G.crane.rotation.z = 0; G.hammer.rotation.x = 0; G.trigger.rotation.x = 0;
    vg.visible = true; vg.scale.setScalar(1.15);
    const P = (x, y, z, rx, ry, rz) => ({ x, y, z, rx, ry, rz });
    const set = (a) => { vg.position.set(a.x, a.y, a.z); vg.rotation.set(a.rx, a.ry, a.rz); };
    const go = (a, b, dur, ease = Ease.inOut, extra) => this.tween(dur, e => {
      set(P(lerp(a.x, b.x, e), lerp(a.y, b.y, e), lerp(a.z, b.z, e), lerp(a.rx, b.rx, e), lerp(a.ry, b.ry, e), lerp(a.rz, b.rz, e)));
      if (extra) extra(e);
    }, ease);
    const low = P(0.32, -0.62, -0.4, 0.15, 0.25, 0), hold = P(0.11, -0.16, -0.36, 0.05, 0.45, 0.12);
    set(low);
    Snd.heartbeatLoop(66, 5.8, 0.9, 7);
    this.setOverlay({ vig: 0.5 });
    await go(low, hold, 0.8, Ease.out);
    if (!this.alive(g)) return;
    // シリンダーを振り出す（6発とも同じ見た目。どれが実弾かは分からない）
    Snd.swing();
    vl.visible = true; vl.position.set(-0.25, -0.5, -0.36);
    await Promise.all([
      this.tween(0.25, e => { G.crane.rotation.z = -1.45 * e; }, Ease.out),
      this.tween(0.3, e => { vl.position.set(lerp(-0.25, -0.03, e), lerp(-0.5, -0.2, e), -0.35); }, Ease.out),
    ]);
    await this.wait(0.25);
    // 回す
    Snd.spinLong(1.2);
    const turns = Math.PI * 2 * 3 + Math.floor(Math.random() * 6) * Math.PI / 3, c0 = G.cyl.rotation.z;
    await this.tween(1.2, (e, t) => {
      G.cyl.rotation.z = c0 + turns * e;
      vl.position.y = -0.2 + (t < 0.15 ? -Math.sin(t / 0.15 * Math.PI) * 0.03 : 0);
    }, Ease.out);
    if (!this.alive(g)) return;
    // 戻す
    Snd.clack();
    await this.tween(0.15, e => { G.crane.rotation.z = -1.45 * (1 - e); vg.rotation.z = 0.12 + Math.sin(e * Math.PI) * 0.15; }, Ease.in);
    this.tween(0.3, e => { vl.position.set(lerp(-0.03, -0.3, e), lerp(-0.2, -0.6, e), -0.35); }, Ease.in).then(() => { vl.visible = false; });
    // 撃鉄を起こす
    Snd.cock();
    await this.tween(0.25, e => { G.hammer.rotation.x = -0.55 * e; });
    if (!this.alive(g)) return;
    // 銃口をこちらへ向ける（銃身の奥を覗き込む）
    const face = P(0.0, -0.035, -0.5, 0.1, Math.PI, 0.0);
    await go(hold, face, 0.7, Ease.inOut, e => { arm.forEach(m => { m.visible = e < 0.4; }); this.setOverlay({ vig: 0.5 + e * 0.3 }); });
    this.fx.shake = 0.004;
    await this.tween(0.55, e => { this.fx.shake = 0.004 + e * 0.004; });
    if (!this.alive(g)) return;
    // こめかみへ
    const temple = P(0.3, -0.03, -0.22, 0.06, Math.PI / 2 - 0.15, 0.08);
    await go(face, temple, 0.8, Ease.inOut, e => { arm.forEach(m => { m.visible = e > 0.6; }); this.fx.roll = -0.08 * e; this.fx.pitch = 0.04 * e; this.setOverlay({ vig: 0.8 + e * 0.1 }); });
    if (!this.alive(g)) return;
    this.fx.shake = 0.006;
    await this.tween(0.8, e => { this.fx.shake = 0.006 + e * 0.012; });
    Snd.stopHeartbeat();
    if (!this.alive(g)) return;
    this.fx.shake = 0.018;
    const fatal = await this.waitFire(ev.s, ev.n);
    if (!this.alive(g)) return;
    this.fx.shake = 0;
    G.trigger.rotation.x = -0.35; G.hammer.rotation.x = 0;
    if (!fatal) {
      Snd.dryFire();
      this.shakeCam(0.05, 0.3);
      this.fx.roll = 0.04;
      await this.tween(0.4, e => { this.fx.roll = lerp(0.04, 0, e); this.fx.pitch = 0.04 * (1 - e); });
      Snd.breath();
      G.trigger.rotation.x = 0;
      await go(temple, P(0.3, -0.7, -0.4, 0.1, 0.4, 0), 0.8, Ease.inOut, e => this.setOverlay({ vig: 0.9 - e * 0.55 }));
      vg.visible = false;
      s.gunHold.visible = true;
      this.handHide = 0;
      return;
    }
    // 実弾
    Snd.gunshot(true);
    vg.visible = false;
    this.setOverlay({ flash: 1, red: 0.6 });
    this.fx.shake = 0.08;
    s.visualDead = true; s.deadKind = 'gun';
    this.tween(0.5, e => { this.setOverlay({ flash: 1 - e }); this.fx.shake = 0.08 * (1 - e); }, Ease.out);
    Snd.death();
    await this.tween(1.3, e => {
      this.fx.roll = lerp(-0.08, 1.35, Ease.in2(e));
      this.fx.dy = lerp(0, -1.05, Ease.outBounce(e));
      this.fx.dz = lerp(0, 0.1, e);
      this.fx.blur = 6 * e;
      this.fx.sat = 1 - e * 0.7;
      this.setOverlay({ red: 0.6 + e * 0.3 });
    }, Ease.lin);
    Snd.thud();
    await this.tween(2.4, e => { this.setOverlay({ black: e }); }, Ease.in2);
    if (!this.alive(g)) return;
    this.bigText('あなたは死亡しました', 'dead', 2.6);
    s.av.setDeadPose('gun');
    s.blood = this.bloodPool(s.av.headWorld(new THREE.Vector3()), 0.75);
    await this.wait(2.0);
    if (!this.alive(g)) return;
    Object.assign(this.fx, { roll: 0, dy: 0, dz: 0, blur: 0, sat: 0.35, pitch: 0 });
    this.enterGhost();
    this.look.pitch = -0.7; this.look.yaw = 0;
    this.setOverlay({ red: 0, vig: 0.5 });
    await this.tween(1.5, e => { this.setOverlay({ black: 1 - e }); });
  }

  async evBid(ev) {
    const s = this.seats[ev.s], av = s.av;
    Snd.knock();
    if (av && !this.isMe(ev.s)) {
      s.busy++;
      await av.hands(null, 'raise', 0.3, Ease.out);
      await av.hands(null, 'slam', 0.18, Ease.in);
      await this.wait(0.3);
      await av.hands(null, 'rest', 0.4);
      s.busy = Math.max(0, s.busy - 1);
    }
  }

  async evRoll(ev) {
    const g = this.gen;
    this.diceReveal = false; this.rolling = true;
    this.myDiceKey = '';
    // put cups down over dice and shake them
    for (const s of this.seats) {
      s.dice.forEach((d, k) => { d.visible = false; d.scale.setScalar(1); d.position.set(0.06 + s.offs[k][0], 0.796, 0.56 + s.offs[k][1]); });
      s.cup.position.set(0.06, 0.783, 0.56); s.cup.rotation.set(0, 0, 0);
      if (s.i === this.mySeat) s.cup.position.set(0.0, 0.783, 0.75);
      s.cup.visible = !!(this.st && this.st.pl[s.i] && this.st.pl[s.i].a);
      s.cup.traverse(o => { if (o.material) { o.material.transparent = false; o.material.opacity = 1; } });
    }
    Snd.rattle(1.5);
    await this.tween(1.6, (e, raw) => {
      for (const s of this.seats) {
        if (!s.cup.visible) continue;
        s.cup.position.y = 0.783 + Math.abs(Math.sin(raw * 30 + s.i)) * 0.06 * (1 - e);
        s.cup.rotation.z = Math.sin(raw * 25 + s.i * 2) * 0.25 * (1 - e);
      }
    }, Ease.lin);
    for (const s of this.seats) { s.cup.position.y = 0.783; s.cup.rotation.z = 0; }
    Snd.slam(0.5);
    this.rolling = false;
    if (!this.alive(g)) return;
    await this.wait(0.3);
    // lift own cup
    if (this.mySeat >= 0 && this.priv && this.priv.d) {
      const s = this.seats[this.mySeat];
      this.myDiceKey = '';
      this.sync(this.st, this.priv);
      const from = new THREE.Vector3(0.06, 0.783, 0.56);
      s.cup.position.copy(from);
      s.cup.position.set(0.0, 0.783, 0.75);
      await this.tween(0.5, e => { s.cup.position.set(lerp(0.0, 0.17, e), 0.783 + Math.sin(e * Math.PI) * 0.12, lerp(0.75, 0.7, e)); });
    }
  }

  // 自分の視線をそのプレイヤーの方へ向ける（演出用。ドラッグで自由に戻せる）
  lookAtSeat(i, dur = 0.5) {
    if (this.mySeat < 0) return;
    const d = (i - this.mySeat + 4) % 4;
    const ty = d === 1 ? 0.72 : d === 3 ? -0.72 : 0, tp = d === 0 ? -0.62 : -0.32;
    const y0 = this.look.yaw, p0 = this.look.pitch, g = this.gen;
    return this.tween(dur, e => { if (this.alive(g)) { this.look.yaw = lerp(y0, ty, e); this.look.pitch = lerp(p0, tp, e); } });
  }
  // ダイスの公開: 1人ずつカップを開け、該当する目を1個ずつ数えて発表する
  async evDiceLiar(ev) {
    const g = this.gen;
    const rep = (o) => { if (this.onDiceReveal) this.onDiceReveal(Object.assign({ ev }, o)); };
    this.slamBy(ev.s);
    await this.wait(1.2);
    if (!this.alive(g)) return;
    this.diceReveal = true;
    const match = v => v === ev.f;   // 宣言した目だけ
    // 宣言した本人を最後にして、時計回りに公開
    const order = [];
    for (let k = 1; k <= 4; k++) { const i = (ev.tg + k) % 4; if (ev.dice[i]) order.push(i); }
    rep({ type: 'start', order });
    let total = 0;
    for (const i of order) {
      const s = this.seats[i], d = ev.dice[i];
      this.lookAtSeat(i, 0.45);
      s.dice.forEach((m, k) => { m.visible = true; m.scale.setScalar(1); m.quaternion.copy(Models.dieQuat(d[k], (k * 1.7) % 1 - 0.5)); });
      if (i === this.mySeat) s.dice.forEach((m, k) => m.position.set(-0.08 + k * 0.04, 0.796, 0.74 + (k % 2) * 0.02));
      rep({ type: 'open', seat: i, dice: d });
      Snd.cupLift();
      const p0 = s.cup.position.clone(), r0 = s.cup.rotation.x;
      await this.tween(0.6, e => {
        s.cup.position.set(lerp(p0.x, i === this.mySeat ? 0.2 : 0.24, e), p0.y + Math.sin(e * Math.PI) * 0.16, lerp(p0.z, i === this.mySeat ? 0.62 : 0.42, e));
        s.cup.rotation.x = lerp(r0, 0, e);
      }, Ease.out);
      if (!this.alive(g)) return;
      const hits = [];
      d.forEach((v, k) => { if (match(v)) hits.push(k); });
      const gap = hits.length ? Math.min(0.3, 1.0 / hits.length) : 0;
      if (!hits.length) { Snd.dud(); rep({ type: 'count', seat: i, k: -1, hits: 0, total }); await this.wait(1.0); }
      for (let h = 0; h < hits.length; h++) {
        const k = hits[h], m = s.dice[k];
        total++;
        Snd.tick(total);
        this.tween(0.35, e => { m.scale.setScalar(1 + Math.sin(e * Math.PI) * 0.7 + e * 0.3); m.position.y = 0.796 + e * 0.005; });
        rep({ type: 'count', seat: i, k, hits: h + 1, total });
        await this.wait(gap);
        if (!this.alive(g)) return;
      }
      if (hits.length) await this.wait(1.0 - gap * hits.length);
      await this.wait(0.5);
      if (!this.alive(g)) return;
    }
    // 発表
    rep({ type: 'final', total });
    Snd.drumroll(0.9);
    await this.wait(1.0);
    if (!this.alive(g)) return;
    rep({ type: 'done', total });
    const loser = this.name(ev.lo);
    (ev.lie ? Snd.stinger : Snd.win).call(Snd);
    this.bigText(ev.lie ? `実際は${total}個！ハッタリ → ${loser}` : `${total}個！宣言どおり → ${loser}`, ev.lie ? 'red' : 'green', 2.2);
  }

  async evDrink(ev) {
    const g = this.gen;
    const s = this.seats[ev.s];
    if (!s.av) return;
    s.busy++;
    try {
      if (this.isMe(ev.s) && !this.ghost) await this.drinkFirstPerson(ev, s, g);
      else await this.drinkThird(ev, s, g);
    } finally { s.busy = Math.max(0, s.busy - 1); }
  }
  async drinkThird(ev, s, g) {
    const av = s.av;
    av.lookW = 0.3;
    // hide dice
    s.dice.forEach(d => { d.scale.setScalar(1); });
    const vialIdx = Math.max(0, 2 - ev.n);
    await av.hands('rest', 'vialTable', 0.6);
    if (!this.alive(g)) return;
    if (s.vials[vialIdx]) s.vials[vialIdx].visible = false;
    av.vial.visible = true; av.vial.userData.cork.visible = true; av.vial.userData.liq.visible = true;
    av.vialTilt = 0;
    await av.hands('rest', 'mouth', 0.8);
    av.vial.userData.cork.visible = false; Snd.clink();
    await this.tween(0.5, e => { av.vialTilt = e; av.pose.hPitch = 0.45 * e; });
    Snd.gulp(3);
    await this.wait(1.2);
    av.vial.userData.liq.visible = false;
    await this.tween(0.4, e => { av.vialTilt = 1 - e; av.pose.hPitch = 0.45 * (1 - e); });
    av.vial.visible = false; av.vialTilt = 0;
    if (!this.alive(g)) return;
    const P = av.pose;
    if (!ev.fatal) {
      av.hands('throat', 'throat', 0.3);
      Snd.cough(3, 0.9);
      av.setExpr('sick');
      await this.tween(1.6, (e, raw) => { P.shake = 0.03 * (1 - e); P.lean = Math.abs(Math.sin(raw * 12)) * 0.15 * (1 - e); av.setTint(0x6a9a4a, 0.3 * e); });
      av.setExpr('normal'); P.shake = 0; P.lean = 0;
      av.lookW = 1;
      await av.hands('rest', 'rest', 0.5);
      return;
    }
    // fatal poisoning
    s.visualDead = true; s.deadKind = 'poison';
    av.setExpr('fear');
    av.hands('throat', 'throat', 0.25);
    Snd.choke(2.6);
    await this.tween(2.6, (e, raw) => {
      P.shake = 0.03 + e * 0.09;
      P.lean = Math.sin(raw * 9) * 0.12 * (0.5 + e);
      P.hPitch = 0.35 * Math.sin(raw * 6);
      av.setTint(0x55703a, 0.55 * e);
    }, Ease.lin);
    if (!this.alive(g)) return;
    Snd.cough(2, 1.1);
    await this.tween(0.6, (e, raw) => { P.shake = 0.12 * (1 - e * 0.5); P.lean = -0.25 * e; P.hPitch = 0.5 * e; }, Ease.out);
    av.setExpr('dead'); av.dead = true; av.lookW = 0;
    av.hands('table', 'table', 0.45, Ease.in2);
    await this.tween(0.42, e => { P.shake = 0.02; P.lean = lerp(-0.25, 1.08, e); P.hPitch = lerp(0.5, -0.2, e); P.hRoll = 0.55 * e; P.hYaw = 0.5 * e; }, Ease.in);
    P.shake = 0;
    Snd.slam(0.8); Snd.thud();
    this.shakeCam(0.01, 0.3);
    await this.tween(0.8, (e, raw) => { P.shake = e < 0.7 ? 0.02 * Math.max(0, Math.sin(raw * 30)) : 0; });
    av.setDeadPose('poison');
    av.setTint(0x55703a, 0.55);
  }
  async drinkFirstPerson(ev, s, g) {
    const vv = this.vmVial;
    const vialIdx = Math.max(0, 2 - ev.n);
    if (s.vials[vialIdx]) s.vials[vialIdx].visible = false;
    const vvi = vv.userData.vial;
    vv.visible = true; vvi.userData.cork.visible = true; vvi.userData.liq.visible = true;
    vv.position.set(0.18, -0.6, -0.36); vv.rotation.set(0, 0.2, 0);
    Snd.heartbeatLoop(75, 2.5, 0.8, 6);
    await this.tween(0.8, e => { vv.position.set(lerp(0.18, 0.06, e), lerp(-0.6, -0.2, e), -0.32); });
    vvi.userData.cork.visible = false; Snd.clink();
    await this.tween(0.6, e => { vv.position.set(lerp(0.06, 0.03, e), lerp(-0.2, -0.12, e), lerp(-0.32, -0.17, e)); vv.rotation.set(lerp(0, 1.7, e), 0.2, 0); this.fx.pitch = 0.35 * e; });
    Snd.gulp(3);
    await this.wait(1.15);
    vvi.userData.liq.visible = false;
    await this.tween(0.5, e => { vv.position.set(lerp(0.03, 0.2, e), lerp(-0.12, -0.65, e), -0.3); vv.rotation.x = lerp(1.7, 0, e); this.fx.pitch = 0.35 * (1 - e); });
    vv.visible = false;
    Snd.stopHeartbeat();
    if (!this.alive(g)) return;
    if (!ev.fatal) {
      Snd.cough(3, 1);
      this.setOverlay({ green: 0.45 });
      await this.tween(3.0, (e, raw) => {
        this.fx.roll = Math.sin(raw * 2.2) * 0.07 * (1 - e);
        this.fx.blur = 2.5 * (1 - e);
        this.fx.dbl = 10 * (1 - e);
        this.fx.hue = 25 * (1 - e);
        this.setOverlay({ green: 0.45 * (1 - e) + 0.08 });
      }, Ease.lin);
      Object.assign(this.fx, { roll: 0, blur: 0, dbl: 0, hue: 0 });
      return;
    }
    s.visualDead = true; s.deadKind = 'poison';
    Snd.choke(3);
    Snd.heartbeatLoop(110, 5.5, 1, -14);
    await this.tween(3.6, (e, raw) => {
      this.fx.roll = Math.sin(raw * 3.1) * (0.08 + e * 0.25);
      this.fx.fov = Math.sin(raw * 2.2) * (4 + e * 10);
      this.fx.shake = 0.004 + e * 0.02;
      this.fx.blur = 1 + e * 4;
      this.fx.dbl = 6 + e * 22;
      this.fx.hue = 40 * e;
      this.fx.sat = 1 - e * 0.5;
      this.setOverlay({ green: 0.3 + e * 0.35, vig: 0.4 + e * 0.5 });
    }, Ease.lin);
    if (!this.alive(g)) return;
    Snd.cough(2, 1.2);
    await this.tween(0.5, e => { this.fx.pitch = 0.3 * e; this.fx.shake = 0.03; }, Ease.out);
    await this.tween(0.45, e => { this.fx.pitch = lerp(0.3, -1.25, e); this.fx.dy = -0.4 * e; this.fx.dz = 0.35 * e; this.fx.roll = lerp(this.fx.roll, 0.5, e); }, Ease.in);
    this.fx.shake = 0;
    Snd.slam(1); Snd.thud();
    Snd.stopHeartbeat();
    Snd.death();
    await this.tween(2.4, e => { this.setOverlay({ black: e }); this.fx.blur = 5 + e * 4; }, Ease.in2);
    if (!this.alive(g)) return;
    this.bigText('あなたは死亡しました', 'dead', 2.6);
    s.av.setDeadPose('poison'); s.av.setTint(0x55703a, 0.55);
    await this.wait(2.0);
    if (!this.alive(g)) return;
    Object.assign(this.fx, { roll: 0, dy: 0, dz: 0, blur: 0, dbl: 0, hue: 0, fov: 0, pitch: 0, sat: 0.35 });
    this.setOverlay({ green: 0, vig: 0.5 });
    this.enterGhost();
    this.look.pitch = -0.6; this.look.yaw = 0;
    await this.tween(1.5, e => { this.setOverlay({ black: 1 - e }); });
  }

  evLeave(ev) {
    const s = this.seats[ev.s];
    if (s.av) { s.av.root.visible = false; }
    s.gunHold.visible = false;
    s.cup.visible = false; s.dice.forEach(d => d.visible = false); s.vials.forEach(v => v.visible = false);
  }

  // ---------- frame ----------
  update(dt, rawDt = dt) {
    if (this.paused) { dt = 0; rawDt = 0; }
    // 演出は実時間で進める（重い端末やアプリ復帰時に、ゲームの進行より演出が遅れてカードが取り残されないように）
    const tdt = Math.min(Math.max(dt, rawDt), 2);
    this.time += dt;
    const need = this.seats.find(s => s.wantAv);
    if (need) {
      need.wantAv = false;
      need.av = new Avatar(need.ci); need.g.add(need.av.root);
      need.av.root.visible = need.i !== this.mySeat || this.ghost;
      if (this.st) { const p = this.st.pl[need.i]; if (p && p.lf) need.av.root.visible = false; this.sync(this.st, this.priv); }
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      if (tw.gen !== this.gen) { this.tweens.splice(i, 1); tw.res(); continue; }
      tw.t += tdt;
      const raw = clamp(tw.t / tw.dur, 0, 1);
      try { tw.fn(tw.ease(raw), tw.t); } catch (e) { console.error(e); }
      if (raw >= 1) { this.tweens.splice(i, 1); tw.res(); }
    }
    for (const s of this.seats) if (s.av) s.av.update(dt);
    // 自分の首を伸ばしている間は、自分の体と首を表示（頭はカメラの位置なので描かない）
    const meS = this.mySeat >= 0 ? this.seats[this.mySeat] : null;
    // 首を縮めたら視点もふだんの範囲へ戻す
    { const yl = this.yawLim(); if (Math.abs(this.look.yaw) > yl) this.look.yaw = Math.sign(this.look.yaw) * Math.max(yl, Math.abs(this.look.yaw) - dt * 3); }
    // 首を伸ばして他人に近づくと、自分の手札（ビューモデル）が相手の体に隠れてしまうので、
    // カメラを中心に縮めて手前に寄せる（見た目の大きさ・位置は同じまま）
    const vmS = meS && meS.av && !this.ghost ? 1 - 0.62 * clamp((meS.av.nkLen - 0.04) / 0.36, 0, 1) : 1;
    if (Math.abs(vmS - this.vmScale) > 1e-4) { this.vmScale = vmS; this.vm.scale.setScalar(vmS); this.vmLight.intensity = 0.35 * vmS * vmS; }
    if (meS && meS.av && !this.ghost) {
      const out = meS.av.nkLen > 0.02;
      if (meS.av.root.visible !== out) { meS.av.root.visible = out; meS.av.head.visible = !out; if (this.st) this.sync(this.st, this.priv); }
    }
    if (this.revealFloat && this.revealCards.length && !this.pileBusy) this.revealCards.forEach((c, k) => { c.position.y = 0.97 + Math.sin(this.time * 2 + k) * 0.006; });
    // 取り残されたカードの掃除（0.5秒ごと）
    this.strayT += dt; if (this.strayT > 0.5) { this.strayT = 0; this.sweepStray(); }
    this.updateParticles(dt);
    this.updateHand(dt);
    // lamp flicker
    const fl = 1 + (Math.random() < 0.02 ? -0.25 : 0) + Math.sin(this.time * 13) * 0.015;
    this.spot.intensity = 38 * fl; this.lampPt.intensity = 3.5 * fl;
    this.lamp.rotation.z = Math.sin(this.time * 0.6) * 0.015;
    this.dust.rotation.y += dt * 0.02;
    this.beam.material.uniforms.time.value = this.time;
    this.updateSmoke(dt);
    // camera
    const F = this.fx;
    let eye;
    if (this.mySeat < 0) {
      this.camera.position.set(0, 2.25, 2.7);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55 + this.look.pitch * 0.5 + 0.16, this.look.yaw * 0.6, 0, 'YXZ'));
      this.camera.quaternion.copy(q);
    } else {
      const s = this.seats[this.mySeat];
      eye = (this.ghost ? GHOST : EYE).clone();
      // 首伸ばし: カメラ（目）は首の先の頭と一緒に動き、顔の向きは首の向き＋視点
      let nkYaw = 0, nkPitch = 0;
      if (!this.ghost && s.av && s.av.nkLen > 0) {
        const np = neckPose(s.av.nkLen, s.av.nkDir, HEAD0, this._nkPose || (this._nkPose = { tip: new THREE.Vector3(), yaw: 0, pitch: 0 }));
        eye.add(np.tip).sub(HEAD0); nkYaw = np.yaw; nkPitch = np.pitch;
      }
      eye.y += F.dy; eye.z += F.dz;
      if (F.shake) { eye.x += (Math.random() - 0.5) * F.shake; eye.y += (Math.random() - 0.5) * F.shake; }
      this.camera.position.copy(s.g.localToWorld(eye));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(clamp(this.look.pitch + nkPitch, -1.35, 1.0) + F.pitch + (F.shake ? (Math.random() - 0.5) * F.shake * 2 : 0), Math.PI + this.look.yaw + nkYaw, F.roll, 'YXZ'));
      this.camera.quaternion.copy(s.g.quaternion).multiply(q);
    }
    const fov = this.vfov + F.fov;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const filt = [];
    if (F.blur > 0.05) filt.push(`blur(${F.blur.toFixed(1)}px)`);
    if (F.sat !== 1) filt.push(`saturate(${F.sat.toFixed(2)})`);
    if (F.hue) filt.push(`hue-rotate(${F.hue.toFixed(0)}deg)`);
    if (F.dbl > 0.5) filt.push(`drop-shadow(${F.dbl.toFixed(0)}px 0 0 rgba(140,255,150,0.35))`);
    const fs = filt.join(' ');
    if (fs !== this._filt) { this.canvas.style.filter = fs; this._filt = fs; }
    this.updateLabels();
  }
  render() {
    if (this.usePost) this.post.draw(this.time);
    else this.renderer.render(this.scene, this.camera);
  }
}
