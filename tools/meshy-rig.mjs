// Meshy 批量绑骨 + 动作：读 .env 里的 MESHY_API_KEY，上传 raw/rig/input_<id>.glb，
// 下载绑好骨的模型 raw/rig/rigged_<id>.glb 和合并了多个动作的 raw/rig/anim_<id>.glb。
// 用法：node tools/meshy-rig.mjs [patientId ...]     已完成的步骤会跳过（任务记录在 raw/rig/tasks.json）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'raw/rig');
const env = Object.fromEntries(
  (fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const KEY = env.MESHY_API_KEY || process.env.MESHY_API_KEY;
if (!KEY) {
  console.error('缺少 MESHY_API_KEY：请在项目根目录的 .env 里写 MESHY_API_KEY=...');
  process.exit(1);
}
const API = 'https://api.meshy.ai/openapi/v1';
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// 每位病人最多 10 个动作，合并成一个文件
const ACTIONS = {
  common: [0, 336, 30, 313, 56, 403, 415, 311, 391, 47],
  lili: [0, 336, 1, 313, 56, 403, 415, 311, 391, 47],
};
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['aqiang', 'jinya', 'xiaolin', 'lili', 'daoba'];
const tasksFile = path.join(dir, 'tasks.json');
const tasks = fs.existsSync(tasksFile) ? JSON.parse(fs.readFileSync(tasksFile, 'utf8')) : {};
const save = () => fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function poll(kind, id, label) {
  let last = -1;
  for (;;) {
    const t = await api('GET', `/${kind}/${id}`);
    if (t.progress !== last) {
      console.log(`[${label}] ${kind} ${t.status} ${t.progress ?? 0}%`);
      last = t.progress;
    }
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`[${label}] ${kind} ${t.status}: ${JSON.stringify(t.task_error)}`);
    await sleep(4000);
  }
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${url.slice(0, 80)}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`  -> ${path.relative(root, file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
}

async function run(id) {
  tasks[id] ??= {};
  const rec = tasks[id];
  const riggedFile = path.join(dir, `rigged_${id}.glb`);
  if (!rec.rig || !fs.existsSync(riggedFile)) {
    const glb = fs.readFileSync(path.join(dir, `input_${id}.glb`));
    const created = await api('POST', '/rigging', {
      model_url: `data:application/octet-stream;base64,${glb.toString('base64')}`,
      height_meters: 1.75,
    });
    rec.rig = created.result;
    save();
    console.log(`[${id}] rigging task ${rec.rig}`);
    const t = await poll('rigging', rec.rig, id);
    await download(t.result.rigged_character_glb_url, riggedFile);
    if (t.result.basic_animations?.walking_glb_url) await download(t.result.basic_animations.walking_glb_url, path.join(dir, `walk_${id}.glb`));
  }
  const animFile = path.join(dir, `anim_${id}.glb`);
  if (!rec.anim || !fs.existsSync(animFile)) {
    const created = await api('POST', '/animations', { rig_task_id: rec.rig, action_ids: ACTIONS[id] ?? ACTIONS.common });
    rec.anim = created.result;
    save();
    console.log(`[${id}] animation task ${rec.anim}`);
    const t = await poll('animations', rec.anim, id);
    await download(t.result.animation_glb_url, animFile);
  }
  console.log(`[${id}] 完成`);
}

const results = await Promise.allSettled(ids.map(run));
results.forEach((r, i) => r.status === 'rejected' && console.error(`[${ids[i]}] 失败：${r.reason?.message ?? r.reason}`));
