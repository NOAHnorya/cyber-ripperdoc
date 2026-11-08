// 背景音乐：全部用 WebAudio 实时合成，不依赖音频文件。
// 三种模式：title（标题，带主旋律）/ clinic（接诊，暗合成器浪潮）/ surgery（手术，紧张鼓点，心跳跟心电图同步）。
// 如果 public/audio/bgm/<模式>.mp3 存在就改放文件（给以后换真曲子留的口）。
// 角色说话时自动压低，暂停时停。第一次点击解锁音频后才会响。
const TRACKS = ['title', 'clinic', 'surgery'];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.tracks = {};
    this.current = null;
    this.wanted = null;
    this.ducked = false;
    this.attached = false;
    this.paused = false;
    this.heartBpm = 72;
    this.volume = 0.5;
  }

  async init() {
    const base = import.meta.env.BASE_URL + 'audio/bgm/';
    await Promise.all(
      TRACKS.map(async (name) => {
        for (const ext of ['mp3', 'wav', 'm4a', 'ogg']) {
          const url = `${base}${name}.${ext}`;
          try {
            const res = await fetch(url, { method: 'HEAD' });
            if (res.ok && /audio|octet/.test(res.headers.get('content-type') ?? '')) {
              const el = new Audio(url);
              el.loop = true;
              el.preload = 'auto';
              this.tracks[name] = { el, gain: null };
              return;
            }
          } catch {
            /* 没有这个文件 */
          }
        }
      }),
    );
    if (this.wanted) this.play(this.wanted, { fade: 1.5 });
  }

  // ---------- 音频图 ----------
  attach() {
    if (this.attached || !this.sfx.ctx) return;
    const ctx = this.sfx.ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = this.volume;
    this.duckGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.bus.connect(this.duckGain).connect(comp).connect(this.sfx.master);
    // 延迟 + 混响发送
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2200;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 1;
    this.delaySend.connect(this.delay);
    const dOut = ctx.createGain();
    dOut.gain.value = 0.5;
    this.delay.connect(dOut).connect(this.bus);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(this.reverb);
    const rOut = ctx.createGain();
    rOut.gain.value = 0.55;
    this.reverb.connect(rOut).connect(this.bus);
    for (const t of Object.values(this.tracks)) {
      t.gain = ctx.createGain();
      t.gain.gain.value = 0;
      ctx.createMediaElementSource(t.el).connect(t.gain).connect(this.bus);
    }
    this.attached = true;
    this.tickTimer = setInterval(() => this.tick(), 90);
    if (this.wanted) this.play(this.wanted, { fade: 1.5 });
  }

  impulse(seconds, decay) {
    const ctx = this.sfx.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  // ---------- 切换 ----------
  play(name, { fade = 2.0 } = {}) {
    this.wanted = name;
    this.attach();
    if (!this.attached) return;
    if (name === this.current) return;
    const ctx = this.sfx.ctx;
    const now = ctx.currentTime;
    // 停掉当前的
    if (this.current) {
      const t = this.tracks[this.current];
      if (t) {
        t.gain.gain.cancelScheduledValues(now);
        t.gain.gain.setValueAtTime(t.gain.gain.value, now);
        t.gain.gain.linearRampToValueAtTime(0, now + fade);
        setTimeout(() => this.current !== name || t.el.pause(), fade * 1000 + 50);
      }
      if (this.gen) {
        const g = this.gen;
        g.out.gain.cancelScheduledValues(now);
        g.out.gain.setValueAtTime(g.out.gain.value, now);
        g.out.gain.linearRampToValueAtTime(0, now + fade);
        g.stopping = true;
        setTimeout(() => this.disposeGen(g), fade * 1000 + 2500);
        this.gen = null;
      }
    }
    this.current = name;
    if (!name) return;
    const t = this.tracks[name];
    if (t) {
      t.el.play().catch(() => {});
      t.gain.gain.cancelScheduledValues(now);
      t.gain.gain.setValueAtTime(t.gain.gain.value, now);
      t.gain.gain.linearRampToValueAtTime(1, now + fade);
      return;
    }
    this.gen = this.makeGen(name);
    this.gen.out.gain.setValueAtTime(0, now);
    this.gen.out.gain.linearRampToValueAtTime(1, now + fade);
  }

  stop(fade = 1.5) {
    this.play(null, { fade });
  }

  duck(on) {
    this.ducked = on;
    if (!this.attached) return;
    const g = this.duckGain.gain;
    const now = this.sfx.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(on ? 0.4 : 1, now + (on ? 0.4 : 1.2));
  }

  setPaused(on) {
    this.paused = on;
    const t = this.current && this.tracks[this.current];
    if (t) on ? t.el.pause() : t.el.play().catch(() => {});
    if (!on && this.gen) this.gen.next = this.sfx.ctx.currentTime + 0.1;
  }

  // 心电图心率 → 手术音乐里的心跳
  setHeart(bpm) {
    this.heartBpm = bpm;
  }

  // ---------- 生成器 ----------
  makeGen(mode) {
    const ctx = this.sfx.ctx;
    const out = ctx.createGain();
    out.connect(this.bus);
    const send = (dry, dl, rv) => {
      dry.connect(out);
      if (dl) {
        const g = ctx.createGain();
        g.gain.value = dl;
        dry.connect(g).connect(this.delaySend);
      }
      if (rv) {
        const g = ctx.createGain();
        g.gain.value = rv;
        dry.connect(g).connect(this.reverbSend);
      }
    };
    const gen = {
      mode,
      out,
      send,
      step: 0,
      next: ctx.currentTime + 0.1,
      nextBeat: ctx.currentTime + 0.3,
      bpm: mode === 'surgery' ? 104 : 78,
      pads: [],
      nodes: new Set(),
      stopping: false,
    };
    if (mode !== 'surgery') this.startPadChord(gen, 0, ctx.currentTime + 0.1);
    else this.startDrone(gen, ctx.currentTime + 0.1);
    return gen;
  }

  disposeGen(g) {
    for (const n of g.nodes) {
      try {
        n.stop();
      } catch {
        /* 已经停了 */
      }
    }
    g.out.disconnect();
  }

  tick() {
    const g = this.gen;
    if (!g || this.paused || g.stopping) return;
    const ctx = this.sfx.ctx;
    const horizon = ctx.currentTime + 0.3;
    const stepLen = 60 / g.bpm / 4;
    while (g.next < horizon) {
      if (g.mode === 'surgery') this.surgeryStep(g, g.step, g.next);
      else this.clinicStep(g, g.step, g.next, g.mode === 'title');
      g.step++;
      g.next += stepLen;
    }
    if (g.mode === 'surgery') {
      const beat = 60 / Math.max(40, this.heartBpm);
      while (g.nextBeat < horizon) {
        this.heartbeat(g, g.nextBeat, Math.min(1, (this.heartBpm - 60) / 60));
        g.nextBeat += beat;
      }
    }
  }

  // ---- 基础乐器 ----
  osc(g, type, freq, t0, t1, detune = 0) {
    const o = this.sfx.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.detune.value = detune;
    o.start(t0);
    o.stop(t1);
    g.nodes.add(o);
    o.onended = () => g.nodes.delete(o);
    return o;
  }

  env(t0, a, d, peak, sustain = 0, hold = 0, r = 0.1) {
    const e = this.sfx.ctx.createGain();
    e.gain.setValueAtTime(0.0001, t0);
    e.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
    e.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || peak * 0.001), t0 + a + d);
    if (hold > 0) {
      e.gain.setValueAtTime(Math.max(0.0001, sustain), t0 + a + d + hold);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + hold + r);
    }
    return e;
  }

  pluck(g, note, t, { type = 'triangle', gain = 0.09, decay = 0.35, cutoff = 1800, dl = 0.45, rv = 0.25 } = {}) {
    const ctx = this.sfx.ctx;
    const o = this.osc(g, type, midi(note), t, t + decay + 0.1);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.3), t + decay);
    const e = this.env(t, 0.005, decay, gain);
    o.connect(f).connect(e);
    g.send(e, dl, rv);
  }

  kick(g, t, gain = 0.5, lowEnd = 42) {
    const o = this.osc(g, 'sine', 140, t, t + 0.4);
    o.frequency.exponentialRampToValueAtTime(lowEnd, t + 0.12);
    const e = this.env(t, 0.003, 0.3, gain);
    o.connect(e);
    g.send(e, 0, 0);
  }

  hat(g, t, gain = 0.035, dur = 0.04, hp = 7000) {
    const ctx = this.sfx.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const e = ctx.createGain();
    e.gain.value = gain;
    s.connect(f).connect(e);
    g.send(e, 0, 0.1);
    s.start(t);
    g.nodes.add(s);
    s.onended = () => g.nodes.delete(s);
  }

  // ---- 诊所 / 标题：A 小调，Am-F-C-G，每和弦两小节 ----
  startPadChord(g, idx, t) {
    const ctx = this.sfx.ctx;
    const chords = [
      [57, 60, 64, 67],
      [53, 57, 60, 64],
      [55, 60, 64, 67],
      [55, 59, 62, 67],
    ];
    for (const p of g.pads) {
      p.e.gain.cancelScheduledValues(t);
      p.e.gain.setValueAtTime(p.e.gain.value, t);
      p.e.gain.linearRampToValueAtTime(0.0001, t + 2.2);
      for (const o of p.oscs) o.stop(t + 2.4);
    }
    g.pads = [];
    const notes = chords[idx % chords.length];
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(420, t);
    f.frequency.linearRampToValueAtTime(900, t + 4);
    f.frequency.linearRampToValueAtTime(500, t + 8);
    f.Q.value = 0.8;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(0.055, t + 2.0);
    const oscs = [];
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = this.osc(g, 'sawtooth', midi(n - 12), t, t + 60, det);
        o.connect(f);
        oscs.push(o);
      }
    }
    f.connect(e);
    g.send(e, 0, 0.6);
    g.pads.push({ e, oscs });
    g.chord = notes;
  }

  clinicStep(g, step, t, withLead) {
    const bar = step % 16;
    if (step % 32 === 0 && step > 0) this.startPadChord(g, step / 32, t);
    const chord = g.chord ?? [57, 60, 64, 67];
    const root = chord[0];
    // 低音：每两拍一下，第二小节第四拍加一个过渡音
    if (bar === 0 || bar === 8) {
      const o = this.osc(g, 'sine', midi(root - 24), t, t + 1.6);
      const e = this.env(t, 0.01, 1.4, 0.32);
      o.connect(e);
      g.send(e, 0, 0);
      const o2 = this.osc(g, 'sawtooth', midi(root - 24), t, t + 1.2);
      const f = this.sfx.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      const e2 = this.env(t, 0.01, 1.0, 0.12);
      o2.connect(f).connect(e2);
      g.send(e2, 0, 0);
    }
    if (bar === 14 && step % 32 >= 16) this.pluck(g, root - 12, t, { type: 'sine', gain: 0.2, decay: 0.5, cutoff: 400, dl: 0, rv: 0 });
    // 鼓：轻踢鼓 1、3 拍，镲 2、4 拍后半
    if (bar === 0 || bar === 8) this.kick(g, t, 0.32, 45);
    if (bar === 6 || bar === 14) this.hat(g, t, 0.03);
    if (bar === 4 || bar === 12) this.hat(g, t, 0.045, 0.09, 5000);
    // 琶音：每个 16 分音符一颗，偶尔漏一颗呼吸
    if (step % 2 === 0) {
      const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
      const i = pattern[(step / 2) % pattern.length];
      const oct = (step >> 4) % 2 ? 12 : 0;
      if (Math.random() > 0.12) this.pluck(g, chord[i] + oct, t, { gain: 0.055 + Math.random() * 0.02, decay: 0.3, cutoff: 1600 });
    }
    // 标题：每 4 小节一句五声音阶旋律
    if (withLead && step % 64 === 32) this.leadPhrase(g, t);
  }

  leadPhrase(g, t) {
    const ctx = this.sfx.ctx;
    const scale = [69, 72, 74, 76, 79, 81, 84];
    const beat = 60 / g.bpm;
    let n = 2 + Math.floor(Math.random() * 3);
    const notes = [];
    for (let i = 0; i < 5; i++) {
      n = Math.max(0, Math.min(scale.length - 1, n + [-2, -1, 1, 1, 2][Math.floor(Math.random() * 5)]));
      notes.push(scale[n]);
    }
    const durs = [1, 0.5, 0.5, 1, 2];
    let tt = t;
    const o = this.osc(g, 'triangle', midi(notes[0]), t, t + beat * 6);
    const o2 = this.osc(g, 'sine', midi(notes[0]), t, t + beat * 6, 4);
    const vib = this.osc(g, 'sine', 5.5, t, t + beat * 6);
    const vg = ctx.createGain();
    vg.gain.value = 3.5;
    vib.connect(vg);
    vg.connect(o.detune);
    vg.connect(o2.detune);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(0.075, t + 0.25);
    for (let i = 0; i < notes.length; i++) {
      if (i > 0) {
        o.frequency.exponentialRampToValueAtTime(midi(notes[i]), tt + 0.06);
        o2.frequency.exponentialRampToValueAtTime(midi(notes[i]), tt + 0.06);
      }
      tt += durs[i] * beat;
    }
    e.gain.setValueAtTime(0.075, tt - 0.3);
    e.gain.linearRampToValueAtTime(0.0001, tt + 0.6);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    o.connect(f);
    o2.connect(f);
    f.connect(e);
    g.send(e, 0.5, 0.6);
  }

  // ---- 手术：D 小调持续低音 + 滴答 + 心跳 + 不安的琶音 ----
  startDrone(g, t) {
    const ctx = this.sfx.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 3;
    f.frequency.value = 320;
    const lfo = this.osc(g, 'sine', 0.07, t, t + 3600);
    const lg = ctx.createGain();
    lg.gain.value = 260;
    lfo.connect(lg).connect(f.frequency);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(0.07, t + 3);
    for (const [n, det] of [[38, -5], [38, 5], [45, 3], [50, -3]]) this.osc(g, 'sawtooth', midi(n), t, t + 3600, det).connect(f);
    f.connect(e);
    g.send(e, 0, 0.5);
  }

  surgeryStep(g, step, t) {
    const bar = step % 16;
    // 滴答：每个 8 分音符，正拍重一点
    if (step % 2 === 0) this.hat(g, t, bar % 4 === 0 ? 0.05 : 0.025, 0.03, 8000);
    // 不安的琶音：D 小调，随机跳
    if (step % 2 === 1 && Math.random() < 0.75) {
      const scale = [62, 65, 69, 70, 72, 74, 77];
      const n = scale[Math.floor(Math.random() * scale.length)] - (Math.random() < 0.5 ? 12 : 0);
      this.pluck(g, n, t, { type: 'square', gain: 0.03, decay: 0.22, cutoff: 1100, dl: 0.5, rv: 0.2 });
    }
    // 金属敲击
    if (Math.random() < 0.05) this.pluck(g, 98 + Math.floor(Math.random() * 6), t, { type: 'sine', gain: 0.05, decay: 0.08, cutoff: 9000, dl: 0.6, rv: 0.4 });
    // 每 4 小节一次低频上行
    if (step % 64 === 48) {
      const o = this.osc(g, 'sawtooth', midi(38), t, t + 4);
      o.frequency.exponentialRampToValueAtTime(midi(50), t + 3.6);
      const f = this.sfx.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(200, t);
      f.frequency.exponentialRampToValueAtTime(1800, t + 3.6);
      const e = this.env(t, 2.5, 1.3, 0.06);
      o.connect(f).connect(e);
      g.send(e, 0, 0.5);
    }
  }

  heartbeat(g, t, tension) {
    this.kick(g, t, 0.42 + tension * 0.25, 38);
    this.kick(g, t + 0.17, 0.26 + tension * 0.15, 48);
  }
}
