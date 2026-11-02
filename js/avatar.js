// キャラクター: 彫刻した頭部、眼球とまぶた、髪・ひげ・眉、仕立ての服、5本指の手、IK（腕の自動姿勢）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, Ease } from './util.js';
import { Tex } from './textures.js';
import { Models } from './models.js';
import { HEADS, sculptGeometry, facePoint } from './face.js';

export const CHARS = [
  { name: 'ヴィクター', skin: '#c9a08a', lip: '#a05a58', lipAmt: 0.3, hair: '#24170e', brow: '#1e130a', iris: '#5a3a1e', stubble: 0.7, mustache: true, recede: 0.7,
    jacket: { kind: 'suit', color: '#33363c', alt: '#555960' }, vz: { kind: 'tie', shirt: '#ece6da', tie: '#5a1018' }, pants: '#24262a', shoes: '#140d08',
    hat: 'fedora', hatCol: '#3c3d41', band: '#121212' },
  { name: 'ローザ', skin: '#e3bfab', lip: '#b0182a', lipAmt: 0.85, hair: '#4a180c', brow: '#331006', iris: '#3e6a40', stubble: 0, blush: 0.9, eyeShadow: 0.45, lashes: true, longHair: true, browThick: 0.75,
    jacket: { kind: 'velvet', color: '#6a1018' }, vz: { kind: 'skin' }, pants: '#1e1416', shoes: '#2a0a0e',
    hat: 'wide', hatCol: '#470d13', band: '#c9a14a' },
  { name: 'ハンク', skin: '#a8806a', lip: '#8a4a40', lipAmt: 0.25, hair: '#2b1b0d', brow: '#1f1309', iris: '#3a5a8a', stubble: 1, beard: true, mustache: true, browThick: 1.3,
    jacket: { kind: 'suit', color: '#4a4f2e' }, vz: { kind: 'plaid', shirt: '#7a1a1a', tie: '#1a1a1a' }, pants: '#2b2a22', shoes: '#22160c',
    hat: 'beanie', hatCol: '#6a5a34', band: '#4a3c22' },
  { name: 'ミロ', skin: '#e6cbb8', lip: '#9a6060', lipAmt: 0.25, hair: '#aaa294', brow: '#8e877b', iris: '#6a7480', stubble: 0.25, mustache: true, gray: true, recede: 1.0,
    jacket: { kind: 'velvet', color: '#3b2858' }, vz: { kind: 'bow', shirt: '#efe9df', tie: '#5a1426' }, sleeves: '#d4cec2', pants: '#1a1a24', shoes: '#0e0e10',
    hat: 'top', hatCol: '#121214', band: '#5a1426', monocle: true, lidOpen: 0.75 },
];

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export { V3 };
const DOWN = V3(0, -1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// 手の向きのプリセット（胴体座標）。palm=手のひらの向き、aim=指の向き（手首を曲げる）
const POSE = {
  rest: { palm: [0, -1, 0.15], curl: 0.3 },
  cards: { palm: 'in', curl: 0.55 },
  lap: { palm: [0, -1, 0], curl: 0.35 },
  throat: { palm: [0, 0, -1], curl: 0.5 },
  face: { palm: [0, 0, -1], curl: 0.35 },
  slam: { palm: [0, -1, 0], curl: 0.92 },
  gunTable: { palm: [0, -1, 0.1], curl: 0.35 },
  temple: { palm: [0, 0, -1], aim: [1, 0.02, 0.12], curl: 0.82, index: 0.45 },
  chest: { palm: [1, 0.15, 0], aim: [0.3, -0.12, 1], curl: 0.82, index: 0.45 },
  cyl: { palm: [-1, 0.25, 0], curl: 0.3 },
  vialTable: { palm: 'in', curl: 0.5 },
  mouth: { palm: [0, 0, -1], aim: [1, 0.35, 0.25], curl: 0.78 },
  raise: { palm: [0, -0.4, 1], curl: 0.85 },
  cupTable: { palm: [0, -1, 0], curl: 0.5 },
  table: { palm: [0, -1, 0], curl: 0.12 },
};

const matCache = {};
function charMats(ci) {
  if (matCache[ci]) return matCache[ci];
  const C = CHARS[ci];
  const sk = Tex.skin(ci, C), bs = Tex.bodySkin(ci, C);
  const face = new THREE.MeshPhysicalMaterial({ map: Tex.tex(sk.map), normalMap: Tex.tex(sk.normal, null, false), normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.52, sheen: 0.22, sheenColor: new THREE.Color('#ffb4a0'), sheenRoughness: 0.6, clearcoat: 0.06, clearcoatRoughness: 0.6, envMapIntensity: 0.35 });
  const body = new THREE.MeshPhysicalMaterial({ map: Tex.tex(bs.map, [2, 2]), normalMap: Tex.tex(bs.normal, [2, 2], false), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.55, sheen: 0.22, sheenColor: new THREE.Color('#ffb4a0'), sheenRoughness: 0.6, envMapIntensity: 0.35 });
  const fab = (kind, col, alt, rep = [3, 3], o = {}) => { const f = Tex.fabric(kind, col, alt); return new THREE.MeshPhysicalMaterial(Object.assign({ map: Tex.tex(f.map, rep), normalMap: Tex.tex(f.normal, rep, false), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.82, sheen: kind === 'velvet' ? 1 : 0.3, sheenColor: new THREE.Color(col).lerp(new THREE.Color('#ffffff'), 0.35), sheenRoughness: 0.5, envMapIntensity: 0.25 }, o)); };
  const jacket = fab(C.jacket.kind, C.jacket.color, C.jacket.alt, [3, 3]);
  const sleeve = C.sleeves ? fab('shirt', C.sleeves, null, [4, 4]) : jacket;
  const shirt = fab('shirt', '#d6d0c4', null, [4, 4]);
  const pants = fab('suit', C.pants, null, [3, 3]);
  const shoe = new THREE.MeshPhysicalMaterial({ color: C.shoes, roughness: 0.32, clearcoat: 0.6, envMapIntensity: 0.6 });
  const hatF = fab(C.hat === 'beanie' ? 'knit' : 'felt', C.hatCol, null, C.hat === 'beanie' ? [6, 3] : [2, 2]);
  const band = fab('shirt', C.band, null, [4, 1]);
  const eye = new THREE.MeshPhysicalMaterial({ map: Tex.tex(Tex.eye(C.iris)), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.1 });
  const hairM = (canvas) => new THREE.MeshStandardMaterial({ map: Tex.tex(canvas), alphaTest: 0.4, roughness: 0.55, envMapIntensity: 0.3, side: THREE.FrontSide });
  const scalp = hairM(Tex.hairMask(ci, C, 'scalp'));
  const beard = (C.beard || C.mustache) ? hairM(Tex.hairMask(ci, C, 'beard')) : null;
  const browL = hairM(Tex.hairMask(ci, C, 'brow', 1)), browR = hairM(Tex.hairMask(ci, C, 'brow', -1));
  let vz = null;
  if (C.vz.kind === 'skin') vz = new THREE.MeshPhysicalMaterial({ map: Tex.tex(Tex.vzone('skin', C.skin)), alphaTest: 0.5, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color('#ff8f78'), envMapIntensity: 0.3 });
  else vz = new THREE.MeshPhysicalMaterial({ map: Tex.tex(Tex.vzone(C.vz.kind, C.vz.shirt, C.vz.tie)), alphaTest: 0.5, roughness: 0.75, sheen: 0.3, envMapIntensity: 0.3 });
  const longHair = C.longHair ? new THREE.MeshStandardMaterial({ map: Tex.tex(Tex.hairStrands(C.hair, 'long' + ci), [3, 1]), roughness: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.3 }) : null;
  const lash = new THREE.MeshStandardMaterial({ color: 0x0a0605, roughness: 0.6 });
  const mouth = new THREE.MeshStandardMaterial({ color: 0x1a0606, roughness: 0.9 });
  const teeth = new THREE.MeshPhysicalMaterial({ color: 0xe8e0cc, roughness: 0.3, clearcoat: 0.5 });
  return (matCache[ci] = { face, body, jacket, sleeve, shirt, pants, shoe, hatF, band, eye, scalp, beard, browL, browR, vz, longHair, lash, mouth, teeth });
}

const geoCache = {};
function headGeos(ci) {
  if (geoCache[ci]) return geoCache[ci];
  const P = HEADS[ci], hi = Tex.hi;
  return (geoCache[ci] = {
    head: sculptGeometry(THREE, P, hi ? 112 : 72, hi ? 80 : 52),
    scalp: sculptGeometry(THREE, P, 72, 52, 0.0045),
    beard: sculptGeometry(THREE, P, 72, 52, 0.0032),
    brow: sculptGeometry(THREE, P, 72, 52, 0.0018),
  });
}

// ---- 手（5本指） ----
const handGeo = {};
function hg() {
  if (handGeo.palm) return handGeo;
  // 手のひら: 指の付け根側が広く、手首側が少し細い。手の甲は丸みをつける
  const pg = new RoundedBoxGeometry(0.074, 0.082, 0.026, 4, 0.012);
  const pa = pg.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const t = (y + 0.041) / 0.082;               // 0=指側(-Y) … 1=手首側(+Y)
    pa.setX(i, x * (1 - 0.14 * t));
    pa.setZ(i, z * (1 - 0.18 * t) + (z < 0 ? -0.003 * Math.cos(x / 0.037 * 1.4) : 0.002));
  }
  pg.computeVertexNormals();
  handGeo.palm = pg;
  handGeo.seg = [0.0084, 0.0082, 0.0078, 0.0068].map(r => { const g = new THREE.CapsuleGeometry(r, 0.024, 6, 12); g.scale(1, 1, 0.86); return g; });
  handGeo.seg2 = [0.0074, 0.0073, 0.007, 0.006].map(r => { const g = new THREE.CylinderGeometry(r * 0.85, r, 0.022, 12); g.scale(1, 1, 0.86); return g; });
  handGeo.tip = [0.0063, 0.0062, 0.006, 0.0051].map(r => { const g = new THREE.SphereGeometry(r, 12, 10); g.scale(1, 1.25, 0.86); return g; });
  handGeo.thumb = new THREE.CapsuleGeometry(0.0098, 0.024, 6, 12);
  handGeo.thumb2 = new THREE.CapsuleGeometry(0.0084, 0.018, 6, 12);
  handGeo.knuckle = new THREE.SphereGeometry(0.0092, 12, 10);
  handGeo.nail = new THREE.SphereGeometry(0.0058, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.32);
  handGeo.nailMat = new THREE.MeshPhysicalMaterial({ color: 0xd9b0a4, roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.4 });
  return handGeo;
}
// side: -1 = 右手（体の -X 側）, +1 = 左手。手の局所座標: 指は -Y、手のひらは +Z
export function buildHand(side, skinMat) {
  const G = hg();
  const hand = new THREE.Group();
  const palm = Models.mesh(G.palm, skinMat); palm.position.set(0, -0.045, 0); hand.add(palm);
  const fingers = [];
  const lens = [1.0, 1.1, 1.03, 0.82];
  for (let k = 0; k < 4; k++) {
    // 人差し指が親指側（side*X）、小指が反対側
    const f = new THREE.Group(); f.position.set(side * (0.025 - k * 0.0168), -0.085 + Math.abs(k - 1.3) * 0.002, 0.001);
    const kn = Models.mesh(G.knuckle, skinMat); kn.scale.set(1, 0.8, 0.95); kn.position.z = -0.002; f.add(kn);
    const s1 = Models.mesh(G.seg[k], skinMat); s1.scale.y = lens[k]; s1.position.y = -0.02 * lens[k]; f.add(s1);
    const j = new THREE.Group(); j.position.y = -0.04 * lens[k]; f.add(j);
    const s2 = Models.mesh(G.seg2[k], skinMat); s2.scale.y = lens[k]; s2.position.y = -0.011 * lens[k]; j.add(s2);
    const tp = Models.mesh(G.tip[k], skinMat); tp.position.y = -0.022 * lens[k]; j.add(tp);
    const nail = Models.mesh(G.nail, G.nailMat, false, false); nail.rotation.x = -Math.PI / 2; nail.scale.set(0.95 * (k === 3 ? 0.85 : 1), 1, 1.5); nail.position.set(0, -0.022 * lens[k], -0.0042); j.add(nail);
    hand.add(f);
    fingers.push({ f, j });
  }
  const th = new THREE.Group(); th.position.set(side * 0.033, -0.024, 0.007); hand.add(th);
  const t1 = Models.mesh(G.thumb, skinMat); t1.position.y = -0.019; th.add(t1);
  const tj = new THREE.Group(); tj.position.y = -0.038; th.add(tj);
  const t2 = Models.mesh(G.thumb2, skinMat); t2.position.y = -0.014; tj.add(t2);
  const tn = Models.mesh(G.nail, G.nailMat, false, false); tn.rotation.x = -Math.PI / 2; tn.scale.set(1.15, 1, 1.4); tn.position.set(0, -0.02, -0.0058); tj.add(tn);
  const H = { group: hand, fingers, th, tj, side, curl: 0.3, index: -1 };
  H.setCurl = (c, idx = -1) => {
    H.curl = c; H.index = idx;
    fingers.forEach((F, k) => {
      const cc = k === 0 && idx >= 0 ? idx : c;
      F.f.rotation.x = -cc * 1.35;
      F.j.rotation.x = -cc * 1.55;
      F.f.rotation.z = side * (k - 1.5) * 0.04 * (1 - cc);
    });
    th.rotation.set(-0.25 - c * 0.55, 0, side * (0.75 - c * 0.35));
    tj.rotation.x = -c * 0.9;
  };
  H.setCurl(0.3);
  return H;
}

