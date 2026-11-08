// 所有 HTML 界面：顶栏、对话框、货架、账本、判定、提示。返回 Promise 的方法会等玩家点按钮。
import voiceLines from '../data/voice_lines.json';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

const GRADE_CLASS = { perfect: 'g-perfect', good: 'g-good', poor: 'g-poor', fail: 'g-fail' };

// 一次心跳的波形（相位 0~1）：P 波、QRS 波群、T 波
function ecgWave(p) {
  const bump = (c, w, a) => a * Math.exp(-(((p - c) / w) ** 2));
  return bump(0.12, 0.03, 0.12) + bump(0.245, 0.008, -0.14) + bump(0.27, 0.011, 1) + bump(0.295, 0.01, -0.28) + bump(0.5, 0.05, 0.24);
}

export class UI {
  constructor(root, sfx, { auto = false } = {}) {
    this.root = root;
    this.sfx = sfx;
    this.auto = auto;

    this.hud = el('div', 'hud hidden');
    this.hudNight = el('div', 'hud-item');
    this.hudMoney = el('div', 'hud-item money');
    this.hudRep = el('div', 'hud-item rep');
    this.hudPhase = el('div', 'hud-item phase');
    this.pauseBtn = el('button', 'hud-pause', 'Ⅱ 暂停');
    this.pauseBtn.title = '暂停（Esc）';
    this.pauseBtn.addEventListener('click', () => this.onPauseToggle?.());
    this.hud.append(this.hudNight, this.hudMoney, this.hudRep, this.hudPhase, this.pauseBtn);

    this.pauseScreen = el('div', 'pause-screen hidden');
    const pauseBox = el('div', 'pause-box');
    const resume = el('button', 'btn primary big', '▶ 继续');
    resume.addEventListener('click', () => this.onPauseToggle?.());
    pauseBox.append(
      el('div', 'pause-title', '已暂停'),
      el('div', 'pause-sub', '麻醉计时和缝合节拍都停住了，病人不会醒'),
      resume,
      el('div', 'pause-hint', '按 Esc 或 P 继续'),
    );
    this.pauseScreen.append(pauseBox);

    this.vitals = el('div', 'vitals hidden');
    this.anesLabel = el('div', 'vitals-label', '麻醉');
    this.anesBar = el('div', 'bar');
    this.anesFill = el('div', 'bar-fill');
    this.anesBar.append(this.anesFill);
    this.anesText = el('div', 'vitals-num');
    this.heart = el('div', 'heart', '♥ 72');
    // 心电监护：扫描式波形，心率由手术失误推高
    this.ecgWrap = el('div', 'ecg-wrap');
    this.ecg = el('canvas', 'ecg');
    this.ecg.width = 560;
    this.ecg.height = 120;
    this.ecgWrap.append(this.ecg, el('span', 'ecg-tag', 'ECG · II'));
    this.ecgState = { x: 0, phase: 0.6, y: null, bpm: 72, beeped: true };
    this.vitals.append(this.anesLabel, this.anesBar, this.anesText, this.heart, this.ecgWrap);
    this.startEcg();

    this.stepBox = el('div', 'step hidden');
    this.stepTitle = el('div', 'step-title');
    this.stepHint = el('div', 'step-hint');
    this.stepDots = el('div', 'step-dots');
    this.stepBox.append(this.stepDots, this.stepTitle, this.stepHint);

    this.dialogBox = el('div', 'dialog hidden');
    this.modal = el('div', 'modal hidden');
    this.judgeBox = el('div', 'judge hidden');
    this.toastBox = el('div', 'toasts');
    this.bannerBox = el('div', 'banner hidden');

    root.append(this.hud, this.vitals, this.stepBox, this.dialogBox, this.modal, this.judgeBox, this.toastBox, this.bannerBox, this.pauseScreen);
  }

  showPause(on) {
    this.pauseScreen.classList.toggle('hidden', !on);
    this.pauseBtn.textContent = on ? '▶ 继续' : 'Ⅱ 暂停';
  }

  // ---------- 顶栏 ----------
  setHUD({ night, money, reputation }) {
    this.hud.classList.remove('hidden');
    this.hudNight.textContent = `第 ${night} 晚`;
    this.hudMoney.textContent = `¢ ${money.toLocaleString()}`;
    const stars = Math.round(reputation * 2) / 2;
    this.hudRep.textContent = `口碑 ${'★'.repeat(Math.floor(stars))}${stars % 1 ? '☆' : ''} ${stars.toFixed(1)}`;
  }

