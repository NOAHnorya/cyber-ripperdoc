import { IncisionStep } from './IncisionStep.js';
import { RemovalStep } from './RemovalStep.js';
import { AlignStep } from './AlignStep.js';
import { WiringStep } from './WiringStep.js';
import { SutureStep } from './SutureStep.js';
import { surgeryQuality, gradeOf, GRADE_LABEL } from '../systems/scoring.js';
import { isOverloaded } from '../systems/economy.js';
import { wireCount } from '../systems/wiring.js';

const ALL_STEPS = [IncisionStep, RemovalStep, AlignStep, WiringStep, SutureStep];
const ABORT = Symbol('abort');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 一台手术：按顺序跑五个步骤，管麻醉条、心率、扣时间和评分
export class SurgerySession {
  constructor(game, { customer, implant, slotKey, onlySteps = null }) {
    this.game = game;
    const { data, store } = game;
    const fx = game.fx();
    const slotDef = data.slots[slotKey];
    const overloaded = isOverloaded(customer, implant);
    this.steps = onlySteps ? ALL_STEPS.filter((S) => onlySteps.includes(S.key)) : ALL_STEPS;
    this.ctx = {
      game,
      customer,
      implant,
      slotKey,
      slotDef,
      cutMode: slotDef.cutMode,
      calibSlot: game.rig.slot(slotKey),
      fx,
      balance: data.balance,
      overloaded,
      wires: wireCount(implant, overloaded, data.balance),
      tolFactor: data.balance.difficultyTolerance[String(implant.difficulty)] ?? 1,
      penalize: (reason) => this.penalize(reason),
    };
    this.anesthesiaMax = fx.anesthesiaSeconds ?? 90;
    this.anesthesia = this.anesthesiaMax;
    this.heart = 72;
    this.running = false;
    this.aborted = false;
    this.step = null;
    this.night = store.state.night;
  }

  async run() {
    const { game, ctx } = this;
    const { ui, rig, director, debug } = game;
    const scores = {};

    if (!this.steps.some((S) => S.key === 'incision')) {
      // 回访返修：义体已经装好
    } else {
      rig.prepareCut(ctx.slotKey);
      if (ctx.cutMode === 'overlay') rig.spawnCover(ctx.slotKey);
      const implantObj = await rig.loadImplant(ctx.implant, game.implantCalibration(ctx.implant.id));
      ctx.holder = rig.attachImplant(ctx.slotKey, implantObj);
      ctx.holder.visible = false;
    }

    ui.showVitals(true);
    await rig.waitWalk();
    // 病人自己走到床边、坐上床沿、躺下（镜头拉回全景看着他上床）
    this.pose = game.clinic.patientPose(rig.patient?.id);
    if (this.pose) {
      game.scan?.clearHighlight();
      game.sfx.scanBlip?.();
      // 镜头先从货架拉回全景，病人再动身（不然病人会从镜头前擦过）
      director.overview(0.8);
      await wait(debug.auto ? 150 : 500);
      game.music?.play('surgery', { fade: 3 });
      await rig.layDown(this.pose);
      director.supine = true;
    }
    await director.focusSlot(ctx.slotKey, rig.socketWorld(ctx.slotKey), 1.0);

    this.running = true;
    this.abortPromise = new Promise((resolve) => (this.abortNow = () => resolve(ABORT)));

    for (let i = 0; i < this.steps.length; i++) {
      const S = this.steps[i];
      ui.step(i, this.steps.length, S.title, S.hint);
      const step = new S(ctx);
      let result;
      if (debug.auto) {
        this.step = null;
        await wait(350);
        result = step.auto();
      } else {
        const started = step.start();
        this.step = step;
        result = await Promise.race([started, this.abortPromise]);
      }
      step.dispose();
      this.step = null;
      if (result === ABORT) break;
      scores[S.key] = result.score;
      const grade = gradeOf(result.score, ctx.balance.qualityThresholds);
      ui.judge(GRADE_LABEL[grade], result.score, grade);
      await wait(debug.auto ? 200 : 650);
    }

    this.running = false;
    ui.hideStep();
    ui.showVitals(false);
    if (ctx.burn) {
      ctx.burn.removeFromParent();
      ctx.burn = null;
    }
    // 切口愈合：发光从橙色变成暗青色
    rig.bodyU?.uGlowColor.value.setRGB(0.05, 0.35, 0.4);

    const result = surgeryQuality(scores, ctx.balance.qualityThresholds, this.aborted);
    if (this.aborted) {
      ui.judge('病人醒了', 0, 'fail');
      game.sfx.error();
      await wait(900);
    } else {
      ui.judge(`手术${GRADE_LABEL[result.quality]}`, result.average, result.quality);
      await wait(1000);
    }
    // 义体改成跟骨头走的蒙皮，然后病人坐起来、下床、走回床尾
    if (!this.aborted) rig.skinImplant(ctx.slotKey);
    game.music?.play('clinic', { fade: 2.5 });
    if (this.pose) {
      director.supine = false;
      director.overview(1.4);
      await rig.standUp();
    }
    return { ...result, scores, failed: this.aborted };
  }

  penalize(reason) {
    if (!this.running) return;
    this.anesthesia -= this.ctx.balance.mistakePenaltySeconds;
    this.heart = Math.min(160, this.heart + 14);
    this.game.sfx.spark();
    this.game.ui.toast(`${reason} −${this.ctx.balance.mistakePenaltySeconds}s`, 'bad');
  }

  update(dt) {
    if (!this.running) return;
    if (!this.game.debug.auto) this.anesthesia -= dt;
    this.heart += (72 + (1 - this.anesthesia / this.anesthesiaMax) * 20 - this.heart) * Math.min(1, dt * 0.8);
    this.game.ui.setAnesthesia(this.anesthesia / this.anesthesiaMax, this.anesthesia);
    this.game.ui.setHeart(this.heart);
    if (this.anesthesia <= 0 && !this.aborted) {
      this.aborted = true;
      this.step?.dispose?.();
      this.abortNow?.();
      return;
    }
    this.step?.update?.(dt);
  }

  draw(overlay) {
    if (this.running) this.step?.draw?.(overlay);
  }

  pointer(kind, p, e) {
    const s = this.step;
    if (!s || !this.running) return;
    if (kind === 'down') s.onPointerDown?.(p, e);
    else if (kind === 'move') s.onPointerMove?.(p, e);
    else s.onPointerUp?.(p, e);
  }

  key(e) {
    if (this.running) this.step?.onKey?.(e);
  }
}
