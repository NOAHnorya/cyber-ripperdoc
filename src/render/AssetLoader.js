import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map();

export function assetUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return (import.meta.env?.BASE_URL ?? '/') + path.replace(/^\//, '');
}

// 有些 Hi3D 网格（义体主体、部分道具）导出时没带法线。没有法线时光照和全息着色器
// 会算出 NaN，辉光后期再把 NaN 扩散到整屏，画面直接全黑。加载时补算一次。
function ensureNormals(root) {
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry && !obj.geometry.attributes.normal) {
      obj.geometry.computeVertexNormals();
    }
  });
  return root;
}

// 加载 GLB；文件还没生成（或加载失败）时返回 null，调用方用占位模型顶上。
// 带骨骼的模型要用 SkeletonUtils 克隆，否则克隆体的蒙皮还绑在原来那副骨架上。
function loadCached(path, quiet) {
  if (!cache.has(path)) {
    cache.set(
      path,
      loader
        .loadAsync(assetUrl(path))
        .then((gltf) => ({ scene: ensureNormals(gltf.scene), animations: gltf.animations ?? [] }))
        .catch((err) => {
          if (!quiet) console.info(`[assets] 还没有 ${path}，先用占位模型（${err?.message ?? err}）`);
          return null;
        }),
    );
  }
  return cache.get(path);
}

export async function loadGltf(path, { quiet = false } = {}) {
  if (!path) return null;
  const g = await loadCached(path, quiet);
  return g ? { scene: cloneSkinned(g.scene), animations: g.animations } : null;
}

export async function loadModel(path) {
  return (await loadGltf(path))?.scene ?? null;
}

export { cloneSkinned };

// 把模型缩放到指定高度、脚底贴 y=0、水平居中（防止资产没按规格归一化）
export function normalizeHeight(object, height) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (size.y <= 0) return object;
  const s = height / size.y;
  if (Math.abs(s - 1) > 0.05) object.scale.multiplyScalar(s);
  box.setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  return object;
}

export function fitToSize(object, targetSize) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  const target = Math.max(...targetSize);
  if (longest > 0 && target > 0) object.scale.multiplyScalar(target / longest);
  return object;
}

export function placeOnFloor(object) {
  const box = new THREE.Box3().setFromObject(object);
  object.position.y -= box.min.y;
  return object;
}
