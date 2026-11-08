// 全部用 WebAudio 合成，不依赖音频文件；第一次点击后才能出声（浏览器限制）
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastLaser = 0;
  }

  unlock() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.ambience();
      this.onUnlock?.();
    } catch (err) {
      console.warn('[audio] unavailable', err);
    }
  }

  tone(freq, dur = 0.1, type = 'sine', gain = 0.2, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur = 0.15, gain = 0.2, filterFreq = 3000, type = 'bandpass') {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  ambience() {
    if (!this.ctx) return;
    // 雨声 + 电流嗡鸣
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const rain = this.ctx.createBufferSource();
    rain.buffer = buf;
    rain.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const rg = this.ctx.createGain();
    rg.gain.value = 0.05;
    rain.connect(lp).connect(rg).connect(this.master);
    rain.start();
    const hum = this.ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 50;
    const hg = this.ctx.createGain();
    hg.gain.value = 0.012;
    const hl = this.ctx.createBiquadFilter();
    hl.type = 'lowpass';
    hl.frequency.value = 180;
    hum.connect(hl).connect(hg).connect(this.master);
    hum.start();
  }

  click() { this.tone(1200, 0.05, 'square', 0.05); }
  hover() { this.tone(2200, 0.03, 'sine', 0.03); }
  laser() {
    const now = performance.now();
    if (now - this.lastLaser < 70) return;
    this.lastLaser = now;
    this.noise(0.08, 0.06, 5200);
    this.tone(1800 + Math.random() * 400, 0.06, 'sawtooth', 0.02);
  }
  spark() { this.noise(0.18, 0.25, 2500); this.tone(180, 0.15, 'square', 0.08, 60); }
  pop() { this.tone(220, 0.12, 'triangle', 0.25, 90); this.noise(0.1, 0.12, 900, 'lowpass'); }
  snap() { this.tone(900, 0.06, 'square', 0.12); setTimeout(() => this.tone(1400, 0.08, 'square', 0.1), 60); }
  wireOk() { this.tone(660, 0.08, 'sine', 0.12); setTimeout(() => this.tone(990, 0.1, 'sine', 0.1), 70); }
  tick(accent = false) { this.tone(accent ? 1600 : 1000, 0.04, 'square', accent ? 0.09 : 0.05); }
  stitch(good) { this.tone(good ? 1320 : 520, 0.07, 'triangle', 0.14); this.noise(0.04, 0.08, 4000); }
  coin() { this.tone(1046, 0.08, 'square', 0.08); setTimeout(() => this.tone(1568, 0.14, 'square', 0.08), 80); }
  error() { this.tone(160, 0.25, 'sawtooth', 0.12, 90); }
  // 心电监护的“嘀”：心率过高时音调更高
  heartBeep(alarm = false) { this.tone(alarm ? 1240 : 980, 0.07, 'sine', 0.03); }
  // 义眼扫描
  scanBoot() {
    this.tone(90, 0.35, 'sawtooth', 0.12, 1400);
    this.noise(0.25, 0.1, 6000);
    setTimeout(() => this.tone(2400, 0.05, 'square', 0.06), 260);
    setTimeout(() => this.tone(3200, 0.08, 'sine', 0.06), 330);
  }
  scanSweep(dur = 1.8) {
    this.tone(320, dur, 'sine', 0.05, 1500);
    this.tone(160, dur, 'triangle', 0.04, 760);
  }
  scanBlip() { this.tone(1900, 0.05, 'square', 0.05); setTimeout(() => this.tone(2600, 0.04, 'square', 0.04), 45); }
  scanType() { this.tone(3400 + Math.random() * 600, 0.012, 'square', 0.015); }
  scanAlert() { this.tone(880, 0.09, 'square', 0.07); setTimeout(() => this.tone(660, 0.12, 'square', 0.07), 110); }
  scanDone() {
    [1318, 1760, 2637].forEach((f, i) => setTimeout(() => this.tone(f, 0.1, 'sine', 0.07), i * 60));
    this.noise(0.12, 0.05, 7000);
  }
  judge(grade) {
    const notes = grade === 'perfect' ? [523, 659, 784, 1046] : grade === 'good' ? [523, 659, 784] : [392, 330];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'triangle', 0.12), i * 90));
  }
}
