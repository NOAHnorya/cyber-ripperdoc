import * as THREE from 'three';

// ---------- 病人切割材质 ----------
// 同一个病人渲染两份：身体丢掉切割体积里的像素（invert=0），肢体只保留体积里的像素（invert=1）。
// 体积在病人根节点的局部坐标里定义；uCutMatrix = 根节点世界矩阵的逆，所以肢体那份被拖走时可见部分会跟着走。

export function createCutUniforms() {
  return {
    uCutEnabled: { value: 0 },
    uCutInvert: { value: 0 },
    uBoxMin: { value: new THREE.Vector3() },
    uBoxMax: { value: new THREE.Vector3() },
    uCutMatrix: { value: new THREE.Matrix4() },
    // 带骨骼的模型：顶点存在绑骨空间里（Mixamo 导出还缩小了 100 倍），蒙皮后才是真实大小。
    // 用"模型根节点相对 bodyRoot/limbRoot 的矩阵"把绑骨空间的顶点换到标定坐标系，切割框按绑骨姿势贴在身体上
    uRestMatrix: { value: new THREE.Matrix4() },
    uGlowColor: { value: new THREE.Color(1.0, 0.42, 0.08) },
    uEdgeWidth: { value: 0.008 },
    uCutShape: { value: 0 }, // 0 = 长方体（四肢），1 = 内切椭球（眼窝）
    // 义眼扫描：扫描线高度（病人局部坐标，脚底 0）、扫过区域全息化强度
    uScanOn: { value: 0 },
    uScanY: { value: 2 },
    // 手术部位高亮
    uHiOn: { value: 0 },
    uHiMin: { value: new THREE.Vector3() },
    uHiMax: { value: new THREE.Vector3() },
    uHiShape: { value: 0 },
    uFxTime: { value: 0 },
  };
}

export function applyCutMaterial(root, uniforms) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const patched = list.map((m) => patchCut(m.clone(), uniforms));
    obj.material = Array.isArray(obj.material) ? patched : patched[0];
  });
}

