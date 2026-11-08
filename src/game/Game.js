import { Renderer } from '../render/Renderer.js';
import { Overlay } from '../render/Overlay.js';
import { Clinic } from '../render/Clinic.js';
import { PatientRig } from '../render/PatientRig.js';
import { CameraDirector } from '../render/CameraDirector.js';
import { Particles } from '../render/Particles.js';
import { ScanFx } from '../render/ScanFx.js';
import { tickHolograms } from '../render/materials.js';
import { UI } from '../ui/ui.js';
import { Sfx } from '../core/audio.js';
import { Music } from '../core/music.js';
import { Store } from '../core/store.js';
import { upgradeFx } from '../systems/upgrades.js';
import { runGame } from './flow.js';

import implantsData from '../data/implants.json';
import patientsData from '../data/patients.json';
import propsData from '../data/props.json';
import customersData from '../data/customers.json';
import nightsData from '../data/nights.json';
import incidentsData from '../data/incidents.json';
import upgradesData from '../data/upgrades.json';
import balanceData from '../data/balance.json';
import slotsData from '../data/slots.json';
import defaultCalibration from '../data/calibration/default_patient.json';

// 标定文件：patient_<id>.json / implant_<id>.json，用 calibrate.html 生成
const calibrationFiles = import.meta.glob('../data/calibration/*.json', { eager: true, import: 'default' });
const calibrations = {};
for (const [path, json] of Object.entries(calibrationFiles)) {
  calibrations[path.split('/').pop().replace('.json', '')] = json;
}

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

function readDebug() {
  const q = new URLSearchParams(location.search);
  return {
    auto: q.has('auto'),
    night: q.get('night') ? Number(q.get('night')) : null,
    money: q.get('money') ? Number(q.get('money')) : null,
  };
}

export class Game {
  constructor(app) {
    this.app = app;
    this.debug = readDebug();
    this.data = {
      implants: byId(implantsData),
      implantList: implantsData,
      patients: byId(patientsData),
      props: propsData,
      customers: byId(customersData),
      nights: nightsData,
      incidents: incidentsData,
      upgrades: upgradesData,
      balance: balanceData,
      slots: slotsData,
    };
    this.session = null;
    this.paused = false;
  }

  async init() {
    this.renderer = new Renderer(document.getElementById('scene'));
    this.overlay = new Overlay(document.getElementById('overlay'), this.renderer.camera);
    this.sfx = new Sfx();
    this.music = new Music(this.sfx);
    this.sfx.onUnlock = () => this.music.attach();
    this.music.init();
    this.ui = new UI(document.getElementById('ui'), this.sfx, { auto: this.debug.auto });
    this.ui.music = this.music;
    this.ui.onPauseToggle = () => this.setPaused(!this.paused);
    this.store = new Store(this.data.balance);
    this.clinic = new Clinic(this.renderer.scene);
    this.rig = new PatientRig(this.renderer.scene);
    this.director = new CameraDirector(this.renderer.camera);
    this.particles = new Particles(this.renderer.scene);
    this.scan = new ScanFx(this);
    await this.clinic.loadProps(this.data.props, this.data.upgrades, this.store.state.upgrades);
    this.bindInput();
    this.last = performance.now() / 1000;
    requestAnimationFrame((t) => this.loop(t));
    window.__game = this;
  }

  fx() {
    return upgradeFx(this.data.upgrades, this.store.state.upgrades);
  }

  patientCalibration(id) {
    const own = calibrations[`patient_${id}`];
    if (!own) return defaultCalibration;
    return { ...defaultCalibration, ...own, slots: { ...defaultCalibration.slots, ...own.slots } };
  }

  implantCalibration(id) {
    return calibrations[`implant_${id}`] ?? null;
  }

  refreshHud() {
    const s = this.store.state;
    this.ui.setHUD({ night: Math.min(s.night, this.data.nights.length), money: s.money, reputation: s.reputation });
  }

  // 暂停：麻醉倒计时、缝合节拍、病人和镜头动画都停住，输入也不再传给手术步骤
  setPaused(on) {
    if (on === this.paused) return;
    if (on && this.ui.hud.classList.contains('hidden')) return; // 标题页不用暂停
    this.paused = on;
    this.music.setPaused(on);
    if (on) {
      this.pausedAt = performance.now();
      this.session?.step?.onPause?.();
    } else {
      const seconds = (performance.now() - this.pausedAt) / 1000;
      this.session?.step?.onResume?.(seconds);
    }
    this.ui.showPause(on);
  }

  bindInput() {
    const canvas = document.getElementById('overlay');
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      if (this.paused) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 合成事件没有活动指针 */ }
      this.session?.pointer('down', local(e), e);
    });
    canvas.addEventListener('pointermove', (e) => !this.paused && this.session?.pointer('move', local(e), e));
    const up = (e) => !this.paused && this.session?.pointer('up', local(e), e);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        this.setPaused(!this.paused);
        return;
      }
      if (!this.paused) this.session?.key(e);
    });
  }

  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const now = t / 1000;
    const dt = this.paused ? 0 : Math.min(0.05, Math.max(0, now - this.last));
    this.last = now;
    try {
      this.clinic.update(dt);
      this.rig.update(dt);
      this.director.update(dt);
      this.renderer.camera.updateMatrixWorld();
      this.scan.update(dt);
      this.particles.update(dt);
      tickHolograms(now);
      if (!this.paused) this.session?.update(dt);
      this.overlay.clear();
      this.session?.draw(this.overlay);
      this.renderer.render(now);
    } catch (err) {
      // 一帧出错不能让整个游戏停住；同样的错误只报一次
      const key = String(err?.message);
      if (this.lastError !== key) {
        this.lastError = key;
        console.error('[loop]', err);
      }
    }
  }

  start() {
    return runGame(this);
  }
}