// 帽子（回転体で形を作る）
function buildHat(kind, M) {
  const g = new THREE.Group();
  const lathe = (pts, seg = 64) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  if (kind === 'fedora') {
    const geo = lathe([[0.001, 0.13], [0.05, 0.128], [0.085, 0.118], [0.105, 0.098], [0.114, 0.05], [0.116, 0.012], [0.12, 0.004], [0.165, 0.002], [0.198, 0.008], [0.205, 0.016], [0.2, 0.011], [0.16, 0.0], [0.115, -0.004], [0.11, -0.004]]);
    geo.scale(1, 1, 1.12);
    const m = Models.mesh(geo, M.hatF); g.add(m);
    const pinch = Models.mesh(new THREE.SphereGeometry(0.06, 24, 12), M.hatF); pinch.scale.set(1, 0.25, 1.4); pinch.position.y = 0.118; g.add(pinch);
    const band = Models.mesh(new THREE.CylinderGeometry(0.1172, 0.118, 0.026, 64, 1, true), M.band); band.scale.z = 1.12; band.position.y = 0.022; g.add(band);
    g.position.set(0, 0.062, -0.006); g.rotation.x = -0.08; g.scale.set(0.8, 0.85, 0.82);
  } else if (kind === 'wide') {
    const geo = lathe([[0.001, 0.115], [0.06, 0.112], [0.095, 0.095], [0.11, 0.06], [0.115, 0.02], [0.12, 0.008], [0.2, 0.0], [0.255, -0.016], [0.262, -0.01], [0.21, 0.004], [0.12, 0.0], [0.112, -0.004]]);
    const m = Models.mesh(geo, M.hatF); g.add(m);
    const band = Models.mesh(new THREE.CylinderGeometry(0.116, 0.118, 0.022, 64, 1, true), M.band); band.position.y = 0.02; g.add(band);
    const feather = Models.mesh(new THREE.ConeGeometry(0.014, 0.22, 8), M.band); feather.position.set(0.1, 0.09, -0.04); feather.rotation.z = -0.7; feather.rotation.x = -0.3; g.add(feather);
    g.position.set(0, 0.058, -0.004); g.rotation.z = 0.12; g.rotation.x = -0.05; g.scale.set(0.82, 0.85, 0.84);
  } else if (kind === 'beanie') {
    const geo = lathe([[0.001, 0.155], [0.05, 0.15], [0.09, 0.128], [0.118, 0.085], [0.126, 0.04], [0.127, 0.0], [0.126, -0.02]], 48);
    geo.scale(1, 1, 1.15);
    const m = Models.mesh(geo, M.hatF); g.add(m);
    const fold = Models.mesh(new THREE.TorusGeometry(0.124, 0.012, 10, 48), M.hatF); fold.rotation.x = Math.PI / 2; fold.scale.set(1, 1.15, 2.2); fold.position.y = 0.0; g.add(fold);
    g.position.set(0, 0.03, -0.006); g.rotation.x = -0.2; g.scale.set(0.69, 0.78, 0.7);
  } else {
    const geo = lathe([[0.001, 0.215], [0.1, 0.215], [0.108, 0.205], [0.098, 0.03], [0.1, 0.012], [0.14, 0.008], [0.168, 0.016], [0.172, 0.01], [0.14, 0.0], [0.1, -0.004]]);
    geo.scale(1, 1, 1.1);
    const m = Models.mesh(geo, M.hatF); g.add(m);
    const band = Models.mesh(new THREE.CylinderGeometry(0.099, 0.1, 0.03, 64, 1, true), M.band); band.scale.z = 1.1; band.position.y = 0.03; g.add(band);
    g.position.set(0, 0.068, -0.006); g.rotation.x = -0.05; g.scale.set(0.8, 0.85, 0.82);
  }
  return g;
}

