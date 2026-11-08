import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { loadModel, normalizeHeight } from '../render/AssetLoader.js';
import { makePlaceholderPatient, makePlaceholderImplant } from '../render/placeholders.js';
import { createCutUniforms, applyCutMaterial, applyNeonGlow } from '../render/materials.js';
import patients from '../data/patients.json';
import implants from '../data/implants.json';
import slots from '../data/slots.json';
import defaultCalibration from '../data/calibration/default_patient.json';

const files = import.meta.glob('../data/calibration/*.json', { eager: true, import: 'default' });
const saved = {};
for (const [path, json] of Object.entries(files)) saved[path.split('/').pop().replace('.json', '')] = json;

const $ = (id) => document.getElementById(id);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- 场景 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('view').append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101018);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 50);
camera.position.set(1.4, 1.5, 2.4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(2, 4, 3);
scene.add(sun);
scene.add(new THREE.GridHelper(4, 40, 0x334, 0x223));
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 1.1, 0);
orbit.update();
const tc = new TransformControls(camera, renderer.domElement);
tc.addEventListener('dragging-changed', (e) => (orbit.enabled = !e.value));
tc.addEventListener('objectChange', () => syncFromObjects());
scene.add(tc.getHelper());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 状态 ----------
const state = { patientId: patients[0]?.id, slot: 'arm', target: 'box', calib: null, implantId: null, implantOffsets: {} };
const root = new THREE.Group();
scene.add(root);
let bodyRoot = null;
let uniforms = null;
const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff9a2e, wireframe: true }));
const socket = new THREE.Object3D();
socket.add(new THREE.AxesHelper(0.12));
let implantWrapper = null;
let implantModel = null;

function fill(select, options) {
  select.replaceChildren(...options.map(([v, t]) => Object.assign(document.createElement('option'), { value: v, textContent: t })));
}
fill($('patient'), patients.map((p) => [p.id, `${p.name}（${p.id}）`]));
fill($('slot'), Object.entries(slots).map(([k, s]) => [k, s.label]));
$('slot').value = state.slot;

function status(text, bad = false) {
  $('status').textContent = text;
  $('status').style.color = bad ? '#ff2a6d' : '#39ff14';
}

function patientCalib(id) {
  const own = saved[`patient_${id}`];
  const base = clone(defaultCalibration);
  if (!own) return base;
  return { ...base, ...clone(own), slots: { ...base.slots, ...clone(own.slots) } };
}

async function loadPatient(id) {
  root.clear();
  const p = patients.find((x) => x.id === id);
  let model = await loadModel(p?.model);
  if (model) normalizeHeight(model, p.height_m || 1.75);
  else {
    model = makePlaceholderPatient(id);
    status('还没有这个病人的 GLB，先用占位模型');
  }
  bodyRoot = new THREE.Group();
  bodyRoot.add(model);
  uniforms = createCutUniforms();
  applyCutMaterial(bodyRoot, uniforms);
  root.add(bodyRoot);
  bodyRoot.add(boxMesh, socket);
  state.calib = patientCalib(id);
  applySlot();
}

function applySlot() {
  const s = state.calib.slots[state.slot];
  const min = new THREE.Vector3(...s.cut.min);
  const max = new THREE.Vector3(...s.cut.max);
  boxMesh.position.copy(min).add(max).multiplyScalar(0.5);
  boxMesh.scale.copy(max).sub(min);
  boxMesh.rotation.set(0, 0, 0);
  socket.position.set(...s.socket.pos);
  socket.rotation.set(...s.socket.rot);
  fill($('implant'), [['', '（不预览）'], ...implants.filter((i) => i.slot === state.slot).map((i) => [i.id, i.name])]);
  $('implant').value = '';
  setImplant(null);
  attachTarget();
  updateUniforms();
  showJson();
  const w = socket.getWorldPosition(new THREE.Vector3());
  orbit.target.copy(w);
  orbit.update();
}

function syncFromObjects() {
  const s = state.calib.slots[state.slot];
  boxMesh.rotation.set(0, 0, 0);
  const half = boxMesh.scale.clone().multiplyScalar(0.5);
  s.cut.min = boxMesh.position.clone().sub(half).toArray().map((v) => +v.toFixed(4));
  s.cut.max = boxMesh.position.clone().add(half).toArray().map((v) => +v.toFixed(4));
  s.socket.pos = socket.position.toArray().map((v) => +v.toFixed(4));
  s.socket.rot = [socket.rotation.x, socket.rotation.y, socket.rotation.z].map((v) => +v.toFixed(4));
  if (implantModel && state.implantId) {
    state.implantOffsets[state.implantId] = {
      pos: implantModel.position.toArray().map((v) => +v.toFixed(4)),
      rot: [implantModel.rotation.x, implantModel.rotation.y, implantModel.rotation.z].map((v) => +v.toFixed(4)),
      scale: +implantModel.scale.x.toFixed(4),
    };
  }
  updateUniforms();
  showJson();
}

