// 用 MOSS 给每个角色配音
// 1) 按人设描述设计音色（voice/generations + create_voice），拿到 voice_id，存 raw/voice/voices.json
// 2) 用 voice_id 合成每句台词（audio/speech），存 public/audio/voice/<角色>_<台词>.mp3
// 3) 写清单 src/data/voice_lines.json：{ "名字|台词": "audio/voice/xxx.mp3" }，对话框按名字+台词自动播放
// API key 从项目根目录 .env 的 MOSS_API_KEY 读（.env 不进 git）
// 用法：node tools/voices.mjs [--redesign 角色id] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const KEY = process.env.MOSS_API_KEY;
if (!KEY) throw new Error('.env 里没有 MOSS_API_KEY');
const API = 'https://api.mosi.cn/v1';
const args = process.argv.slice(2);
const force = args.includes('--force');
const redesign = new Set(args.filter((a, i) => args[i - 1] === '--redesign'));

const CAST = {
  laozhou: {
    name: '老周',
    instruction: '五十多岁的中国男性，开地下义体诊所的老师傅，烟嗓，沙哑低沉，语速慢悠悠，老江湖口吻，带点漫不经心的调侃，像在带徒弟。普通话。',
    sample: '客人进门，先用你那只义眼扫一遍。手脚麻利点，别把不对口的货卖出去。',
  },
  aqiang: {
    name: '阿强',
    instruction: '三十岁左右的中国北方男性，外卖骑手，嗓音粗犷沙哑、厚实有力，风吹日晒的糙劲儿，大嗓门，语速快，火急火燎，说话直来直去带点匪气。男中低音，绝对不要清秀斯文。普通话带北方口音。',
    sample: '今晚又超时三单，平台要扣钱了。给我换双快点的腿，我还得赶下一单呢。',
  },
  jinya: {
    name: '金牙',
    instruction: '六十岁左右的中国北方老大爷，夜市摆摊几十年的二手贩子，嗓音粗糙沙哑、低沉厚重，浓重的老烟嗓，声音发粗发哑，说话粗声粗气、慢悠悠的，老江湖的市井味，透着精明。男低音，绝对不要尖细。普通话带一点北方口音。',
    sample: '这条街上一半的货是假的，我得一眼看出来。嘿，好东西，好东西啊。',
  },
  xiaolin: {
    name: '小林',
    instruction: '二十六七岁的中国男性程序员，斯文内向，声音清瘦偏轻，熬夜加班没睡醒，语气疲惫又无奈，说话有点小声。普通话。',
    sample: '手腕疼得敲不了代码，可这周不能请假。下周的需求还排着队呢。',
  },
  lili: {
    name: '莉莉',
    instruction: '二十岁出头的中国女性全息主播，声音甜美明亮，娇俏活泼，带直播间的腔调和一点撒娇，语调起伏大，很有感染力。普通话。',
    sample: '宝宝们听到了吗？粉丝说我声音太普通，我要一把让人记住的嗓子！',
  },
  // 莉莉装上变声面甲之后的声音：空灵、带电子感（只用于术后满意那句）
  lili_fx: {
    name: '莉莉',
    instruction: '二十岁出头的年轻女性，声音空灵飘渺、清澈透亮，像经过电子合成器处理过的人声，带轻微金属质感和混响，气声多，缓慢而有磁性，神秘又迷人，像赛博朋克电影里的全息歌姬。普通话。',
    sample: '宝宝们听到了吗？这个声音，绝了。',
    fx: true,
  },
  daoba: {
    name: '刀疤',
    instruction: '四十岁左右的中国男性，帮派打手，嗓音低沉粗哑，带烟嗓，语速偏慢，冷酷克制，话少，压着嗓子说话，有威胁感。普通话。',
    sample: '要一把藏在胳膊里的刀。钱不是问题。今晚的事，你什么都没看见。',
  },
};

