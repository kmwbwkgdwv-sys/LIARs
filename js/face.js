// 顔の造形: 単位球上の点を、骨格・目のくぼみ・鼻・唇・頬骨などのある頭部形状に変形する。
// テクスチャ（肌・ひげ・眉）も同じ座標系で描くので、造形と模様がぴったり一致する。
import { clamp, smooth, gauss } from './util.js';

// SphereGeometry の (phi, theta) → 顔座標の単位ベクトル（継ぎ目は後頭部 -Z に来る）
export function unitFromAngles(phi, theta) {
  const sx = -Math.cos(phi) * Math.sin(theta), sy = Math.cos(theta), sz = Math.sin(phi) * Math.sin(theta);
  return [-sz, sy, sx];
}
// テクスチャ座標 (u: 0..1 横, v: 0..1 上から下) → 単位ベクトル
export function unitFromUV(u, v) { return unitFromAngles(u * Math.PI * 2, v * Math.PI); }

export const HEADS = [
  // ヴィクター: 角ばったあご、高い鼻
  { w: 0.075, h: 0.101, d: 0.095, jaw: 0.9, chin: 1.0, nose: 1.15, noseW: 1.0, lips: 0.8, brow: 1.2, cheek: 0.9, fem: 0, age: 0.35 },
  // ローザ: 細いあご、ふっくらした唇
  { w: 0.07, h: 0.097, d: 0.091, jaw: 0.2, chin: 0.6, nose: 0.8, noseW: 0.8, lips: 1.35, brow: 0.5, cheek: 1.2, fem: 1, age: 0.1 },
  // ハンク: 大きな頭、低い鼻
  { w: 0.078, h: 0.102, d: 0.097, jaw: 1.0, chin: 0.9, nose: 1.0, noseW: 1.3, lips: 0.9, brow: 1.4, cheek: 0.8, fem: 0, age: 0.3 },
  // ミロ: 細面、年配
  { w: 0.071, h: 0.103, d: 0.094, jaw: 0.5, chin: 1.2, nose: 1.3, noseW: 0.85, lips: 0.6, brow: 1.0, cheek: 1.1, fem: 0, age: 0.85 },
];

// 顔の部位マスク（テクスチャ描画用）
export function faceMasks(x, y, z, P) {
  const ax = Math.abs(x);
  const front = smooth(0.15, 0.75, z);
  const lipsX = gauss(x, 0.22 + 0.03 * P.lips);
  return {
    ax, front,
    lips: front * lipsX * clamp(gauss(y + 0.50, 0.045) + gauss(y + 0.605, 0.05), 0, 1),
    cheeks: front * gauss(ax - 0.5, 0.2) * gauss(y + 0.15, 0.16),
    noseTip: front * gauss(x, 0.12) * gauss(y + 0.25, 0.08),
    socket: front * gauss(ax - 0.40, 0.16) * gauss(y - 0.1, 0.12),
    ears: gauss(ax - 0.97, 0.12) * gauss(y + 0.02, 0.2),
    forehead: front * smooth(0.25, 0.55, y) * smooth(0.8, 0.6, y) * gauss(x, 0.6),
    crow: front * gauss(ax - 0.62, 0.07) * gauss(y - 0.1, 0.08),
    jawBeard: smooth(-0.1, -0.35, y + 0.25 * (1 - ax)) * smooth(-0.2, 0.25, z) * (1 - front * lipsX * gauss(y + 0.55, 0.09)),
    mustache: front * gauss(x, 0.32) * gauss(y + 0.415, 0.05) * (1 - gauss(x, 0.04) * 0.4),
    brow: (side) => front * gauss(y - 0.30 - 0.04 * Math.cos((ax - 0.38) * 4), 0.035) * smooth(0.1, 0.18, ax) * smooth(0.66, 0.56, ax) * (side * x > 0 ? 1 : 0),
  };
}