function updateUniforms() {
  if (!uniforms) return;
  const s = state.calib.slots[state.slot];
  uniforms.uBoxMin.value.set(...s.cut.min);
  uniforms.uBoxMax.value.set(...s.cut.max);
}

function showJson() {
  const out = { slots: state.calib.slots };
  $('json').textContent = JSON.stringify(out, null, 1).slice(0, 3000);
}

function attachTarget() {
  tc.detach();
  if (state.target === 'box') {
    tc.attach(boxMesh);
    if (tc.getMode() === 'rotate') setMode('translate');
  } else if (state.target === 'socket') {
    tc.attach(socket);
    if (tc.getMode() === 'scale') setMode('translate');
  } else if (implantModel) {
    tc.attach(implantModel);
  }
}

async function setImplant(id) {
  if (implantWrapper) implantWrapper.removeFromParent();
  implantWrapper = null;
  implantModel = null;
  state.implantId = id || null;
  if (!id) return;
  const imp = implants.find((i) => i.id === id);
  let model = await loadModel(imp.model);
  if (model) applyNeonGlow(model);
  else model = makePlaceholderImplant(imp);
  const off = state.implantOffsets[id] ?? saved[`implant_${id}`];
  if (off) {
    if (off.pos) model.position.set(...off.pos);
    if (off.rot) model.rotation.set(...off.rot);
    if (off.scale) model.scale.setScalar(off.scale);
  }
  implantWrapper = new THREE.Group();
  implantWrapper.scale.setScalar(state.calib.slots[state.slot].socket.scale ?? 1);
  implantWrapper.add(model);
  socket.add(implantWrapper);
  implantModel = model;
  attachTarget();
}

function setMode(mode) {
  tc.setMode(mode);
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
}

async function post(kind, id, data) {
  try {
    const res = await fetch('/__calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, data }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    status(`已保存 ${json.file}`);
  } catch (err) {
    status(`保存失败（只有 npm run dev 下能直接保存，可以用"下载 JSON"）：${err.message}`, true);
  }
}

// ---------- 事件 ----------
$('patient').addEventListener('change', (e) => {
  state.patientId = e.target.value;
  loadPatient(state.patientId);
});
$('slot').addEventListener('change', (e) => {
  state.slot = e.target.value;
  applySlot();
});
$('implant').addEventListener('change', (e) => setImplant(e.target.value));
document.querySelectorAll('[data-target]').forEach((b) =>
  b.addEventListener('click', () => {
    state.target = b.dataset.target;
    document.querySelectorAll('[data-target]').forEach((x) => x.classList.toggle('on', x === b));
    attachTarget();
  }),
);
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
addEventListener('keydown', (e) => {
  if (e.key === 'w') setMode('translate');
  if (e.key === 'e') setMode('rotate');
  if (e.key === 'r') setMode('scale');
});
$('previewCut').addEventListener('click', (e) => {
  const on = !e.target.classList.contains('on');
  e.target.classList.toggle('on', on);
  uniforms.uCutEnabled.value = on ? 1 : 0;
});
$('resetSlot').addEventListener('click', () => {
  state.calib.slots[state.slot] = clone(defaultCalibration.slots[state.slot]);
  applySlot();
});
$('savePatient').addEventListener('click', () => post('patient', state.patientId, { patient: state.patientId, slots: state.calib.slots }));
$('saveImplant').addEventListener('click', () => {
  if (!state.implantId || !state.implantOffsets[state.implantId]) return status('先选一个义体并调整它的位置', true);
  post('implant', state.implantId, state.implantOffsets[state.implantId]);
});
$('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ patient: state.patientId, slots: state.calib.slots }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `patient_${state.patientId}.json` });
  a.click();
});

renderer.setAnimationLoop(() => {
  root.updateMatrixWorld(true);
  if (bodyRoot && uniforms) uniforms.uCutMatrix.value.copy(bodyRoot.matrixWorld).invert();
  renderer.render(scene, camera);
});

loadPatient(state.patientId);
