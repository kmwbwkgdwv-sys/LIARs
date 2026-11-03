// 小道具と酒場の内装（プリミティブ形状＋プロシージャルテクスチャ）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Tex } from './textures.js';

export const CARD_W = 0.078, CARD_H = 0.112;
export const Models = {
  m(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0, envMapIntensity: 0.5 }, o)); },
  pbr(texRes, o = {}, repeat) {
    const map = Tex.tex(texRes.map, repeat), normalMap = texRes.normal ? Tex.tex(texRes.normal, repeat, false) : null;
    return new THREE.MeshStandardMaterial(Object.assign({ map, normalMap, roughness: 0.8, envMapIntensity: 0.5 }, o));
  },
  // MeshStandardMaterial → MeshPhysicalMaterial（つや・起毛などを足す）
  phys(std, extra = {}) { const m = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(m, std); m.defines = { STANDARD: '', PHYSICAL: '' }; std.dispose(); return Object.assign(m, extra); },
  mesh(geo, mat, cast = true, recv = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; return m; },
  _cardGeo: null, _cardMats: {},
  cardMat(type) {
    if (this._cardMats[type]) return this._cardMats[type];
    const c = type === 'back' ? Tex.cardBack() : Tex.cardFace(type);
    return (this._cardMats[type] = new THREE.MeshPhysicalMaterial({ map: Tex.tex(c), roughness: 0.42, alphaTest: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.6 }));
  },
  card(face) {
    if (!this._cardGeo) this._cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const g = new THREE.Group();
    const front = new THREE.Mesh(this._cardGeo, this.cardMat(face || 'back'));
    const back = new THREE.Mesh(this._cardGeo, this.cardMat('back'));
    back.rotation.y = Math.PI; back.position.z = -0.0006;
    front.castShadow = back.castShadow = true;
    front.receiveShadow = true;
    g.add(front, back);
    g.userData.front = front;
    g.setFace = (f) => { front.material = this.cardMat(f || 'back'); g.userData.face = f; };
    g.userData.face = face;
    return g;
  },

  room(scene) {
    const g = new THREE.Group();
    const W = 9, D = 9, H = 3.3;
    const floor = this.mesh(new THREE.PlaneGeometry(W, D), this.phys(this.pbr(Tex.wood('floor', '#3a2415', '#150a04', 8, 1024, 1024, 5), { roughness: 0.58, normalScale: new THREE.Vector2(0.8, 0.8) }, [3, 3]), { clearcoat: 0.28, clearcoatRoughness: 0.42 }), false, true);
    floor.rotation.x = -Math.PI / 2; g.add(floor);
    const wallMat = this.pbr(Tex.wall(), { roughness: 0.88 }, [4, 1]);
    const mkWall = (w, x, z, ry) => { const m = this.mesh(new THREE.PlaneGeometry(w, H), wallMat, false, true); m.position.set(x, H / 2, z); m.rotation.y = ry; g.add(m); };
    mkWall(W, 0, -D / 2, 0); mkWall(W, 0, D / 2, Math.PI); mkWall(D, -W / 2, 0, Math.PI / 2); mkWall(D, W / 2, 0, -Math.PI / 2);
    const ceil = this.mesh(new THREE.PlaneGeometry(W, D), this.m(0x140c08, { roughness: 1 }), false, false);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; g.add(ceil);
    // ceiling beams
    const beamMat = this.m(0x22140c, { roughness: 0.9 });
    for (let i = -3; i <= 3; i += 1.5) { const b = this.mesh(new THREE.BoxGeometry(W, 0.18, 0.2), beamMat, false, false); b.position.set(0, H - 0.09, i); g.add(b); }

    // bar counter along north wall
    const counterMat = this.pbr(Tex.wood('bar', '#4a2a17', '#1a0c05', 2, 1024, 512, 9), { roughness: 0.45 }, [3, 1]);
    const counter = this.mesh(new THREE.BoxGeometry(5.5, 1.1, 0.7), counterMat); counter.position.set(-0.6, 0.55, -3.6); g.add(counter);
    const top = this.mesh(new RoundedBoxGeometry(5.7, 0.06, 0.85, 2, 0.02), this.m(0x2a160b, { roughness: 0.22, envMapIntensity: 0.9 })); top.position.set(-0.6, 1.13, -3.6); g.add(top);
    // shelves with bottles behind
    const shelfMat = this.m(0x2a170c, { roughness: 0.8 });
    const glassCols = [0x3b6b2a, 0x7a3a12, 0x2a3f6b, 0x8a6a22, 0x5a1a2a, 0x2f4f3f];
    const bottleGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.26, 20);
    const neckGeo = new THREE.CylinderGeometry(0.015, 0.03, 0.1, 14);
    for (let s = 0; s < 3; s++) {
      const sh = this.mesh(new THREE.BoxGeometry(4.6, 0.04, 0.3), shelfMat, false, true); sh.position.set(-0.6, 1.5 + s * 0.48, -4.33); g.add(sh);
      for (let b = 0; b < 15; b++) {
        if (Math.random() < 0.15) continue;
        const col = glassCols[(b + s * 3) % glassCols.length];
        const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.82, emissive: col, emissiveIntensity: 0.1, clearcoat: 1, envMapIntensity: 1.2 });
        const bt = new THREE.Group();
        const body = this.mesh(bottleGeo, mat, false, false); body.position.y = 0.13;
        const neck = this.mesh(neckGeo, mat, false, false); neck.position.y = 0.31;
        bt.add(body, neck);
        if (Math.random() < 0.6) {
          const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.051, 0.09, 20, 1, true), new THREE.MeshStandardMaterial({ map: Tex.tex(Tex.bottleLabel(b + s)), roughness: 0.9, envMapIntensity: 0.3 }));
          lab.position.y = 0.12; bt.add(lab);
        }
        bt.position.set(-2.7 + b * 0.3 + (Math.random() - 0.5) * 0.06, 1.52 + s * 0.48, -4.33 + (Math.random() - 0.5) * 0.08);
        const sc = 0.8 + Math.random() * 0.45; bt.scale.set(1, sc, 1);
        g.add(bt);
      }
    }
    // stools at bar
    for (let i = 0; i < 4; i++) { const st = this.stool(); st.position.set(-2.4 + i * 1.2, 0, -2.9); g.add(st); }
    // barrels in south-east corner
    const barrelMat = this.pbr(Tex.wood('barrel', '#4a2c18', '#1a0d05', 6, 512, 512, 13), { roughness: 0.8 });
    const hoopMat = this.m(0x2b2b2b, { metalness: 0.8, roughness: 0.45, envMapIntensity: 1 });
    [[3.6, 3.5], [3.6, 2.7], [2.85, 3.6]].forEach(([x, z], i) => {
      const br = new THREE.Group();
      const body = this.mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.9, 32), barrelMat); body.position.y = 0.45; br.add(body);
      for (const y of [0.12, 0.45, 0.78]) { const h = this.mesh(new THREE.TorusGeometry(0.335, 0.012, 8, 40), hoopMat); h.rotation.x = Math.PI / 2; h.position.y = y; br.add(h); }
      br.position.set(x, 0, z); g.add(br);
      if (i === 0) { const b2 = br.clone(); b2.position.set(3.6, 0.9, 3.1); g.add(b2); }
    });
    // door on east wall
    const door = this.mesh(new THREE.BoxGeometry(0.06, 2.2, 1.1), this.m(0x1d110a, { roughness: 0.7 })); door.position.set(4.47, 1.1, -1.5); g.add(door);
    const knob = this.mesh(new THREE.SphereGeometry(0.035, 8, 8), this.m(0x8a6a2a, { metalness: 0.8, roughness: 0.3 })); knob.position.set(4.42, 1.05, -1.1); g.add(knob);
    // picture frames on west wall
    for (let i = 0; i < 3; i++) {
      const fr = this.mesh(new THREE.BoxGeometry(0.04, 0.6, 0.45), this.m(0x3a2a10, { metalness: 0.4, roughness: 0.5 })); fr.position.set(-4.47, 1.9, -1.5 + i * 1.5); g.add(fr);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.5), this.m([0x2a1a14, 0x1a2420, 0x24141a][i], { roughness: 1 })); pic.position.set(-4.44, 1.9, -1.5 + i * 1.5); pic.rotation.y = Math.PI / 2; g.add(pic);
    }
    // wall sconces
    for (const [x, z, ry] of [[-4.42, -0.75, Math.PI / 2], [-4.42, 2.25, Math.PI / 2], [4.42, 1.5, -Math.PI / 2]]) {
      const sc = new THREE.Group();
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.14, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 1.2, side: THREE.DoubleSide }));
      sc.add(shade); sc.position.set(x, 2.1, z); sc.rotation.y = ry; g.add(sc);
      const pl = new THREE.PointLight(0xff9a40, 2.2, 4.5, 2); pl.position.set(x + Math.sign(-x) * 0.2, 2.1, z); g.add(pl);
    }
    // bar back-light
    const bl = new THREE.PointLight(0xff8a3a, 3.5, 5, 2); bl.position.set(-0.6, 2.2, -3.8); g.add(bl);
    scene.add(g);
    return g;
  },
  stool() {
    const g = new THREE.Group();
    const seat = this.mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 14), this.m(0x3a1a10, { roughness: 0.6 })); seat.position.y = 0.78; g.add(seat);
    const pole = this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8), this.m(0x333333, { metalness: 0.7, roughness: 0.4 })); pole.position.y = 0.38; g.add(pole);
    const base = this.mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 14), this.m(0x2a2a2a, { metalness: 0.6, roughness: 0.4 })); base.position.y = 0.015; g.add(base);
    return g;
  },
  table() {
    const g = new THREE.Group();
    const wood = this.phys(this.pbr(Tex.wood('table', '#5a3420', '#20100a', 1, 1024, 1024, 17), { roughness: 0.48 }), { clearcoat: 0.55, clearcoatRoughness: 0.28 });
    const top = this.mesh(new RoundedBoxGeometry(1.32, 0.07, 1.32, 3, 0.02), wood); top.position.y = 0.745; g.add(top);
    const felt = this.mesh(new THREE.PlaneGeometry(1.12, 1.12), this.phys(this.pbr(Tex.felt(), { roughness: 0.96, envMapIntensity: 0.15, normalScale: new THREE.Vector2(0.6, 0.6) }), { sheen: 0.7, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x5aa070) }), false, true);
    felt.material.normalMap.wrapS = felt.material.normalMap.wrapT = THREE.RepeatWrapping; felt.material.normalMap.repeat.set(6, 6);
    felt.rotation.x = -Math.PI / 2; felt.position.y = 0.781; g.add(felt);
    // rim
    const rimMat = this.phys(this.pbr(Tex.wood('rim', '#3a1e0e', '#140804', 1, 512, 256, 29), { roughness: 0.5 }), { clearcoat: 0.7, clearcoatRoughness: 0.22 });
    for (let i = 0; i < 4; i++) {
      const r = this.mesh(new RoundedBoxGeometry(1.36, 0.05, 0.12, 2, 0.02), rimMat);
      const a = i * Math.PI / 2; r.position.set(Math.sin(a) * 0.62, 0.79, Math.cos(a) * 0.62); r.rotation.y = a; g.add(r);
    }
    const legMat = this.m(0x2a160b, { roughness: 0.7 });
    for (const [x, z] of [[0.52, 0.52], [-0.52, 0.52], [0.52, -0.52], [-0.52, -0.52]]) { const l = this.mesh(new THREE.BoxGeometry(0.09, 0.71, 0.09), legMat); l.position.set(x, 0.355, z); g.add(l); }
    // ashtray + stains
    const ash = new THREE.Group();
    const ab = this.mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.025, 16), this.m(0x2a3a3a, { metalness: 0.2, roughness: 0.2, transparent: true, opacity: 0.85 })); ash.add(ab);
    const butt = this.mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), this.m(0xd8cbb0)); butt.rotation.z = 1.3; butt.position.set(-0.02, 0.016, 0.015); ash.add(butt);
    // 火のついたタバコ（灰皿のふちに置き、先から煙が立ちのぼる）
    const cig = new THREE.Group();
    const paper = this.mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.058, 10), this.m(0xeee6d6, { roughness: 0.85 })); paper.position.y = 0.029; cig.add(paper);
    const filt = this.mesh(new THREE.CylinderGeometry(0.0043, 0.0043, 0.02, 10), this.m(0xc98a3a, { roughness: 0.8 })); filt.position.y = -0.01; cig.add(filt);
    const ashTip = this.mesh(new THREE.CylinderGeometry(0.0041, 0.0042, 0.008, 10), this.m(0x6a6560, { roughness: 1 })); ashTip.position.y = 0.062; cig.add(ashTip);
    const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.0043, 0.0043, 0.003, 10), new THREE.MeshStandardMaterial({ color: 0x200500, emissive: 0xff4a10, emissiveIntensity: 3.5 })); ember.position.y = 0.0575; cig.add(ember);
    cig.rotation.z = -1.42; cig.position.set(0.03, 0.017, -0.004); ash.add(cig);
    ash.position.set(0.44, 0.795, -0.44); g.add(ash);
    g.userData.ember = ember;
    g.userData.smokeSrc = new THREE.Vector3(0.44 + 0.03 + 0.066, 0.795 + 0.02, -0.444);
    return g;
  },
  chair() {
    const g = new THREE.Group();
    const wood = this.pbr(Tex.wood('chair', '#4a2a16', '#1a0c05', 1, 512, 512, 23), { roughness: 0.62 });
    const seat = this.mesh(new RoundedBoxGeometry(0.46, 0.05, 0.44, 2, 0.015), wood); seat.position.y = 0.48; g.add(seat);
    for (const [x, z] of [[0.2, 0.19], [-0.2, 0.19], [0.2, -0.19], [-0.2, -0.19]]) { const l = this.mesh(new THREE.BoxGeometry(0.04, 0.48, 0.04), wood); l.position.set(x, 0.24, z); g.add(l); }
    for (const x of [0.2, -0.2]) { const p = this.mesh(new THREE.BoxGeometry(0.04, 0.55, 0.04), wood); p.position.set(x, 0.78, -0.2); g.add(p); }
    for (const y of [0.78, 0.98]) { const r = this.mesh(new RoundedBoxGeometry(0.44, 0.08, 0.025, 2, 0.008), wood); r.position.set(0, y, -0.2); g.add(r); }
    return g;
  },
  // リアルなリボルバー: 側面形状を押し出したフレーム、フルラグ銃身、溝つきシリンダー（スイングアウト可）、
  // 撃鉄・引き金、チェッカリング入り木製グリップ。原点=握る位置、銃身は +Z、上は +Y、銃口 ≈ (0, 0.05, 0.19)
  _gunMats: null,
  gunMats() {
    if (this._gunMats) return this._gunMats;
    const chk = Tex.checker();
    const wood = Tex.wood('grip', '#5a2c14', '#1e0a03', 1, 256, 256, 41);
    this._gunMats = {
      steel: new THREE.MeshPhysicalMaterial({ color: 0x2a2e36, metalness: 1, roughness: 0.26, clearcoat: 0.4, clearcoatRoughness: 0.25, envMapIntensity: 1.6 }),
      steelD: new THREE.MeshPhysicalMaterial({ color: 0x15171b, metalness: 1, roughness: 0.34, envMapIntensity: 1.3 }),
      bright: new THREE.MeshPhysicalMaterial({ color: 0x8a8d94, metalness: 1, roughness: 0.18, envMapIntensity: 1.8 }),
      hole: new THREE.MeshBasicMaterial({ color: 0x020202 }),
      brass: new THREE.MeshPhysicalMaterial({ color: 0xc9a04a, metalness: 1, roughness: 0.25, envMapIntensity: 1.6 }),
      lead: new THREE.MeshPhysicalMaterial({ color: 0x5a5856, metalness: 0.6, roughness: 0.5, envMapIntensity: 0.8 }),
      grip: new THREE.MeshPhysicalMaterial({ map: Tex.tex(wood.map), normalMap: Tex.tex(chk, [3, 3], false), normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.7 }),
    };
    return this._gunMats;
  },
  extrude(points, depth, bevel = 0.0015, holes) {
    const sh = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
    if (holes) holes.forEach(hp => sh.holes.push(new THREE.Path(hp.map(([u, v]) => new THREE.Vector2(u, v)))));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-Math.PI / 2);          // 形状のu → +Z, 押し出し → X
    return g;
  },
  revolver() {
    const M = this.gunMats();
    const g = new THREE.Group();
    const add = (geo, mat, parent = g) => { const m = this.mesh(geo, mat); parent.add(m); return m; };
    // フレーム（側面形状）: トップストラップ、シリンダー窓、グリップフレーム
    add(this.extrude([
      [-0.044, 0.056], [-0.036, 0.068], [-0.026, 0.0735], [0.03, 0.0735], [0.04, 0.071], [0.044, 0.064], [0.044, 0.03],
      [0.03, 0.024], [0.012, 0.022], [0.0, 0.016], [-0.012, 0.004], [-0.016, -0.02], [-0.022, -0.05], [-0.03, -0.066],
      [-0.05, -0.066], [-0.06, -0.05], [-0.062, -0.02], [-0.056, 0.012], [-0.05, 0.034],
    ], 0.017, 0.0015, [[[-0.025, 0.029], [0.024, 0.029], [0.024, 0.068], [-0.025, 0.068]]]), M.steel);
    // 木製グリップ
    add(this.extrude([[-0.017, 0.006], [-0.02, -0.02], [-0.026, -0.05], [-0.033, -0.063], [-0.049, -0.063], [-0.058, -0.048], [-0.059, -0.02], [-0.053, 0.008], [-0.045, 0.018], [-0.028, 0.016]], 0.028, 0.004), M.grip);
    const screw = add(new THREE.CylinderGeometry(0.0028, 0.0028, 0.03, 14), M.bright); screw.rotation.z = Math.PI / 2; screw.position.set(0, -0.024, -0.038);
    // 用心鉄（トリガーガード）
    const guard = add(new THREE.TorusGeometry(0.0145, 0.0025, 10, 28, Math.PI * 1.25), M.steel);
    guard.rotation.set(0, Math.PI / 2, 0); guard.position.set(0, 0.01, 0.004); guard.rotation.x = Math.PI * 0.95;
    // 引き金
    const trig = new THREE.Group(); trig.position.set(0, 0.02, 0.002); g.add(trig);
    const tg = add(new THREE.TorusGeometry(0.012, 0.0022, 8, 16, Math.PI * 0.5), M.bright, trig); tg.rotation.set(0, Math.PI / 2, Math.PI * 1.15); tg.position.set(0, -0.004, -0.004);
    // 撃鉄
    const ham = new THREE.Group(); ham.position.set(0, 0.04, -0.034); g.add(ham);
    add(this.extrude([[0.0, 0.0], [0.006, 0.006], [0.004, 0.022], [-0.006, 0.033], [-0.016, 0.034], [-0.014, 0.028], [-0.006, 0.024], [-0.004, 0.006]], 0.007, 0.001), M.steelD, ham);
    // 銃身＋フルラグ＋リブ＋照準
    const barrel = add(new THREE.CylinderGeometry(0.0088, 0.0088, 0.15, 28), M.steel); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.05, 0.118);
    const lug = add(new RoundedBoxGeometry(0.0125, 0.016, 0.142, 3, 0.004), M.steel); lug.position.set(0, 0.04, 0.114);
    const rib = add(new RoundedBoxGeometry(0.009, 0.006, 0.15, 2, 0.002), M.steel); rib.position.set(0, 0.059, 0.118);
    const fs = add(new THREE.BoxGeometry(0.0025, 0.007, 0.012), M.steelD); fs.position.set(0, 0.064, 0.186);
    const rs = add(new THREE.BoxGeometry(0.01, 0.004, 0.008), M.steelD); rs.position.set(0, 0.076, -0.022);
    const bore = add(new THREE.CircleGeometry(0.0045, 20), M.hole); bore.position.set(0, 0.05, 0.1932);
    const muzzleRing = add(new THREE.TorusGeometry(0.0067, 0.0021, 8, 24), M.bright); muzzleRing.position.set(0, 0.05, 0.193);
    const ejRod = add(new THREE.CylinderGeometry(0.0024, 0.0024, 0.05, 12), M.bright); ejRod.rotation.x = Math.PI / 2; ejRod.position.set(0, 0.032, 0.047);
    // シリンダー: クレーン（スイングアウト）→ 回転部
    const crane = new THREE.Group(); crane.position.set(0, 0.02, 0); g.add(crane);
    const yoke = add(new RoundedBoxGeometry(0.008, 0.032, 0.012, 2, 0.003), M.steel, crane); yoke.position.set(0, 0.014, 0.026);
    const cyl = new THREE.Group(); cyl.position.set(0, 0.03, -0.0005); crane.add(cyl);
    const prof = [[0.0, -0.0235], [0.0185, -0.0235], [0.021, -0.021], [0.021, 0.019], [0.0185, 0.0235], [0.0, 0.0235]].map(([r, z]) => new THREE.Vector2(r, z));
    const cg = new THREE.LatheGeometry(prof, 48); cg.rotateX(Math.PI / 2);
    add(cg, M.steel, cyl);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, af = a + Math.PI / 6;
      const fl = add(new RoundedBoxGeometry(0.0065, 0.0035, 0.026, 2, 0.0015), M.steelD, cyl);
      fl.position.set(Math.cos(af) * 0.0198, Math.sin(af) * 0.0198, 0.002); fl.rotation.z = af + Math.PI / 2;
      // 6発すべて同じ見た目の薬莢（実弾1発＋空砲5発は外から区別できない → 見た目から当たりは読めない）
      const ch = add(new THREE.CircleGeometry(0.0046, 16), M.hole, cyl); ch.position.set(Math.cos(a) * 0.0125, Math.sin(a) * 0.0125, 0.0237);
      const tip = add(new THREE.CircleGeometry(0.0033, 14), M.lead, cyl); tip.position.set(Math.cos(a) * 0.0125, Math.sin(a) * 0.0125, 0.024);
      const rim = add(new THREE.CylinderGeometry(0.0056, 0.0056, 0.0016, 18), M.brass, cyl); rim.rotation.x = Math.PI / 2; rim.position.set(Math.cos(a) * 0.0125, Math.sin(a) * 0.0125, -0.0242);
      const pr = add(new THREE.CircleGeometry(0.0017, 12), M.bright, cyl); pr.rotation.y = Math.PI; pr.position.set(Math.cos(a) * 0.0125, Math.sin(a) * 0.0125, -0.0251);
    }
    const star = add(new THREE.CylinderGeometry(0.0062, 0.0062, 0.002, 6), M.bright, cyl); star.rotation.x = Math.PI / 2; star.position.z = -0.0246;
    g.userData = { cyl, crane, hammer: ham, trigger: trig };
    return g;
  },
  vial() {
    const g = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xb8e8c8, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.32, clearcoat: 1, envMapIntensity: 1.6 });
    const liquid = new THREE.MeshStandardMaterial({ color: 0x3cff6a, emissive: 0x1c8a30, emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.85 });
    const body = this.mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.09, 24), glass, true, false); body.position.y = 0.045; g.add(body);
    const liq = this.mesh(new THREE.CylinderGeometry(0.025, 0.027, 0.065, 24), liquid, false, false); liq.position.y = 0.035; g.add(liq);
    const neck = this.mesh(new THREE.CylinderGeometry(0.01, 0.022, 0.035, 10), glass, false, false); neck.position.y = 0.105; g.add(neck);
    const cork = this.mesh(new THREE.CylinderGeometry(0.011, 0.01, 0.02, 8), this.m(0x8a6a40), false, false); cork.position.y = 0.13; g.add(cork);
    const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.0305, 0.0305, 0.04, 24, 1, true, -0.9, 1.8), new THREE.MeshStandardMaterial({ map: Tex.tex(Tex.skullLabel()), roughness: 0.9, envMapIntensity: 0.3 }));
    lab.position.y = 0.05; g.add(lab);
    g.userData.liq = liq; g.userData.cork = cork;
    return g;
  },
  cup() {
    const g = new THREE.Group();
    const mat = this.pbr(Tex.fabric('leather', '#3a1c10'), { roughness: 0.7, side: THREE.DoubleSide });
    const body = this.mesh(new THREE.CylinderGeometry(0.062, 0.072, 0.12, 36, 1, true), mat); body.position.y = 0.06; g.add(body);
    const cap = this.mesh(new THREE.CircleGeometry(0.062, 20), mat); cap.rotation.x = -Math.PI / 2; cap.position.y = 0.12; g.add(cap);
    const rim = this.mesh(new THREE.TorusGeometry(0.072, 0.006, 8, 40), this.m(0x8a6a2a, { metalness: 1, roughness: 0.35, envMapIntensity: 1.2 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.002; g.add(rim);
    return g;
  },
  _dieMats: null,
  die() {
    if (!this._dieMats) this._dieMats = [1, 6, 2, 5, 3, 4].map(n => new THREE.MeshPhysicalMaterial({ map: Tex.tex(Tex.die(n)), roughness: 0.3, clearcoat: 0.6, envMapIntensity: 0.7 }));
    if (!this._dieGeo) this._dieGeo = new RoundedBoxGeometry(0.026, 0.026, 0.026, 3, 0.004);
    const m = this.mesh(this._dieGeo, this._dieMats);
    return m;
  },
  dieQuat(v, yaw) {
    const e = { 1: [0, 0, Math.PI / 2], 6: [0, 0, -Math.PI / 2], 2: [0, 0, 0], 5: [Math.PI, 0, 0], 3: [-Math.PI / 2, 0, 0], 4: [Math.PI / 2, 0, 0] }[v] || [0, 0, 0];
    const qf = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw || 0);
    return qy.multiply(qf);
  },
  // ランプの光の筋（たばこの煙で光が見える感じ）。縁ほど薄く、下に行くほどふわっと消える
  lightBeam() {
    const h = 1.1;
    const geo = new THREE.CylinderGeometry(0.33, 0.7, h, 64, 16, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0xffd6a0) }, strength: { value: 0.2 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW;
        void main(){ vH = position.y / ${h.toFixed(3)} + 0.5; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
          vec4 mv = viewMatrix * wp; vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float time, strength; uniform vec3 color; varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
        void main(){
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float edge = pow(facing, 3.0);
          float vert = smoothstep(0.0, 0.6, vH) * (1.0 - smoothstep(0.7, 1.0, vH)) * (0.5 + 0.5 * vH);   // 上下とも端はふわっと消す
          float n = noise(vW * 3.0 + vec3(0.0, -time * 0.1, time * 0.04)) * 0.6 + noise(vW * 7.5 + vec3(time * 0.07, -time * 0.18, 0.0)) * 0.4;
          float a = edge * vert * (0.5 + 0.5 * n) * strength;
          gl_FragColor = vec4(color * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat); m.userData.noAO = true; m.renderOrder = 2;
    m.userData.h = h;
    return m;
  },
  lamp() {
    const g = new THREE.Group();
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.38, 0.24, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x1d3a26, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide, envMapIntensity: 1 }));
    shade.position.y = 0; g.add(shade);
    // シェードの内側: 電球に近い上ほど明るいグラデーションで光る（下からのぞいても白く飛ばない）
    const gc = document.createElement('canvas'); gc.width = 4; gc.height = 64;
    const gx = gc.getContext('2d'), gg = gx.createLinearGradient(0, 0, 0, 64);
    gg.addColorStop(0, '#fff2d0'); gg.addColorStop(0.35, '#e8b46a'); gg.addColorStop(1, '#5a3412');
    gx.fillStyle = gg; gx.fillRect(0, 0, 4, 64);
    const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.099, 0.378, 0.238, 32, 1, true), new THREE.MeshBasicMaterial({ map: gt, color: new THREE.Color(1.6, 1.35, 1.1), side: THREE.BackSide }));
    g.add(inner);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 2.2 }));
    bulb.position.y = -0.06; g.add(bulb);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.2, 6), this.m(0x111111)); cable.position.y = 0.72; g.add(cable);
    g.userData.bulb = bulb;
    return g;
  },
};
