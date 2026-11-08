import * as THREE from 'three';

// 义眼扫描过场：接诊时医生用自己的义眼把病人从头到脚扫一遍。
// 3D 部分：扫过的身体变成青色全息（着色器在 materials.js）、一圈扫描环跟着往下走、最后高亮手术部位。
// 2D 部分：HUD 边框、锁定框、数据标注（引线 + 打字效果）、进度条、完成印章。时间线按游戏 dt 推进，暂停时一起停。

const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;

// 时间线（秒）
const T = {
  lock: 0.3,
  lockDur: 0.5,
  sweep: 0.8,
  sweepDur: 1.9,
  done: 2.85,
  exit: 4.1,
  end: 4.45,
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function fakeId(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const hex = (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `NC-${hex.slice(0, 4)}-${hex.slice(4)}`;
}

function buildRing() {
  const group = new THREE.Group();
  group.name = 'scan-ring';
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p) * 2.0;
          float a = atan(p.y, p.x);
          float rim = smoothstep(0.9, 0.985, r) * (1.0 - smoothstep(0.985, 1.0, r));
          float ticks = step(0.82, fract(a * 9.549 + uTime * 0.6)) * smoothstep(0.84, 0.9, r) * (1.0 - smoothstep(0.9, 0.93, r));
          float rings = smoothstep(0.96, 1.0, abs(fract(r * 6.0 - uTime * 1.5) - 0.5) * 2.0) * (1.0 - r);
          float fill = 0.05 * (1.0 - r);
          float alpha = (rim * 1.0 + ticks * 0.8 + rings * 0.35 + fill) * uOpacity * step(r, 1.0);
          gl_FragColor = vec4(vec3(0.25, 1.9, 2.3) * alpha, alpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);
  group.visible = false;
  return { group, mat: disc.material };
}

export class ScanFx {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.hiOn = 0;
    this.hiTarget = 0;
    const ring = buildRing();
    this.ring = ring.group;
    this.ringMat = ring.mat;
    game.renderer.scene.add(this.ring);
    this.buildLayer();
    window.addEventListener('keydown', (e) => {
      if (!this.active || this.game.paused) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        this.skip();
      }
    });
  }

  buildLayer() {
    const L = el('div', 'optic hidden');
    this.layer = L;
    L.addEventListener('pointerdown', () => !this.game.paused && this.skip());
    this.flash = el('div', 'optic-flash');
    const corners = ['tl', 'tr', 'bl', 'br'].map((c) => el('div', `optic-corner ${c}`));
    this.idBox = el('div', 'optic-id');
    this.idBox.append(el('div', 'optic-id-main', 'OPTIC-7 // 义眼扫描'), el('div', 'optic-id-sub', 'BIOSCAN v3.2 · 医生模式'));
    this.progress = el('div', 'optic-progress');
    this.progressLabel = el('div', 'optic-progress-label', 'SCANNING');
    const bar = el('div', 'optic-bar');
    this.progressFill = el('div', 'optic-bar-fill');
    bar.append(this.progressFill);
    this.progressPct = el('div', 'optic-progress-pct', '0%');
    this.progress.append(this.progressLabel, bar, this.progressPct);
    this.hex = el('div', 'optic-hex');
    this.skipHint = el('div', 'optic-skip', '点击 / 空格 跳过');
    this.lines = svg('svg', { class: 'optic-lines' });
    this.lock = el('div', 'optic-lock');
    ['tl', 'tr', 'bl', 'br'].forEach((c) => this.lock.append(el('div', `lk ${c}`)));
    this.lockLabel = el('div', 'optic-lock-label', '目标锁定 · SUBJECT');
    this.lock.append(this.lockLabel);
    this.cardsBox = el('div', 'optic-cards');
    this.stamp = el('div', 'optic-stamp');
    this.stamp.append(el('div', 'optic-stamp-main', '扫描完成'), el('div', 'optic-stamp-sub', 'SCAN COMPLETE · 0 THREATS'));
    L.append(this.flash, ...corners, this.lines, this.lock, this.cardsBox, this.idBox, this.progress, this.hex, this.skipHint, this.stamp);
    document.getElementById('ui').append(L);
  }

  // 开始扫描；结束后 Promise resolve。手术部位的高亮会一直留着，直到 clearHighlight()
  run({ customer, slotKey, budget }) {
    const { game } = this;
    const rig = game.rig;
    if (!rig.bodyRoot) return Promise.resolve();
    this.active = true;
    this.t = 0;
    this.speed = game.debug.auto ? 3 : 1;
    this.slotKey = slotKey;
    this.stampShown = false;
    this.doneSound = false;
    this.hexTimer = 0;

    // 病人的世界包围盒（锁定框和扫描环用）
    rig.root.updateMatrixWorld(true);
    this.box = new THREE.Box3().setFromObject(rig.bodyRoot);
    this.height = Math.max(0.5, this.box.max.y - this.box.min.y);
    this.setupHighlight(slotKey);
    this.buildCards(customer, slotKey, budget);

    this.layer.classList.remove('hidden', 'out');
    this.layer.classList.remove('boot');
    void this.layer.offsetWidth;
    this.layer.classList.add('boot');
    this.stamp.classList.remove('show');
    this.ring.visible = true;
    game.sfx.scanBoot();
    game.director.scanShot(0.55).then(() => this.active && game.director.scanDolly(3.4));
    return new Promise((resolve) => (this.resolve = resolve));
  }

  setupHighlight(slotKey) {
    const u = this.game.rig.bodyU;
    const cut = this.game.rig.slot(slotKey).cut;
    const slotDef = this.game.data.slots[slotKey];
    const round = slotDef.cutMode === 'overlay';
    const k = round ? 0.9 : 1;
    const mid = cut.min.map((v, i) => (v + cut.max[i]) / 2);
    u.uHiMin.value.set(...cut.min.map((v, i) => mid[i] + (v - mid[i]) * k));
    u.uHiMax.value.set(...cut.max.map((v, i) => mid[i] + (v - mid[i]) * k));
    u.uHiShape.value = round ? 1 : 0;
    this.hiTarget = 0;
  }

  // 手术部位在病人局部坐标里的标注点
  targetAnchor(slotKey) {
    const rig = this.game.rig;
    const slotDef = this.game.data.slots[slotKey];
    if (slotDef.cutMode === 'volume') return rig.limbCenter(slotKey);
    return new THREE.Vector3(...rig.slot(slotKey).socket.pos);
  }

  buildCards(customer, slotKey, budget) {
    const h = this.height;
    const slotDef = this.game.data.slots[slotKey];
    const cap = customer.capacity ?? 0;
    const defs = [
      { key: 'id', anchor: new THREE.Vector3(0, h * 0.93, 0.06), code: 'ID-SCAN', title: customer.name, lines: [customer.job ?? '', `公民编号 ${fakeId(customer.id)}`] },
      { key: 'neuro', anchor: new THREE.Vector3(0, h * 0.82, -0.02), code: 'NEURO-LINK', title: `神经容量 ${cap}`, blocks: cap },
      { key: 'vitals', anchor: new THREE.Vector3(0.04, h * 0.71, 0.1), code: 'VITALS', title: '心率 72 BPM', lines: ['血氧 97% · 体温 36.7℃'], ecg: true },
      { key: 'credit', anchor: new THREE.Vector3(-0.1, h * 0.55, 0.1), code: 'CREDIT', title: `可用余额 ¢${Number(budget ?? 0).toLocaleString()}`, lines: ['信用评级 C+ · 现金支付'] },
      { key: 'target', anchor: this.targetAnchor(slotKey), code: '⚠ 手术部位', title: `${slotDef.label} · 需要更换`, lines: [`${slotDef.removal?.label ?? '旧部件'} · 已标记`], alert: true },
    ];
    this.cardsBox.replaceChildren();
    this.lines.replaceChildren();
    this.cards = defs.map((d) => {
      const card = el('div', `optic-card${d.alert ? ' alert' : ''}`);
      const code = el('div', 'code', d.code);
      const title = el('div', 'title');
      card.append(code, title);
      const lineEls = (d.lines ?? []).map((t) => {
        const n = el('div', 'line');
        card.append(n);
        return { el: n, text: t };
      });
      if (d.blocks) {
        const b = el('div', 'blocks');
        for (let i = 0; i < 6; i++) b.append(el('span', i < d.blocks ? 'on' : ''));
        card.append(b);
      }
      if (d.ecg) {
        const s = svg('svg', { class: 'ecg', viewBox: '0 0 120 22', width: 120, height: 22 });
        s.append(svg('path', { d: 'M0 12 H34 L40 12 L44 3 L49 20 L53 8 L56 12 H76 L80 10 L84 12 H120' }));
        card.append(s);
      }
      card.style.visibility = 'hidden';
      this.cardsBox.append(card);
      const line = svg('polyline', { class: d.alert ? 'ln alert' : 'ln' });
      const dot = svg('circle', { r: 3.2, class: d.alert ? 'dot alert' : 'dot' });
      const halo = svg('circle', { r: 9, class: d.alert ? 'halo alert' : 'halo' });
      this.lines.append(line, halo, dot);
      for (const n of [line, dot, halo]) n.style.visibility = 'hidden';
      return { ...d, card, title, titleText: d.title, lineEls, line, dot, halo, shown: false, typed: 0 };
    });
  }

  skip() {
    if (!this.active) return;
    if (this.t < T.done) this.t = T.done;
    else if (this.t < T.exit) this.t = T.exit;
  }

  clearHighlight() {
    this.hiTarget = 0;
  }

  update(dt) {
    const rig = this.game.rig;
    const u = rig.bodyU;
    this.ringMat.uniforms.uTime.value += dt;
    // 手术部位高亮：扫描结束后继续闪，直到开始手术
    if (u !== this.boundU) {
      // 换了病人：高亮状态不能带到下一位身上
      this.boundU = u;
      this.hiOn = 0;
      this.hiTarget = 0;
    }
    if (u && rig.bodyRoot) {
      u.uFxTime.value += dt;
      this.hiOn += (this.hiTarget - this.hiOn) * Math.min(1, dt * 4);
      if (Math.abs(this.hiOn - this.hiTarget) < 0.002) this.hiOn = this.hiTarget;
      u.uHiOn.value = this.hiOn;
    }
    if (!this.active) return;
    if (!u || !rig.bodyRoot) {
      this.finish();
      return;
    }
    const sfx = this.game.sfx;
    const film = this.game.renderer.film.uniforms;
    const o = this.game.overlay;
    this.t += dt * this.speed;
    const t = this.t;

    // ---- 后期：青色义眼色调 + 开机/完成/退出时的故障闪 ----
    const tintOut = clamp01((t - T.exit) / (T.end - T.exit));
    film.uTint.value = clamp01(t / 0.35) * (1 - tintOut);
    const glitch =
      Math.max(0, 1 - t / 0.45) + Math.max(0, 0.45 - Math.abs(t - T.done) * 3) + Math.max(0, 0.55 - Math.abs(t - T.exit) * 4);
    film.uGlitch.value = clamp01(glitch);

    // ---- 扫描线从头扫到脚 ----
    const sp = clamp01((t - T.sweep) / T.sweepDur);
    const top = this.height + 0.06;
    const bottom = -0.04;
    const scanY = top + (bottom - top) * easeInOut(sp);
    u.uScanY.value = scanY;
    u.uScanOn.value = clamp01((t - (T.sweep - 0.15)) / 0.15) * (1 - clamp01((t - T.done) / 0.9));
    if (sp > 0 && !this.sweepSound) {
      this.sweepSound = true;
      sfx.scanSweep(T.sweepDur / this.speed);
    }
    if (sp === 0) this.sweepSound = false;

    // 扫描环
    const c = this.box.getCenter(new THREE.Vector3());
    const size = this.box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.5 * 1.12;
    this.ring.position.set(c.x, this.box.min.y + scanY, c.z);
    this.ring.scale.set(r, 1, Math.max(size.z * 0.5 * 1.6, r * 0.55));
    this.ringMat.uniforms.uOpacity.value = clamp01((t - (T.sweep - 0.1)) / 0.15) * (1 - clamp01((sp - 0.9) / 0.1));

    // ---- 锁定框：从全屏收拢到病人 ----
    const vw = o.width;
    const vh = o.height;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = o.project(new THREE.Vector3(i & 1 ? this.box.max.x : this.box.min.x, i & 2 ? this.box.max.y : this.box.min.y, i & 4 ? this.box.max.z : this.box.min.z));
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const lk = easeOut(clamp01((t - T.lock) / T.lockDur));
    const pad = 14;
    const L0 = [vw * 0.06, vh * 0.08, vw * 0.94, vh * 0.92];
    const L1 = [minX - pad, minY - pad, maxX + pad, maxY + pad];
    const lb = L0.map((v, i) => v + (L1[i] - v) * lk);
    Object.assign(this.lock.style, {
      left: `${lb[0]}px`, top: `${lb[1]}px`, width: `${lb[2] - lb[0]}px`, height: `${lb[3] - lb[1]}px`,
      opacity: t < T.lock ? 0 : 1,
    });
    this.lock.classList.toggle('locked', lk >= 1);
    // 完成印章盖在病人身上，不和右边的数据卡打架
    this.stamp.style.left = `${(lb[0] + lb[2]) / 2}px`;
    this.stamp.style.top = `${lb[1] + (lb[3] - lb[1]) * 0.42}px`;

    // ---- 进度条 ----
    this.progressFill.style.width = `${Math.round(sp * 100)}%`;
    this.progressPct.textContent = `${Math.round(sp * 100)}%`;
    this.progressLabel.textContent = t < T.sweep ? 'CALIBRATING' : sp < 1 ? 'SCANNING' : 'COMPLETE';
    this.hexTimer -= dt;
    if (this.hexTimer <= 0) {
      this.hexTimer = 0.07;
      const hx = () => Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
      this.hex.textContent = [0, 1, 2].map(() => `${hx()} ${hx()} ${hx()} ${hx()}  ${(Math.random() * 99).toFixed(2)}`).join('\n');
    }

    this.updateCards(dt, t, scanY, vw, vh, maxX);

    // ---- 完成、退出 ----
    if (t >= T.done && !this.stampShown) {
      this.stampShown = true;
      this.stamp.classList.add('show');
      sfx.scanDone();
    }
    if (t >= T.exit && !this.exiting) {
      this.exiting = true;
      this.layer.classList.add('out');
      this.game.director.overview(0.9);
    }
    if (t >= T.end) this.finish();
  }

  updateCards(dt, t, scanY, vw, vh, patientRight) {
    const o = this.game.overlay;
    const sfx = this.game.sfx;
    const bodyRoot = this.game.rig.bodyRoot;
    const W = Math.min(250, vw * 0.36);
    const colX = Math.min(vw - W - 20, Math.max(patientRight + 60, vw * 0.56));
    const layout = this.cards.map((cd) => {
      const a = o.project(bodyRoot.localToWorld(cd.anchor.clone()));
      return { cd, a, h: cd.card.offsetHeight || 60 };
    });
    layout.sort((p, q) => p.a.y - q.a.y);
    let y = 112;
    for (const it of layout) {
      it.y = Math.max(y, it.a.y - 18);
      y = it.y + it.h + 10;
    }
    const overflow = y - (vh - 24);
    if (overflow > 0) for (const it of layout) it.y = Math.max(96, it.y - overflow);

    for (const { cd, a, y: cy } of layout) {
      // 扫描线经过标注点时出现
      if (!cd.shown && (scanY <= cd.anchor.y || t >= T.done)) {
        cd.shown = true;
        cd.age = 0;
        cd.card.style.visibility = 'visible';
        cd.card.classList.add('reveal');
        for (const n of [cd.line, cd.dot, cd.halo]) n.style.visibility = 'visible';
        if (cd.alert) {
          sfx.scanAlert();
          this.hiTarget = 1;
        } else sfx.scanBlip();
      }
      cd.card.style.width = `${W}px`;
      cd.card.style.transform = `translate(${colX}px, ${cy}px)`;
      const ly = cy + 15;
      const pts = [[a.x, a.y], [colX - 36, ly], [colX - 2, ly]];
      cd.line.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
      for (const n of [cd.dot, cd.halo]) {
        n.setAttribute('cx', a.x);
        n.setAttribute('cy', a.y);
      }
      if (!cd.shown) continue;
      cd.age += dt * this.speed;
      const len = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) + 34;
      const k = easeOut(clamp01(cd.age / 0.28));
      cd.line.style.strokeDasharray = `${len}`;
      cd.line.style.strokeDashoffset = `${len * (1 - k)}`;
      // 打字效果
      const before = Math.floor(cd.typed);
      cd.typed = t >= T.exit - 0.5 ? 999 : cd.typed + dt * this.speed * 70;
      let n = Math.floor(cd.typed);
      if (Math.floor(cd.typed / 3) !== Math.floor(before / 3) && n < 60) sfx.scanType();
      cd.title.textContent = cd.titleText.slice(0, n);
      n -= cd.titleText.length;
      for (const ln of cd.lineEls) {
        ln.el.textContent = n > 0 ? ln.text.slice(0, n) : '';
        n -= ln.text.length;
      }
    }
  }

  finish() {
    this.active = false;
    this.exiting = false;
    this.sweepSound = false;
    this.layer.classList.add('hidden');
    this.layer.classList.remove('boot', 'out');
    this.ring.visible = false;
    const film = this.game.renderer.film.uniforms;
    film.uTint.value = 0;
    film.uGlitch.value = 0;
    if (this.game.rig.bodyU) this.game.rig.bodyU.uScanOn.value = 0;
    const done = this.resolve;
    this.resolve = null;
    done?.();
  }
}
