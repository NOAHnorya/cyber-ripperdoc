import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 胶片颗粒 + 暗角 + 轻微色差 + 扫描线
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.05 },
    uVignette: { value: 1.0 },
    uAberration: { value: 0.0025 },
    // 义眼扫描模式：青色色调、故障错位
    uTint: { value: 0 },
    uGlitch: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uTint;
    uniform float uGlitch;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      if (uGlitch > 0.001) {
        float row = floor(uv.y * 48.0);
        float frame = floor(uTime * 24.0);
        float hit = step(1.0 - uGlitch * 0.5, rand(vec2(row, frame)));
        uv.x += (rand(vec2(frame, row)) - 0.5) * 0.08 * hit * uGlitch;
      }
      vec2 dir = uv - 0.5;
      float ab = uAberration + uGlitch * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;
      if (uTint > 0.001) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 optic = vec3(0.35, 0.95, 1.1) * l * 1.1 + vec3(0.0, 0.018, 0.03);
        // 暖色（手术部位的琥珀高亮）不染青，保持醒目
        float warm = smoothstep(0.08, 0.3, col.r - col.b);
        col = mix(col, optic, uTint * 0.5 * (1.0 - warm));
        col *= 1.0 - uTint * 0.12 * step(0.5, fract(gl_FragCoord.y * 0.5));
        float edge = smoothstep(0.32, 0.75, length(dir * vec2(1.0, 0.8)));
        col += vec3(0.0, 0.12, 0.16) * edge * uTint;
      }
      float n = rand(vUv * 1000.0 + fract(uTime)) - 0.5;
      col += n * uGrain;
      float v = smoothstep(0.85, 0.25, length(dir) * uVignette);
      col *= mix(0.5, 1.0, v);
      col *= 0.97 + 0.03 * sin(vUv.y * 900.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050a);
    this.scene.fog = new THREE.FogExp2(0x07070d, 0.06);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.02, 100);
    this.camera.position.set(2.4, 1.9, 3.6);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.film);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.zeroSize = w === 0 || h === 0;
    if (this.zeroSize) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(time) {
    if (this.zeroSize) return;
    this.film.uniforms.uTime.value = time;
    this.composer.render();
  }
}