  setPhase(text) {
    this.hudPhase.textContent = text ?? '';
  }

  // ---------- 手术生命体征 ----------
  showVitals(on) {
    this.vitals.classList.toggle('hidden', !on);
  }

  setAnesthesia(fraction, seconds) {
    this.anesFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    this.anesFill.classList.toggle('low', fraction < 0.25);
    this.anesText.textContent = `${Math.max(0, Math.ceil(seconds))}s`;
  }

  setHeart(bpm) {
    this.heart.textContent = `♥ ${Math.round(bpm)}`;
    this.heart.classList.toggle('alarm', bpm > 110);
    this.ecgState.bpm = bpm;
    this.music?.setHeart(bpm);
  }

  // 心电图：写入头从左往右扫，前面擦出一道空隙（监护仪那种），每次 R 波闪一下、嘀一声
  startEcg() {
    let last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (this.vitals.classList.contains('hidden') || !this.pauseScreen.classList.contains('hidden')) return;
      this.drawEcg(dt);
    };
    requestAnimationFrame(loop);
  }

  drawEcg(dt) {
    const c = this.ecg;
    const g = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const s = this.ecgState;
    const alarm = s.bpm > 110;
    const color = alarm ? '#ff2a6d' : '#39ff14';
    const speed = W / 3.2; // 3.2 秒扫一屏
    const n = Math.max(1, Math.ceil((speed * dt) / 3));
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 10;
    for (let i = 0; i < n; i++) {
      const step = dt / n;
      s.phase += (step * s.bpm) / 60;
      if (s.phase >= 1) {
        s.phase -= 1;
        s.beeped = false;
      }
      const y = H * 0.6 - ecgWave(s.phase) * H * 0.48 + (Math.random() - 0.5) * 2;
      let nx = s.x + speed * step;
      if (nx >= W) {
        nx -= W;
        s.x = 0;
        s.y = y;
      }
      g.clearRect(nx, 0, 26, H);
      if (s.y !== null) {
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(nx, y);
        g.stroke();
      }
      s.x = nx;
      s.y = y;
      if (!s.beeped && s.phase > 0.27) {
        s.beeped = true;
        this.sfx?.heartBeep?.(alarm);
        this.heart.classList.remove('beat');
        void this.heart.offsetWidth;
        this.heart.classList.add('beat');
      }
    }
  }

  // ---------- 步骤提示 ----------
  step(index, total, title, hint) {
    this.stepBox.classList.remove('hidden');
    this.stepDots.replaceChildren(
      ...Array.from({ length: total }, (_, i) => el('span', i < index ? 'dot done' : i === index ? 'dot now' : 'dot')),
    );
    this.stepTitle.textContent = title;
    this.stepHint.textContent = hint;
  }

  stepHintUpdate(hint) {
    this.stepHint.textContent = hint;
  }

  hideStep() {
    this.stepBox.classList.add('hidden');
  }

  // ---------- 对话 ----------
  // 角色配音（tools/voices.mjs 用 MOSS 生成）：按“名字|台词”找音频，新台词会打断上一句
  speak(name, text) {
    this.hush();
    const src = voiceLines[`${name}|${text}`];
    if (!src) return;
    const audio = new Audio(import.meta.env.BASE_URL + src);
    audio.volume = 0.95;
    audio.play().catch(() => {});
    audio.addEventListener('ended', () => this.voice === audio && this.music?.duck(false));
    this.music?.duck(true);
    this.voice = audio;
  }

  hush() {
    const audio = this.voice;
    this.voice = null;
    this.music?.duck(false);
    if (!audio || audio.paused) return;
    // 点掉对话框时快速淡出，不要硬切
    const t0 = performance.now();
    const v0 = audio.volume;
    const step = () => {
      const k = 1 - (performance.now() - t0) / 180;
      if (k <= 0) return audio.pause();
      audio.volume = v0 * k;
      setTimeout(step, 16);
    };
    step();
  }

  dialog({ name, job, text, meta = [], buttons = [{ label: '继续', value: true, primary: true }] }) {
    const box = this.dialogBox;
    box.replaceChildren();
    box.classList.remove('hidden');
    const head = el('div', 'dialog-head');
    head.append(el('span', 'dialog-name', name ?? ''), el('span', 'dialog-job', job ?? ''));
    const body = el('div', 'dialog-text', '');
    const metaRow = el('div', 'dialog-meta');
    meta.forEach((m) => metaRow.append(el('span', `chip ${m.kind ?? ''}`, m.text ?? m)));
    const actions = el('div', 'dialog-actions');
    box.append(head, body, metaRow, actions);

    this.speak(name, text);
    let i = 0;
    const chars = [...(text ?? '')];
    const timer = setInterval(() => {
      i += 2;
      body.textContent = chars.slice(0, i).join('');
      if (i >= chars.length) clearInterval(timer);
    }, 24);

    return new Promise((resolve) => {
      if (this.auto) {
        const pick = buttons.find((b) => b.primary) ?? buttons[0];
        setTimeout(() => {
          clearInterval(timer);
          this.hush();
          box.classList.add('hidden');
          resolve(pick.value);
        }, 500);
      }
      buttons.forEach((b) => {
        const btn = el('button', `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`, b.label);
        btn.addEventListener('click', () => {
          clearInterval(timer);
          this.hush();
          this.sfx?.click();
          box.classList.add('hidden');
          resolve(b.value);
        });
        actions.append(btn);
      });
    });
  }

  hideDialog() {
    this.dialogBox.classList.add('hidden');
  }

  // ---------- 货架 ----------
  shelf({ title, subtitle, items, allowCancel = true }) {
    const m = this.openModal('shelf');
    m.append(el('div', 'modal-title', title), el('div', 'modal-sub', subtitle));
    const grid = el('div', 'cards');
    m.append(grid);
    return new Promise((resolve) => {
      if (this.auto) {
        const pick = items.find((it) => it.status.selectable);
        setTimeout(() => {
          this.closeModal();
          resolve(pick ? pick.implant.id : null);
        }, 600);
      }
      items.forEach(({ implant, status, brandName, thumbUrl, wires }) => {
        const card = el('button', `card brand-${implant.brand} ${status.selectable ? '' : 'disabled'}`);
        const art = el('div', 'card-art');
        if (thumbUrl) {
          const img = new Image();
          img.src = thumbUrl;
          img.alt = '';
          img.onerror = () => img.remove();
          art.append(img);
        }
        art.append(el('div', 'card-slot', implant.slotLabel));
        card.append(
          art,
          el('div', 'card-name', implant.name),
          el('div', 'card-desc', implant.desc),
          el(
            'div',
            'card-stats',
            `负荷 ${implant.load} · 接线 ${wires} · ${'★'.repeat(implant.difficulty)}`,
          ),
          el('div', 'card-brand', brandName),
          el('div', 'card-price', `¢ ${implant.price.toLocaleString()}`),
        );
        if (!status.selectable) card.append(el('div', 'card-flag bad', status.reason));
        else if (status.warning) card.append(el('div', 'card-flag warn', status.warning));
        if (implant.wiringHidden) card.append(el('div', 'card-flag ghost', '无接线图'));
        card.disabled = !status.selectable;
        card.addEventListener('mouseenter', () => this.sfx?.hover());
        card.addEventListener('click', () => {
          if (!status.selectable) return;
          this.sfx?.click();
          this.closeModal();
          resolve(implant.id);
        });
        grid.append(card);
      });
      if (allowCancel) {
        const cancel = el('button', 'btn ghost-btn', '没有合适的，请客人回去');
        cancel.addEventListener('click', () => {
          this.sfx?.click();
          this.closeModal();
          resolve(null);
        });
        m.append(cancel);
      }
    });
  }

  // ---------- 打烊：账本 + 升级 ----------
  ledger({ night, ledger, getMoney, upgrades, onBuy }) {
    const m = this.openModal('ledger');
    const render = () => {
      m.replaceChildren();
      m.append(el('div', 'modal-title', `第 ${night} 晚 · 打烊结账`));
      const table = el('div', 'ledger');
      const row = (k, v, cls = '') => {
        const r = el('div', `ledger-row ${cls}`);
        r.append(el('span', '', k), el('span', '', v));
        table.append(r);
      };
      row('收入（含小费）', `+ ${ledger.income.toLocaleString()}`);
      row('义体进价 · 其他支出', `− ${ledger.costs.toLocaleString()}`);
      row('房租', `− ${ledger.rent.toLocaleString()}`);
      row('今晚净收入', `${ledger.net >= 0 ? '+' : '−'} ${Math.abs(ledger.net).toLocaleString()}`, ledger.net >= 0 ? 'pos' : 'neg');
      row('现在余额', `¢ ${getMoney().toLocaleString()}`, 'total');
      m.append(table);
      m.append(el('div', 'modal-sub', '升级诊所：每项升级都会让某一步手术更容易，诊所里也会换上新设备'));
      const list = el('div', 'upgrades');
      upgrades().forEach(({ up, level, status }) => {
        const card = el('div', `upgrade ${level > 0 ? 'owned' : ''}`);
        card.append(
          el('div', 'upgrade-name', `${up.name}${up.mvp ? '' : ' · 加分项'}`),
          el('div', 'upgrade-desc', `${up.affects}｜${up.desc}`),
        );
        const btn = el('button', `btn ${status.ok ? 'primary' : ''}`, level > 0 ? '已安装' : `¢ ${up.price.toLocaleString()}`);
        btn.disabled = !status.ok;
        if (!status.ok && level === 0) btn.title = status.reason;
        btn.addEventListener('click', () => {
          if (onBuy(up.key)) {
            this.sfx?.coin();
            render();
          }
        });
        card.append(btn);
        list.append(card);
      });
      m.append(list);
      const next = el('button', 'btn primary big', '开始下一晚');
      m.append(next);
      next.addEventListener('click', () => {
        this.sfx?.click();
        this.closeModal();
        this.resolveLedger?.();
      });
    };
    render();
    return new Promise((resolve) => {
      this.resolveLedger = resolve;
      if (this.auto) {
        setTimeout(() => {
          this.closeModal();
          resolve();
        }, 800);
      }
    });
  }

  // ---------- 标题 / 结局 ----------
  title({ hasSave }) {
    const m = this.openModal('title');
    m.append(
      el('div', 'title-main', '赛博义体诊所'),
      el('div', 'title-en', 'CYBER RIPPERDOC'),
      el('div', 'title-sub', '下城区，高架桥下，通宵面摊的后屋。今晚你是这里的义体医生。'),
    );
    const row = el('div', 'title-actions');
    m.append(row);
    return new Promise((resolve) => {
      const add = (label, value, primary) => {
        const b = el('button', `btn big ${primary ? 'primary' : ''}`, label);
        b.addEventListener('click', () => {
          this.sfx?.unlock();
          this.sfx?.click();
          this.closeModal();
          resolve(value);
        });
        row.append(b);
      };
      if (hasSave) add('继续营业', 'continue', true);
      add('新的营业', 'new', !hasSave);
      m.append(el('div', 'title-tip', '操作：鼠标拖动完成切开、拆除、对位、接线；缝合时跟着节拍点击或按空格。'));
    });
  }

  ending({ money, reputation, surgeries, perfects }) {
    const m = this.openModal('title');
    m.append(
      el('div', 'title-main small', '三晚营业结束'),
      el('div', 'title-sub', `余额 ¢ ${money.toLocaleString()} · 口碑 ${reputation.toFixed(1)} 星 · 手术 ${surgeries} 台 · 完美 ${perfects} 台`),
    );
    const b = el('button', 'btn big primary', '再开一次张');
    m.append(b);
    return new Promise((resolve) => {
      b.addEventListener('click', () => {
        this.closeModal();
        resolve();
      });
    });
  }

  // ---------- 弹出 ----------
  judge(label, score, grade) {
    const box = this.judgeBox;
    box.className = `judge ${GRADE_CLASS[grade] ?? ''}`;
    box.replaceChildren(el('div', 'judge-label', label), el('div', 'judge-score', `${score}`));
    this.sfx?.judge(grade);
    clearTimeout(this.judgeTimer);
    this.judgeTimer = setTimeout(() => box.classList.add('hidden'), 1100);
  }

  toast(text, kind = '') {
    const t = el('div', `toast ${kind}`, text);
    this.toastBox.append(t);
    setTimeout(() => t.classList.add('out'), 1800);
    setTimeout(() => t.remove(), 2300);
  }

  banner(text, sub = '', ms = 1700) {
    const b = this.bannerBox;
    b.replaceChildren(el('div', 'banner-main', text), el('div', 'banner-sub', sub));
    b.classList.remove('hidden');
    return new Promise((resolve) =>
      setTimeout(() => {
        b.classList.add('hidden');
        resolve();
      }, ms),
    );
  }

  // 接线等步骤用的浮动面板
  mountPanel(cls) {
    const p = el('div', `panel ${cls}`);
    this.root.append(p);
    return p;
  }

  openModal(kind) {
    this.modal.className = `modal ${kind}`;
    this.modal.replaceChildren();
    return this.modal;
  }

  closeModal() {
    this.modal.className = 'modal hidden';
    this.modal.replaceChildren();
  }
}