const TUTORIAL = '客人进门，先用你那只义眼扫一遍，看清要换哪儿、兜里有多少钱。躺上手术台以后按顺序做五步：切开、拆除、对位、接线、缝合。麻醉条见底病人就会醒，手脚麻利点。别把不对口的货卖出去。';
const customers = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/customers.json'), 'utf8'));
const lines = [{ speaker: 'laozhou', key: 'tutorial', text: TUTORIAL }];
for (const c of customers) {
  if (!CAST[c.id]) continue;
  // 个别台词换嗓子：莉莉装完变声面甲，满意那句用电子空灵声
  const override = { lili: { happy: 'lili_fx' } }[c.id] ?? {};
  for (const [key, text] of Object.entries(c.lines)) lines.push({ speaker: override[key] ?? c.id, key, text });
  lines.push({ speaker: c.id, key: 'refuse', text: '……那我去别家看看。' });
}
// 突发事件（老周转述）：开场白 + 每个选项的结果
const incidents = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/incidents.json'), 'utf8'));
for (const inc of incidents) {
  lines.push({ speaker: 'laozhou', key: `inc_${inc.id}`, text: inc.text });
  inc.choices.forEach((ch, i) => {
    if (ch.result) lines.push({ speaker: 'laozhou', key: `inc_${inc.id}_c${i}`, text: ch.result });
    if (ch.gamble) {
      lines.push({ speaker: 'laozhou', key: `inc_${inc.id}_c${i}_win`, text: ch.gamble.win.result });
      lines.push({ speaker: 'laozhou', key: `inc_${inc.id}_c${i}_lose`, text: ch.gamble.lose.result });
    }
  });
}

async function post(endpoint, body, binary) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
    const msg = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`${endpoint} ${msg}`);
    console.warn(`  重试 ${endpoint}：${msg}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

const voiceFile = path.join(ROOT, 'raw/voice/voices.json');
fs.mkdirSync(path.dirname(voiceFile), { recursive: true });
const voices = fs.existsSync(voiceFile) ? JSON.parse(fs.readFileSync(voiceFile, 'utf8')) : {};
const outDir = path.join(ROOT, 'public/audio/voice');
fs.mkdirSync(outDir, { recursive: true });

// 1) 设计音色（各角色并行）
await Promise.all(
  Object.entries(CAST).map(async ([id, cast]) => {
    if (voices[id] && !redesign.has(id)) return;
    const r = await post('/audio/voice/generations', {
      model: 'moss-voice-generator-1.0',
      input: cast.sample,
      instruction: cast.instruction,
      response_format: 'mp3',
      delivery_method: 'url',
      create_voice: true,
    });
    voices[id] = r.voice_id;
    const sample = Buffer.from(await (await fetch(r.url)).arrayBuffer());
    fs.writeFileSync(path.join(ROOT, `raw/voice/sample_${id}.mp3`), sample);
    console.log('音色', cast.name, r.voice_id);
    if (redesign.has(id)) for (const f of fs.readdirSync(outDir)) if (f.startsWith(`${id}_`)) fs.unlinkSync(path.join(outDir, f));
  }),
);
fs.writeFileSync(voiceFile, JSON.stringify(voices, null, 2));

// 2) 合成台词（并发 4）
const manifest = {};
let i = 0;
async function worker() {
  while (i < lines.length) {
    const ln = lines[i++];
    const file = `${ln.speaker}_${ln.key}.mp3`;
    const out = path.join(outDir, file);
    manifest[`${CAST[ln.speaker].name}|${ln.text}`] = `audio/voice/${file}`;
    if (fs.existsSync(out) && !force) continue;
    const audio = await post('/audio/speech', {
      model: 'moss-tts-1.5-flash',
      input: ln.text.replace(/^……/, '唉，'), // 句首省略号会念出一长段怪声
      voice_id: voices[ln.speaker],
      language: 'Chinese',
      response_format: 'mp3',
    }, true);
    fs.writeFileSync(out, audio);
    // 电子人声后期：合唱 + 短混响 + 一点点高频闪，像从变声器里出来
    if (CAST[ln.speaker].fx) {
      const tmp = out + '.raw.mp3';
      fs.renameSync(out, tmp);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af',
        'chorus=0.7:0.9:40|55|70:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3,aecho=0.8:0.7:45|90:0.35|0.2,highpass=f=120,treble=g=4:f=6000,alimiter=limit=0.95',
        out]);
      fs.unlinkSync(tmp);
    }
    console.log('台词', CAST[ln.speaker].name, ln.key, (audio.length / 1024).toFixed(0) + 'KB');
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
const ordered = Object.fromEntries(Object.entries(manifest).sort());
fs.writeFileSync(path.join(ROOT, 'src/data/voice_lines.json'), JSON.stringify(ordered, null, 2) + '\n');
console.log('完成', Object.keys(manifest).length, '句');
