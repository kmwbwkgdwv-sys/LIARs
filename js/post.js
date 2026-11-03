// ポストエフェクト: 環境光の遮蔽（AO）、ブルーム（光のにじみ）、映画風の色調、フィルムグレイン、周辺減光、わずかな色収差
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.03 }, vignette: { value: 0.42 }, ca: { value: 0.0018 }, grade: { value: 1.0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, grain, vignette, ca, grade; varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    // 映画風の色調: 影はわずかに青緑、明るい所は暖色（ランプの光が際立つ）＋ゆるいSカーブで締める
    vec3 gradeCol(vec3 c){
      c = clamp(c, 0.0, 1.0);
      float l = luma(c);
      vec3 shadowTint = vec3(0.90, 1.0, 1.10), highTint = vec3(1.07, 1.0, 0.90);
      c *= mix(shadowTint, highTint, smoothstep(0.04, 0.65, l));
      c = clamp(c, 0.0, 1.0);
      vec3 s = c * c * (3.0 - 2.0 * c);
      c = mix(c, s, 0.22);
      l = luma(c);
      c = mix(vec3(l), c, 1.07);
      return c;
    }
    void main(){
      vec2 c = vUv - 0.5; float d = length(c);
      vec2 off = c * ca * d * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col = mix(col, gradeCol(col), grade);
      col *= 1.0 - vignette * smoothstep(0.3, 0.85, d);
      col += (rand(vUv * 1000.0 + time) - 0.5) * grain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// 環境光の遮蔽（物と物が接する所・すき間に柔らかい影）。負荷を抑えるため半分の解像度で計算する。
// 半透明（ガラス・煙・光の筋）や点・線は遮蔽に含めない。
class SoftAOPass extends GTAOPass {
  constructor(scene, camera, w, h, scale) { super(scene, camera, Math.round(w * scale), Math.round(h * scale)); this.aoScale = scale; }
  setSize(w, h) { super.setSize(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale))); }
  overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse(o => {
      cache.set(o, o.visible);
      if (o.isPoints || o.isLine || o.isSprite || (o.userData && o.userData.noAO) || (o.material && !Array.isArray(o.material) && o.material.transparent)) o.visible = false;
    });
  }
}

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.render = new RenderPass(scene, camera);
    this.ao = new SoftAOPass(scene, camera, size.x, size.y, 0.5);
    this.ao.updateGtaoMaterial({ radius: 0.16, distanceExponent: 1.4, thickness: 0.6, scale: 1.25, samples: 12, distanceFallOff: 1.0 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 0.85;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.45, 3.2);
    this.output = new OutputPass();
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.render);
    this.composer.addPass(this.ao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.film);
  }
  setSize(w, h, pr) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
  draw(time) { this.film.uniforms.time.value = time % 100; this.composer.render(); }
}