export class Avatar {
  constructor(ci) {
    ci = ci % 4;
    this.ci = ci;
    const C = this.C = CHARS[ci];
    const P = this.P = HEADS[ci];
    const M = this.M = charMats(ci);
    const HG = headGeos(ci);
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    // ---- 脚 ----
    for (const sx of [-0.1, 0.1]) {
      const th = Models.mesh(new THREE.CylinderGeometry(0.074, 0.064, 0.42, 24), M.pants); th.rotation.x = Math.PI / 2; th.position.set(sx, 0.545, 0.2); this.body.add(th);
      const kn = Models.mesh(new THREE.SphereGeometry(0.064, 20, 14), M.pants); kn.position.set(sx, 0.545, 0.41); this.body.add(kn);
      const sh = Models.mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.46, 24), M.pants); sh.position.set(sx, 0.31, 0.42); this.body.add(sh);
      const shoe = Models.mesh(new RoundedBoxGeometry(0.1, 0.075, 0.27, 3, 0.03), M.shoe); shoe.position.set(sx, 0.045, 0.47); this.body.add(shoe);
    }
    const hip = Models.mesh(new THREE.SphereGeometry(0.17, 28, 16), M.pants); hip.scale.set(1.05, 0.55, 0.8); hip.position.set(0, 0.55, 0.0); this.body.add(hip);
    // ---- 胴体（回転体の上着）----
    this.torso = new THREE.Group(); this.torso.position.set(0, 0.52, -0.02); this.body.add(this.torso);
    const prof = [[0.0, 0.0], [0.152, 0.0], [0.158, 0.06], [0.15, 0.16], [0.156, 0.26], [0.172, 0.36], [0.19, 0.45], [0.198, 0.515], [0.192, 0.56], [0.17, 0.59], [0.125, 0.615], [0.07, 0.632], [0.0, 0.638]];
    const torsoGeo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 64);
    torsoGeo.scale(1, 1, 0.66);
    this.torso.add(Models.mesh(torsoGeo, M.jacket));
    const vprof = prof.slice(3, 12).map(([r, y]) => new THREE.Vector2(r + 0.0035, y));
    const vGeo = new THREE.LatheGeometry(vprof, 24, -0.55, 1.1);
    vGeo.scale(1, 1, 0.66);
    this.torso.add(Models.mesh(vGeo, M.vz, false, true));
    if (C.vz.kind !== 'skin') for (const by of [0.13, 0.21]) {
      const bt = Models.mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.005, 16), Models.m(0x1a1410, { roughness: 0.3 }));
      bt.rotation.x = Math.PI / 2; bt.position.set(0, by, 0.156 * 0.66 + 0.004); this.torso.add(bt);
    }
    // ---- 首と頭 ----
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.615, 0); this.torso.add(this.neck);
    const nk = Models.mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.11, 28), M.body); nk.position.set(0, 0.02, 0.0); this.neck.add(nk);
    if (C.vz.kind !== 'skin') { const col = Models.mesh(new THREE.CylinderGeometry(0.06, 0.066, 0.035, 32, 1, true), M.shirt); col.position.set(0, 0.008, 0.002); col.scale.z = 0.95; this.neck.add(col); }
    this.head = new THREE.Group(); this.head.rotation.order = 'YXZ'; this.head.position.set(0, 0.05, 0); this.neck.add(this.head);
    this.headC = new THREE.Group(); this.headC.position.set(0, 0.105, 0.014); this.headC.scale.setScalar(1.06); this.head.add(this.headC);
    const hc = this.headC;
    hc.add(Models.mesh(HG.head, M.face));
    const scalp = new THREE.Mesh(HG.scalp, M.scalp); scalp.castShadow = true; hc.add(scalp);
    if (M.beard) { const bd = new THREE.Mesh(HG.beard, M.beard); hc.add(bd); }
    this.browMeshes = [new THREE.Mesh(HG.brow, M.browL), new THREE.Mesh(HG.brow, M.browR)];
    this.browMeshes.forEach(b => hc.add(b));
    // ears
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      const lobe = Models.mesh(new THREE.SphereGeometry(0.02, 16, 12), M.face); lobe.scale.set(0.42, 1.45, 0.95); ear.add(lobe);
      const rim = Models.mesh(new THREE.TorusGeometry(0.018, 0.0045, 8, 24, Math.PI * 1.55), M.face); rim.rotation.set(0, s * Math.PI / 2, Math.PI * 0.3); rim.scale.set(1, 1.45, 1); rim.position.x = s * 0.004; ear.add(rim);
      ear.position.set(s * (P.w * 0.97), -0.006, -0.012); ear.rotation.y = s * 0.28;
      hc.add(ear);
    }
    // eyes
    this.eyes = [];
    for (const s of [-1, 1]) {
      const fp = facePoint(P, s * 0.40, 0.115);
      const eg = new THREE.Group(); eg.position.set(fp[0], fp[1], fp[2] - 0.0068);
      const ball = new THREE.Group(); eg.add(ball);
      const em = new THREE.Mesh(new THREE.SphereGeometry(0.0122, 28, 20), M.eye); em.rotation.y = -Math.PI / 2; ball.add(em);
      const lidU = Models.mesh(new THREE.SphereGeometry(0.0134, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), M.face, false, false);
      const lidL = Models.mesh(new THREE.SphereGeometry(0.0131, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), M.face, false, false);
      lidL.rotation.x = Math.PI; eg.add(lidU, lidL);
      let lash = null;
      if (C.lashes) { lash = new THREE.Mesh(new THREE.TorusGeometry(0.0134, 0.0011, 6, 24, Math.PI), M.lash); lash.rotation.set(Math.PI / 2, 0, 0); lidU.add(lash); }
      eg.userData = { ball, lidU, lidL };
      hc.add(eg); this.eyes.push(eg);
    }
    // mouth (open-mouth darkness + teeth)
    const mp = facePoint(P, 0, -0.553);
    this.mouth = new THREE.Group(); this.mouth.position.set(mp[0], mp[1], mp[2] + 0.0009);
    const mo = new THREE.Mesh(new THREE.CircleGeometry(0.011, 24), M.mouth); mo.scale.set(1.5, 0.05, 1); this.mouth.add(mo);
    const te = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.004), M.teeth); te.position.set(0, 0.002, 0.0003); te.visible = false; this.mouth.add(te);
    this.mouthO = mo; this.teeth = te;
    hc.add(this.mouth);
    if (C.monocle) {
      const fp = facePoint(P, -0.40, 0.115);
      const mo2 = Models.mesh(new THREE.TorusGeometry(0.016, 0.0018, 8, 32), Models.m(0xc9a14a, { metalness: 1, roughness: 0.2, envMapIntensity: 1.5 }), false, false);
      mo2.position.set(fp[0], fp[1], fp[2] + 0.006); hc.add(mo2);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 24), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0, clearcoat: 1, envMapIntensity: 2 }));
      lens.position.copy(mo2.position); hc.add(lens);
    }
    if (M.longHair) {
      const pts = [[0.08, 0.075], [0.09, 0.03], [0.096, -0.03], [0.102, -0.09], [0.11, -0.14], [0.122, -0.18], [0.128, -0.2]].map(([r, y]) => new THREE.Vector2(r, y));
      const lh = new THREE.LatheGeometry(pts, 48, Math.PI * 0.27, Math.PI * 1.46);
      lh.scale(1, 1, 1.15);
      const lm = new THREE.Mesh(lh, M.longHair); lm.position.set(0, 0, -0.012); lm.castShadow = true; hc.add(lm);
    }
    this.hat = buildHat(C.hat, M); hc.add(this.hat);
    // ---- 腕 ----
    this.arms = { r: this.makeArm(-1), l: this.makeArm(1) };
    // 手札（他人からは裏面のみ）
    this.held = new THREE.Group(); this.held.position.set(0, 0.4, 0.3); this.held.rotation.set(-0.35, Math.PI, 0); this.torso.add(this.held);
    this.heldN = -1;
    // 右手に持つ銃と毒瓶
    this.gun = Models.revolver(); this.gun.visible = false; this.gun.scale.setScalar(1.1);
    this.gun.quaternion.setFromRotationMatrix(_m.makeBasis(V3(0, 0, 1), V3(-1, 0, 0), V3(0, -1, 0)));
    this.gun.position.set(-0.02, -0.083, 0.022);
    this.arms.r.hand.group.add(this.gun);
    this.vialHold = new THREE.Group(); this.vialHold.position.set(0, -0.05, 0.024);
    this.vialHold.quaternion.setFromRotationMatrix(_m.makeBasis(V3(0, 0, 1), V3(-1, 0, 0), V3(0, -1, 0)));
    this.vial = Models.vial(); this.vial.visible = false; this.vial.position.set(0, -0.045, 0); this.vialHold.add(this.vial);
    this.arms.r.hand.group.add(this.vialHold);
    this.vialTilt = 0;
    // state
    this.yaw = 0; this.pitch = 0; this.tYaw = 0; this.tPitch = -0.25; this.lookW = 1;
    this.pose = { lean: 0, side: 0, twist: 0, hYaw: 0, hPitch: 0, hRoll: 0, shake: 0, bodyY: 0, bodyX: 0, bodyRZ: 0, bodyRX: 0 };
    this.lh = V3(0.17, 0.29, 0.47); this.rh = V3(-0.17, 0.29, 0.47);
    this.lhT = 'rest'; this.rhT = 'rest';
    this.handMoves = [];
    this.t = Math.random() * 10;
    this.expr = 'normal'; this.dead = false;
    this.exprCur = { brow: 0, open: 0, lid: 1, mouth: 0.05 };
    this.exprTgt = { brow: 0, open: 0, lid: 1, mouth: 0.05 };
    this.blinkT = 2 + Math.random() * 3;
    this.lidOpen = C.lidOpen || 1;
    this.inv = new THREE.Matrix4();
    this.root.traverse(o => { if (o.isMesh) o.userData.av = this; });
  }
  makeArm(side) {
    const M = this.M;
    const sh = new THREE.Group(); sh.position.set(side * 0.19, 0.515, 0); this.torso.add(sh);
    const cap = Models.mesh(new THREE.SphereGeometry(0.064, 24, 16), M.sleeve); cap.scale.set(1, 0.9, 0.9); sh.add(cap);
    const up = Models.mesh(new THREE.CylinderGeometry(0.058, 0.05, 0.27, 24), M.sleeve); up.position.y = -0.135; sh.add(up);
    const el = new THREE.Group(); el.position.y = -0.27; sh.add(el);
    const elb = Models.mesh(new THREE.SphereGeometry(0.051, 20, 14), M.sleeve); el.add(elb);
    const fo = Models.mesh(new THREE.CylinderGeometry(0.05, 0.043, 0.23, 24), M.sleeve); fo.position.y = -0.115; el.add(fo);
    const cuff = Models.mesh(new THREE.CylinderGeometry(0.0445, 0.0445, 0.026, 24), M.shirt); cuff.position.y = -0.232; el.add(cuff);
    const wr = Models.mesh(new THREE.CylinderGeometry(0.027, 0.031, 0.05, 20), M.body); wr.position.y = -0.255; el.add(wr);
    const hand = buildHand(side, M.body);
    hand.group.position.y = -0.27; el.add(hand.group);
    return { side, sh, el, hand, palm: V3(0, -1, 0.15), aim: V3(0, -1, 0), aimW: 0, curl: 0.3, idx: -1 };
  }
  seatToTorso(x, y, z) {
    this.torso.updateMatrix();
    this.inv.copy(this.torso.matrix).invert();
    return V3(x, y, z).applyMatrix4(this.inv);
  }
  target(name, side) {
    const s = side === 'r' ? -1 : 1;
    switch (name) {
      case 'rest': return this.seatToTorso(s * 0.17, 0.815, 0.44);
      case 'cards': return V3(s * 0.07, 0.33, 0.25);
      case 'lap': return V3(s * 0.15, 0.08, 0.25);
      case 'throat': return V3(s * 0.05, 0.6, 0.1);
      case 'face': return V3(s * 0.06, 0.74, 0.12);
      case 'slam': return this.seatToTorso(s * 0.16, 0.83, 0.5);
      case 'gunTable': return this.seatToTorso(-0.14, 0.835, 0.42);
      case 'temple': return V3(-0.34, 0.76, -0.03);
      case 'chest': return V3(-0.08, 0.42, 0.27);
      case 'cyl': return this.rh.clone().add(V3(0.085, 0.06, 0.03));
      case 'vialTable': return this.seatToTorso(-0.24, 0.84, 0.4);
      case 'mouth': return V3(-0.17, 0.6, 0.17);
      case 'raise': return V3(s * 0.2, 0.92, 0.25);
      case 'cupTable': return this.seatToTorso(s * 0.02, 0.85, 0.48);
      case 'table': return this.seatToTorso(s * 0.3, 0.82, 0.5);
      default: return this.seatToTorso(s * 0.17, 0.815, 0.44);
    }
  }
  evalT(tg, side) { return tg instanceof THREE.Vector3 ? tg.clone() : (typeof tg === 'function' ? tg() : this.target(tg, side)); }
  poseOf(tg) { return (typeof tg === 'string' && POSE[tg]) || POSE.table; }
  hands(l, r, dur = 0.5, ease = Ease.inOut) {
    return new Promise(res => {
      const m = { t: 0, dur, ease, res, l, r, l0: l != null ? this.lh.clone() : null, r0: r != null ? this.rh.clone() : null };
      this.handMoves = this.handMoves.filter(o => {
        if (l != null && o.l != null) o.l = null;
        if (r != null && o.r != null) o.r = null;
        if (o.l == null && o.r == null) { o.res(); return false; }
        return true;
      });
      if (l != null) this.lhT = l;
      if (r != null) this.rhT = r;
      this.handMoves.push(m);
    });
  }
  setHeld(n) {
    n = Math.max(0, Math.min(5, n | 0));
    if (n === this.heldN) return;
    this.heldN = n;
    while (this.held.children.length) this.held.remove(this.held.children[0]);
    for (let i = 0; i < n; i++) {
      const c = Models.card(null);
      const a = (i - (n - 1) / 2) * 0.16;
      c.position.set(Math.sin(a) * 0.05, Math.cos(a) * 0.05 - 0.05, i * 0.002);
      c.rotation.z = -a;
      this.held.add(c);
    }
  }
  setExpr(e) {
    this.expr = e;
    const T = this.exprTgt;
    if (e === 'fear') Object.assign(T, { brow: 1, lid: 1.25, mouth: 0.55 });
    else if (e === 'dead') Object.assign(T, { brow: 0, lid: 0.0, mouth: 0.35 });
    else if (e === 'sick') Object.assign(T, { brow: 0.5, lid: 0.45, mouth: 0.3 });
    else Object.assign(T, { brow: 0, lid: 1, mouth: 0.05 });
  }
  setTint(col, amt) {
    const c = new THREE.Color(0xffffff).lerp(new THREE.Color(col || 0xffffff), amt || 0);
    this.M.face.color.copy(c); this.M.body.color.copy(c);
  }
  look(yaw, pitch) { this.tYaw = clamp(yaw, -1.7, 1.7); this.tPitch = clamp(pitch, -1.0, 0.9); }
  headWorld(out) { return this.headC.localToWorld(out.set(0, 0.005, 0)); }

  update(dt) {
    this.t += dt;
    const P = this.pose;
    const k = 1 - Math.exp(-dt * 10);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    const breathe = this.dead ? 0 : Math.sin(this.t * 1.6) * 0.012;
    const shake = P.shake ? (Math.random() - 0.5) * P.shake : 0;
    this.body.position.set(P.bodyX, P.bodyY, 0);
    this.body.rotation.set(P.bodyRX, 0, P.bodyRZ);
    this.torso.rotation.set(P.lean + breathe + shake * 0.5, this.yaw * 0.22 * this.lookW + P.twist, P.side + shake * 0.4);
    this.head.rotation.set(-this.pitch * this.lookW + P.hPitch + shake, this.yaw * 0.78 * this.lookW + P.hYaw + shake * 0.6, P.hRoll + shake * 0.5);
    for (let i = this.handMoves.length - 1; i >= 0; i--) {
      const m = this.handMoves[i];
      m.t += dt;
      const e = m.ease(clamp(m.t / m.dur, 0, 1));
      if (m.l != null) this.lh.lerpVectors(m.l0, this.evalT(m.l, 'l'), e);
      if (m.r != null) this.rh.lerpVectors(m.r0, this.evalT(m.r, 'r'), e);
      if (m.t >= m.dur) { this.handMoves.splice(i, 1); m.res(); }
    }
    const movingL = this.handMoves.some(m => m.l != null), movingR = this.handMoves.some(m => m.r != null);
    if (!movingL) this.lh.copy(this.evalT(this.lhT, 'l'));
    if (!movingR) this.rh.copy(this.evalT(this.rhT, 'r'));
    if (shake) { this.lh.x += (Math.random() - 0.5) * shake * 0.08; this.rh.x += (Math.random() - 0.5) * shake * 0.08; }
    const kk = 1 - Math.exp(-dt * 9);
    this.armPose(this.arms.l, this.lhT, kk);
    this.armPose(this.arms.r, this.rhT, kk);
    this.ik(this.arms.l, this.lh);
    this.ik(this.arms.r, this.rh);
    // 毒瓶を傾ける
    this.vialHold.rotation.z = 0;
    this.vial.rotation.z = -this.vialTilt * 1.7;
    // 表情とまばたき
    const E = this.exprCur, T = this.exprTgt, ke = 1 - Math.exp(-dt * 12);
    for (const key of ['brow', 'lid', 'mouth']) E[key] += (T[key] - E[key]) * ke;
    let lid = E.lid;
    if (!this.dead && this.expr !== 'dead') {
      this.blinkT -= dt;
      if (this.blinkT < 0.12) lid = Math.min(lid, Math.abs(this.blinkT - 0.06) / 0.06 * lid);
      if (this.blinkT <= 0) this.blinkT = 2 + Math.random() * 4;
    }
    for (const eg of this.eyes) {
      const u = eg.userData;
      u.lidU.rotation.x = lerpN(0.24, -0.3 * this.lidOpen, clamp(lid, 0, 1.4));
      u.lidL.rotation.x = Math.PI + lerpN(0.2, 0.42, clamp(lid, 0, 1));
      if (!this.dead) { u.ball.rotation.y = clamp(this.yaw * 0.25 * this.lookW, -0.4, 0.4); u.ball.rotation.x = clamp(-this.pitch * 0.25, -0.3, 0.3); }
    }
    this.browMeshes.forEach(b => { b.position.y = E.brow * 0.0045; });
    this.mouthO.scale.y = 0.05 + E.mouth * 0.9;
    this.teeth.visible = E.mouth > 0.25;
  }
  armPose(arm, tg, k) {
    const pz = this.poseOf(tg);
    const pv = (pz.palm === 'in' ? V3(-arm.side * 0.85, 0.15, -0.5) : V3(...pz.palm)).normalize();
    arm.palm.lerp(pv, k).normalize();
    const aimT = pz.aim && arm.side < 0 ? 1 : 0;
    if (pz.aim && arm.side < 0) arm.aim.lerp(V3(...pz.aim).normalize(), k).normalize();
    arm.aimW += (aimT - arm.aimW) * k;
    arm.curl += ((pz.curl != null ? pz.curl : 0.3) - arm.curl) * k;
    const idx = pz.index != null ? pz.index : arm.curl;
    arm.idx += (idx - arm.idx) * k;
    arm.hand.setCurl(arm.curl, arm.idx);
  }
  ik(arm, T) {
    const a = 0.27, b = 0.27;
    const S = arm.sh.position;
    const d = T.clone().sub(S);
    let len = clamp(d.length(), 0.08, a + b - 0.003);
    const dir = d.normalize();
    const pole = V3(arm.side * 0.7, -1, -0.5).normalize();
    const p = pole.sub(dir.clone().multiplyScalar(pole.dot(dir)));
    if (p.lengthSq() < 1e-6) p.set(0, -1, 0);
    p.normalize();
    const cosA = clamp((a * a + len * len - b * b) / (2 * a * len), -1, 1);
    const A = Math.acos(cosA);
    const E = S.clone().addScaledVector(dir, a * Math.cos(A)).addScaledVector(p, a * Math.sin(A));
    const upDir = E.clone().sub(S).normalize();
    arm.sh.quaternion.setFromUnitVectors(DOWN, upDir);
    const Tc = S.clone().addScaledVector(dir, len);
    const fd = Tc.sub(E).normalize();
    // 前腕: 手のひらの向きでひねる
    const Y = fd.clone().negate();
    let Z = arm.palm.clone().sub(Y.clone().multiplyScalar(arm.palm.dot(Y)));
    if (Z.lengthSq() < 1e-5) Z = V3(0, 0, 1).sub(Y.clone().multiplyScalar(Y.z));
    Z.normalize();
    const X = new THREE.Vector3().crossVectors(Y, Z);
    _m.makeBasis(X, Y, Z);
    const qFore = _q.setFromRotationMatrix(_m);
    _q2.copy(arm.sh.quaternion).invert();
    arm.el.quaternion.copy(_q2).multiply(qFore);
    // 手首: 指の向き（aim）へ曲げる
    if (arm.aimW > 0.01) {
      const fdir = fd.clone().lerp(arm.aim, arm.aimW).normalize();
      const Yh = fdir.clone().negate();
      let Zh = arm.palm.clone().sub(Yh.clone().multiplyScalar(arm.palm.dot(Yh)));
      if (Zh.lengthSq() < 1e-5) Zh = Z.clone();
      Zh.normalize();
      const Xh = new THREE.Vector3().crossVectors(Yh, Zh);
      _m.makeBasis(Xh, Yh, Zh);
      const qHand = new THREE.Quaternion().setFromRotationMatrix(_m);
      arm.hand.group.quaternion.copy(qFore.clone().invert()).multiply(qHand);
    } else arm.hand.group.quaternion.identity();
  }
  handPos(side, out = V3()) { return this.arms[side].hand.group.getWorldPosition(out); }
  setDeadPose(kind) {
    this.dead = true;
    this.lookW = 0;
    this.setExpr('dead');
    Object.assign(this.exprCur, this.exprTgt);
    const P = this.pose;
    if (kind === 'poison') {
      Object.assign(P, { lean: 1.08, side: 0.05, twist: 0.1, hYaw: 0.5, hPitch: -0.2, hRoll: 0.55, shake: 0, bodyY: 0, bodyX: 0, bodyRZ: 0, bodyRX: 0 });
      this.lhT = 'table'; this.rhT = 'table';
    } else {
      Object.assign(P, { lean: 0.3, side: 0.2, twist: 0, hYaw: 0.6, hPitch: 0.3, hRoll: 0.4, shake: 0, bodyY: -0.4, bodyX: 0.34, bodyRZ: -1.42, bodyRX: 0.05 });
      this.lhT = V3(0.3, 0.2, 0.25); this.rhT = V3(-0.35, 0.45, 0.2);
    }
    this.gun.visible = false; this.vial.visible = false;
    this.setHeld(0);
  }
  reset() {
    this.dead = false; this.lookW = 1;
    Object.assign(this.pose, { lean: 0, side: 0, twist: 0, hYaw: 0, hPitch: 0, hRoll: 0, shake: 0, bodyY: 0, bodyX: 0, bodyRZ: 0, bodyRX: 0 });
    this.lhT = 'rest'; this.rhT = 'rest';
    this.handMoves.forEach(m => m.res()); this.handMoves = [];
    this.gun.visible = false; this.vial.visible = false; this.vialTilt = 0;
    this.setExpr('normal'); this.setTint(0xffffff, 0);
  }
}
function lerpN(a, b, t) { return a + (b - a) * t; }

// 一人称視点用の腕（手＋袖）
export function buildViewArm(ci, side) {
  const M = charMats(ci % 4);
  const g = new THREE.Group();
  const hand = buildHand(side, M.body);
  g.add(hand.group);
  const sleeve = Models.mesh(new THREE.CylinderGeometry(0.044, 0.05, 0.34, 24), M.sleeve, false, false);
  sleeve.position.y = 0.2; hand.group.add(sleeve);
  const cuff = Models.mesh(new THREE.CylinderGeometry(0.0445, 0.0445, 0.026, 24), M.shirt, false, false); cuff.position.y = 0.035; hand.group.add(cuff);
  const wr = Models.mesh(new THREE.CylinderGeometry(0.027, 0.031, 0.05, 20), M.body, false, false); wr.position.y = 0.012; hand.group.add(wr);
  hand.group.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return { group: g, hand };
}