// 頭部形状: 単位球上の点 (x,y,z) → 頭の局所座標（メートル）
export function headShape(x, y, z, P, offset = 0) {
  const front = smooth(0.15, 0.75, z);
  const lower = smooth(0.05, -0.95, y);
  let sx = P.w * (1 - (0.30 - 0.1 * P.fem) * lower * lower * (1 - 0.35 * P.jaw));
  const sy = P.h;
  let sz = P.d * (1 - 0.10 * lower * (z < 0 ? 1.4 : 0.5));
  if (z < 0) sz *= 1 + 0.07 * smooth(-0.3, 0.6, y);
  if (y > 0.5) sx *= 1 - 0.07 * smooth(0.5, 1, y);
  let X = x * sx, Y = y * sy, Z = z * sz;
  const ax = Math.abs(x), sg = Math.sign(x) || 1;
  // あご
  Z += 0.010 * P.chin * gauss(x, 0.28) * gauss(y + 0.86, 0.13) * front;
  Y -= 0.005 * P.chin * gauss(x, 0.3) * gauss(y + 0.92, 0.1) * front;
  X += sg * 0.004 * P.jaw * gauss(ax - 0.62, 0.18) * gauss(y + 0.7, 0.14) * smooth(-0.3, 0.3, z);
  // 目のくぼみ
  Z -= 0.011 * front * gauss(ax - 0.40, 0.17) * gauss(y - 0.11, 0.12);
  // 眉骨
  Z += 0.006 * P.brow * front * gauss(y - 0.31, 0.08) * gauss(x, 0.6);
  // 鼻
  const nW = 0.065 * P.noseW + 0.085 * smooth(0.12, -0.28, y) * P.noseW;
  const noseM = gauss(x, nW) * smooth(0.24, 0.05, y) * smooth(-0.40, -0.25, y);
  Z += 0.030 * P.nose * front * noseM * (0.3 + 0.7 * smooth(0.14, -0.24, y));
  Z += 0.006 * front * gauss(x, 0.09 * P.noseW) * gauss(y + 0.265, 0.06);
  Z += 0.007 * front * gauss(ax - 0.12 * P.noseW, 0.06) * gauss(y + 0.305, 0.05);
  Z -= 0.004 * front * gauss(ax - 0.07, 0.03) * gauss(y + 0.335, 0.025); // 鼻の穴
  // 頬骨
  Z += 0.006 * P.cheek * front * gauss(ax - 0.52, 0.16) * gauss(y + 0.02, 0.14);
  X += sg * 0.003 * P.cheek * gauss(ax - 0.75, 0.2) * gauss(y + 0.05, 0.2);
  // 唇
  const lipsX = gauss(x, 0.22 + 0.03 * P.lips);
  Z += front * lipsX * (0.0055 * P.lips * gauss(y + 0.50, 0.04) + 0.006 * P.lips * gauss(y + 0.605, 0.045));
  Z -= 0.0032 * front * gauss(x, 0.24) * gauss(y + 0.553, 0.016);
  Z += 0.003 * front * gauss(x, 0.2) * gauss(y + 0.42, 0.06);
  Z -= 0.0015 * front * gauss(x, 0.04) * gauss(y + 0.43, 0.04); // 人中
  // 口角・ほうれい線
  Z -= 0.0018 * front * gauss(ax - 0.3, 0.05) * gauss(y + 0.45 - (ax - 0.3) * 0.6, 0.1) * (0.4 + P.age);
  // こめかみ
  X -= sg * 0.004 * gauss(ax - 0.85, 0.15) * gauss(y - 0.25, 0.2) * smooth(-0.2, 0.3, z);
  if (offset) {
    const r = Math.hypot(X, Y, Z) || 1;
    X += X / r * offset; Y += Y / r * offset; Z += Z / r * offset;
  }
  return [X, Y, Z];
}

// SphereGeometry を頭の形に変形し、継ぎ目のない解析的な法線を付ける
export function sculptGeometry(THREE, P, wSeg = 96, hSeg = 64, offset = 0) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  const pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal;
  const e = 0.002;
  const P3 = (phi, th) => { const [x, y, z] = unitFromAngles(phi, th); return headShape(x, y, z, P, offset); };
  for (let i = 0; i < pos.count; i++) {
    const phi = uv.getX(i) * Math.PI * 2, th = (1 - uv.getY(i)) * Math.PI;
    const p = P3(phi, th);
    pos.setXYZ(i, p[0], p[1], p[2]);
    const tc = clamp(th, 0.02, Math.PI - 0.02);
    const a = P3(phi + e, tc), b = P3(phi - e, tc), c = P3(phi, tc + e), d = P3(phi, tc - e);
    const tx = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], ty = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    let nx = tx[1] * ty[2] - tx[2] * ty[1], ny = tx[2] * ty[0] - tx[0] * ty[2], nz = tx[0] * ty[1] - tx[1] * ty[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // 外向きにそろえる
    if (nx * p[0] + ny * p[1] + nz * p[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    if (th < 0.03 || th > Math.PI - 0.03) { const r = Math.hypot(p[0], p[1], p[2]) || 1; nx = p[0] / r; ny = p[1] / r; nz = p[2] / r; }
    nor.setXYZ(i, nx, ny, nz);
  }
  pos.needsUpdate = true; nor.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

// 顔の目印になる位置（頭の局所座標）
export function facePoint(P, x, y, depthAdj = 0) {
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  const p = headShape(x, y, z, P);
  p[2] += depthAdj;
  return p;
}