function patchCut(mat, u) {
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uCutMatrix;\nuniform mat4 uRestMatrix;\nvarying vec3 vCutPos;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_SKINNING
vCutPos = (uRestMatrix * vec4(transformed, 1.0)).xyz;
#else
vCutPos = (uCutMatrix * modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uCutEnabled;
uniform float uCutInvert;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uGlowColor;
uniform float uEdgeWidth;
uniform float uCutShape;
uniform float uScanOn;
uniform float uScanY;
uniform float uHiOn;
uniform vec3 uHiMin;
uniform vec3 uHiMax;
uniform float uHiShape;
uniform float uFxTime;
varying vec3 vCutPos;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
float cutDist = 1.0;
if (uCutEnabled > 0.5) {
  if (uCutShape > 0.5) {
    vec3 cC = 0.5 * (uBoxMin + uBoxMax);
    vec3 cH = max(0.5 * (uBoxMax - uBoxMin), vec3(1e-4));
    cutDist = (length((vCutPos - cC) / cH) - 1.0) * min(min(cH.x, cH.y), cH.z);
  } else {
    vec3 dOut = max(uBoxMin - vCutPos, vCutPos - uBoxMax);
    cutDist = max(max(dOut.x, dOut.y), dOut.z);
  }
  bool insideBox = cutDist < 0.0;
  if (uCutInvert < 0.5 && insideBox) discard;
  if (uCutInvert > 0.5 && !insideBox) discard;
}`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
if (uCutEnabled > 0.5) {
  float edge = 1.0 - smoothstep(0.0, uEdgeWidth, abs(cutDist));
  if (!gl_FrontFacing) {
    // 切口内侧是暗色腔体，只有贴近切面的一圈发光（之前整个截面都是亮色，肩膀那么大的截面会糊成一团光）
    float inner = 1.0 - smoothstep(0.0, uEdgeWidth * 6.0, abs(cutDist));
    gl_FragColor.rgb = mix(vec3(0.03, 0.02, 0.025), uGlowColor * 0.9, inner * inner);
  }
  gl_FragColor.rgb += uGlowColor * edge * 3.0;
}
// ---- 手术部位高亮区域（先算出来，扫描全息和高亮都要用）----
float hiInside = 0.0;
float hiRim = 0.0;
if (uHiOn > 0.001) {
  float hd;
  if (uHiShape > 0.5) {
    vec3 hC = 0.5 * (uHiMin + uHiMax);
    vec3 hH = max(0.5 * (uHiMax - uHiMin), vec3(1e-4));
    hd = (length((vCutPos - hC) / hH) - 1.0) * min(min(hH.x, hH.y), hH.z);
  } else {
    vec3 hOut = max(uHiMin - vCutPos, vCutPos - uHiMax);
    hd = max(max(hOut.x, hOut.y), hOut.z);
  }
  hiInside = (1.0 - smoothstep(-0.003, 0.003, hd)) * uHiOn;
  hiRim = exp(-hd * hd / 0.00002) * uHiOn;
}
vec3 amber = vec3(1.0, 0.42, 0.04);
// ---- 义眼扫描：扫描线以上已扫过的部分变成全息（手术部位是琥珀色，其余青色），带等高线 ----
if (uScanOn > 0.001) {
  float scanned = smoothstep(uScanY - 0.004, uScanY + 0.004, vCutPos.y);
  float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
  float contour = smoothstep(0.86, 1.0, abs(fract(vCutPos.y * 45.0) - 0.5) * 2.0);
  float meridian = smoothstep(0.93, 1.0, abs(fract(atan(vCutPos.z, vCutPos.x) * 9.0) - 0.5) * 2.0);
  vec3 lineCol = mix(vec3(0.15, 1.5, 1.8), vec3(1.9, 0.75, 0.08), hiInside);
  vec3 holo = mix(vec3(0.01, 0.42, 0.55) + vec3(0.1, 1.1, 1.3) * lum, vec3(0.5, 0.16, 0.01) + amber * 1.2 * lum, hiInside);
  holo += lineCol * (contour * 0.55 + meridian * 0.25);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, holo, scanned * uScanOn * 0.82);
  float d = vCutPos.y - uScanY;
  float band = exp(-d * d / 0.00006);
  float trail = d > 0.0 ? exp(-d / 0.06) : 0.0;
  gl_FragColor.rgb += vec3(0.35, 2.6, 3.0) * (band * 2.2 + trail * 0.4) * uScanOn;
}
// ---- 手术部位高亮：琥珀色斜纹 + 轮廓，扫描结束后继续闪 ----
if (uHiOn > 0.001) {
  float pulse = 0.65 + 0.35 * sin(uFxTime * 5.5);
  float stripe = step(0.62, fract((vCutPos.x + vCutPos.y + vCutPos.z) * 55.0 - uFxTime * 0.9));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.45 + amber * 0.35, hiInside * 0.7);
  gl_FragColor.rgb += amber * (hiRim * 2.6 + hiInside * (0.25 + stripe * 0.5) * pulse);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'cut-v6';
  return mat;
}

// ---------- 义体霓虹发光 ----------
// Hi3D 贴图不带发光，这里把贴图里偏青色的亮像素当作发光部分
export function applyNeonGlow(root, strength = 2.5) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const patched = list.map((src) => {
      const m = src.clone();
      if (!('emissive' in m)) return m;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uGlow = { value: strength };
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uGlow;')
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
{
  vec3 c = diffuseColor.rgb;
  float cyan = smoothstep(0.35, 0.7, c.b) * smoothstep(0.3, 0.65, c.g) * (1.0 - smoothstep(0.25, 0.55, c.r));
  totalEmissiveRadiance += c * cyan * uGlow;
}`,
          );
      };
      m.customProgramCacheKey = () => 'neon-glow-v1';
      return m;
    });
    obj.material = Array.isArray(obj.material) ? patched : patched[0];
  });
}

// ---------- 全息材质（对位虚影、扫描） ----------
const holograms = new Set();

export function hologramMaterial(color = 0x05d9e8, opacity = 0.55) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vN = mat3(modelMatrix) * normal;
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vWorld;
      void main() {
        // 法线为零时 normalize 会得到 NaN，经辉光扩散会让整屏变黑，这里兜底
        vec3 n = dot(vN, vN) > 1e-8 ? normalize(vN) : vec3(0.0, 0.0, 1.0);
        float f = pow(clamp(1.0 - abs(dot(n, vView)), 0.0, 1.0), 2.0);
        float scan = 0.6 + 0.4 * step(0.5, fract(vWorld.y * 120.0 - uTime * 2.0));
        float flicker = 0.9 + 0.1 * sin(uTime * 37.0);
        gl_FragColor = vec4(uColor * (0.4 + f * 2.5) * scan * flicker, uOpacity * (0.25 + f));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  holograms.add(mat);
  return mat;
}

export function disposeHologram(mat) {
  holograms.delete(mat);
  mat.dispose();
}

export function tickHolograms(time) {
  holograms.forEach((m) => (m.uniforms.uTime.value = time));
}

export function toHologram(root, color, opacity) {
  const mat = hologramMaterial(color, opacity);
  root.traverse((obj) => {
    if (obj.isMesh) obj.material = mat;
  });
  return mat;
}

// HDR 发光色（大于 1 才会被辉光吃到）
export function neonColor(hex, intensity = 2.5) {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

export function neonMaterial(hex, intensity = 2.5) {
  return new THREE.MeshBasicMaterial({ color: neonColor(hex, intensity), toneMapped: false });
}
