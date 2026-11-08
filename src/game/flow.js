import { SurgerySession } from '../surgery/SurgerySession.js';
import { effectiveBudget, shelfStatus, settleSurgery, isOverloaded, rejectionRisk, nightLedger } from '../systems/economy.js';
import { nightPlan, parseEntry, revisitOutcome } from '../systems/nights.js';
import { canBuy } from '../systems/upgrades.js';
import { wireCount } from '../systems/wiring.js';
import { GRADE_LABEL } from '../systems/scoring.js';
import { assetUrl } from '../render/AssetLoader.js';

const money = (n) => `¢${Math.round(n).toLocaleString()}`;

// 游戏流程：标题 → 三晚营业（每晚：接诊 → 选件 → 手术 → 结算，打烊升级）→ 结局
export async function runGame(game) {
  const { ui, store, data, debug } = game;
  for (;;) {
    game.music.play('title');
    const choice = debug.auto ? 'new' : await ui.title({ hasSave: store.hasSave() });
    if (choice === 'continue') store.load();
    else store.reset();
    if (debug.night) store.state.night = debug.night;
    if (debug.money) store.state.money = debug.money;
    game.clinic.applyUpgrades(store.state.upgrades);
    game.refreshHud();

    while (store.state.night <= data.nights.length) {
      await playNight(game);
      store.state.night += 1;
      store.save();
    }

    store.clearSave();
    game.music.play('title');
    const h = store.state.history;
    await ui.ending({
      money: store.state.money,
      reputation: store.state.reputation,
      surgeries: h.filter((r) => r.implantId && !r.revisit).length,
      perfects: h.filter((r) => r.quality === 'perfect').length,
    });
  }
}

async function playNight(game) {
  const { ui, store, data, director } = game;
  const plan = nightPlan(data.nights, store.state.night);
  ui.setPhase('开门营业');
  game.refreshHud();
  game.music.play('clinic');
  director.overview(1.2);
  await ui.banner(plan.title, '高架桥下，面摊后屋，霓虹亮起');

  if (plan.tutorial) {
    await ui.dialog({
      name: '老周',
      job: '面摊老板 · 二手义体贩子',
      text: '客人进门，先用你那只义眼扫一遍，看清要换哪儿、兜里有多少钱。躺上手术台以后按顺序做五步：切开、拆除、对位、接线、缝合。麻醉条见底病人就会醒，手脚麻利点。别把不对口的货卖出去。',
      buttons: [{ label: '明白', value: true, primary: true }],
    });
  }

  const records = [];
  const queue = plan.queue.map(parseEntry);
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    if (entry.type === 'revisit') {
      const rec = await handleRevisit(game, entry.id);
      if (rec) records.push(rec);
    } else {
      const rec = await handleCustomer(game, entry.id);
      if (rec) records.push(rec);
    }
    // 突发事件：排在第 N 个客人之后，每次开张只触发一次
    for (const inc of data.incidents) {
      if (inc.night !== store.state.night || inc.after !== i + 1 || store.state.incidents.includes(inc.id)) continue;
      // 前面的选择会改变后面的事：交了保护费，巡警就不会来查
      if (inc.skipIf && store.state.incidentChoices?.[inc.skipIf.incident] === inc.skipIf.choice) continue;
      const rec = await handleIncident(game, inc);
      if (rec) records.push(rec);
    }
  }
  await closeNight(game, records);
}

// 突发事件：老周转述，玩家二选一/三选一，钱和口碑当场结算；"硬扛"这类选项带赌运气
async function handleIncident(game, inc) {
  const { ui, store, director, sfx } = game;
  store.state.incidents.push(inc.id);
  store.save();
  ui.setPhase(inc.phase ?? '突发');
  director.overview(0.9);
  sfx.scanAlert?.();
  const pick = await ui.dialog({
    name: inc.speaker,
    job: inc.job,
    text: inc.text,
    buttons: inc.choices.map((ch, idx) => ({ label: ch.label, value: idx, primary: idx === 0, danger: ch.kind === 'danger' })),
  });
  const choice = inc.choices[pick] ?? inc.choices[0];
  (store.state.incidentChoices ??= {})[inc.id] = inc.choices.indexOf(choice);
  let outcome = choice;
  if (choice.gamble) {
    const won = Math.random() < choice.gamble.chance;
    outcome = { ...choice, ...(won ? choice.gamble.win : choice.gamble.lose) };
    sfx[won ? 'coin' : 'error']?.();
  }
  store.addMoney(outcome.money ?? 0);
  store.addReputation(outcome.rep ?? 0);
  store.save();
  game.refreshHud();
  const meta = [];
  if (outcome.money) meta.push({ text: `${outcome.money > 0 ? '+' : '−'}${money(Math.abs(outcome.money))}`, kind: outcome.money > 0 ? 'money' : 'bad' });
  if (outcome.rep) meta.push({ text: `口碑 ${outcome.rep > 0 ? '+' : ''}${outcome.rep}`, kind: outcome.rep > 0 ? 'good' : 'bad' });
  await ui.dialog({
    name: inc.speaker,
    job: inc.job,
    text: outcome.result,
    meta,
    buttons: [{ label: '继续营业', value: true, primary: true }],
  });
  // 记进今晚的账：正数算收入，负数算成本
  return { incident: inc.id, charged: Math.max(0, outcome.money ?? 0), tip: 0, cost: Math.max(0, -(outcome.money ?? 0)) };
}

function patientFor(game, id) {
  const c = game.data.customers[id];
  return game.data.patients[id] ?? { id, name: c.name, model: null, height_m: 1.75 };
}

async function handleCustomer(game, id) {
  const { ui, store, data, rig, director } = game;
  const c = data.customers[id];
  const slot = data.slots[c.slot];
  ui.setPhase(`接诊 · ${c.name}`);
  await rig.load(patientFor(game, id), game.patientCalibration(id));
  director.overview(0.8);

  const fx = game.fx();
  const budget = effectiveBudget(c, fx);
  // 病人走到床尾站好，医生用义眼扫一遍
  await rig.waitWalk();
  await game.scan.run({ customer: c, slotKey: c.slot, budget });
  rig.play('talk', { fade: 0.5 });
  const decision = await ui.dialog({
    name: c.name,
    job: c.job,
    text: c.lines.enter,
    meta: [
      { text: `预算 ${money(budget)}`, kind: 'money' },
      { text: `神经容量 ${c.capacity}` },
      { text: `手术部位 ${slot.label}` },
    ],
    buttons: [
      { label: '拒绝', value: 'refuse', danger: true },
      { label: '接诊', value: 'accept', primary: true },
    ],
  });
  rig.play('idle', { fade: 0.6 });
  if (decision === 'refuse') {
    game.scan.clearHighlight();
    ui.toast(`送走了 ${c.name}`);
    await rig.walkOut();
    return null;
  }

  ui.setPhase('选件');
  director.shelf(0.8);
  const items = data.implantList
    .map((implant) => {
      const overloaded = isOverloaded(c, implant);
      return {
        implant: { ...implant, slotLabel: data.slots[implant.slot]?.label ?? implant.slot },
        status: shelfStatus(c, implant, fx),
        brandName: data.balance.brands[implant.brand] ?? implant.brand,
        thumbUrl: assetUrl(implant.thumb),
        wires: wireCount(implant, overloaded, data.balance),
      };
    })
    // 排序：本部位 > 可选 > 客人点名要的那件 > 便宜的在前（自动模式会选第一件可选的，所以点名件要排前面）
    .sort(
      (a, b) =>
        Number(b.implant.slot === c.slot) - Number(a.implant.slot === c.slot) ||
        Number(b.status.selectable) - Number(a.status.selectable) ||
        Number(b.implant.id === c.best) - Number(a.implant.id === c.best) ||
        a.implant.price - b.implant.price,
    );
  const implantId = await ui.shelf({
    title: `给${c.name}选一款义体`,
    subtitle: `“${c.lines.enter}”　预算 ${money(budget)} · 神经容量 ${c.capacity} · 部位 ${slot.label}`,
    items,
  });
  if (!implantId) {
    game.scan.clearHighlight();
    await ui.dialog({ name: c.name, job: c.job, text: '……那我去别家看看。' });
    await rig.walkOut();
    return null;
  }

  const implant = data.implants[implantId];
  ui.setPhase(`手术 · ${c.name}`);
  const session = new SurgerySession(game, { customer: c, implant, slotKey: c.slot });
  game.session = session;
  const result = await session.run();
  game.session = null;

  const settle = settleSurgery({ customer: c, implant, quality: result.quality, balance: data.balance, fx });
  const overloaded = isOverloaded(c, implant);
  store.addMoney(settle.charged + settle.tip - settle.cost);
  store.addReputation(settle.repDelta);
  const rec = {
    night: store.state.night,
    customerId: id,
    implantId,
    quality: result.quality,
    average: result.average,
    scores: result.scores,
    overloaded,
    risk: rejectionRisk({ implant, overloaded, quality: result.quality, balance: data.balance }),
    ...settle,
  };
  store.record(rec);
  game.refreshHud();

  const line = result.quality === 'fail' ? c.lines.fail : settle.match === 'best' && result.quality !== 'poor' ? c.lines.happy : c.lines.meh;
  // 术后反应：满意就握拳庆祝，凑合就东张西望，失败就抱头喊疼再发火
  if (result.quality === 'fail') rig.play('pain', { once: true, then: 'angry', fade: 0.3 });
  else if (line === c.lines.happy) rig.play('happy', { once: true, then: 'sway', fade: 0.3 });
  else rig.play('look', { fade: 0.5 });
  ui.setPhase('结算');
  director.overview(0.9);
  const meta = [
    { text: `收费 +${money(settle.charged)}`, kind: 'money' },
    { text: `小费 +${money(settle.tip)}`, kind: 'money' },
    { text: `义体进价 −${money(settle.cost)}`, kind: 'bad' },
  ];
  if (settle.repDelta) meta.push({ text: `口碑 ${settle.repDelta > 0 ? '+' : ''}${settle.repDelta}`, kind: settle.repDelta > 0 ? 'good' : 'bad' });
  if (overloaded) meta.push({ text: `神经超载 · 排异风险 ${Math.round(rec.risk * 100)}%`, kind: 'bad' });
  await ui.dialog({
    name: c.name,
    job: `手术${GRADE_LABEL[result.quality]} · 平均 ${result.average} 分`,
    text: line,
    meta,
    buttons: [{ label: '送客', value: true, primary: true }],
  });
  await rig.walkOut();
  return rec;
}

async function handleRevisit(game, id) {
  const { ui, store, data, rig, director } = game;
  const record = store.lastRecordFor(id);
  const out = revisitOutcome(record, data.balance);
  if (out.kind === 'none') return null;
  const c = data.customers[id];
  const implant = data.implants[record.implantId];
  ui.setPhase(`回访 · ${c.name}`);
  await rig.load(patientFor(game, id), game.patientCalibration(id));
  await rig.installDirect(c.slot, implant, game.implantCalibration(implant.id), data.slots[c.slot].cutMode, data.slots[c.slot].hollow);
  director.overview(0.8);
  await rig.waitWalk();

  let rec = null;
  if (out.kind === 'thanks') {
    rig.play('happy', { once: true, then: 'sway', fade: 0.3 });
    await ui.dialog({
      name: c.name,
      job: '回访',
      text: c.lines.revisitHappy ?? '谢谢医生！',
      meta: [{ text: `小费 +${money(out.tip)}`, kind: 'money' }],
      buttons: [{ label: '收下', value: true, primary: true }],
    });
    store.addMoney(out.tip);
    rec = { customerId: id, revisit: true, charged: 0, tip: out.tip, cost: 0 };
  } else {
    rig.play('angry', { fade: 0.4 });
    const choice = await ui.dialog({
      name: c.name,
      job: '回访 · 投诉',
      text: c.lines.revisitAngry ?? '你缝的地方出问题了。',
      buttons: [
        { label: '不管', value: 'no', danger: true },
        { label: '免费返修', value: 'fix', primary: true },
      ],
    });
    if (choice === 'fix') {
      const session = new SurgerySession(game, { customer: c, implant, slotKey: c.slot, onlySteps: ['suture'] });
      game.session = session;
      const result = await session.run();
      game.session = null;
      if (result.quality === 'perfect' || result.quality === 'good') {
        store.addReputation(data.balance.revisit.fixRepBonus);
        ui.toast('返修成功，口碑回升', 'good');
      }
    } else {
      store.addReputation(-0.5);
      ui.toast('客人骂骂咧咧地走了，口碑 −0.5', 'bad');
    }
    rec = { customerId: id, revisit: true, charged: 0, tip: 0, cost: 0 };
  }
  game.refreshHud();
  await rig.walkOut();
  return rec;
}

async function closeNight(game, records) {
  const { ui, store, data, clinic, director } = game;
  const ledger = nightLedger(records, data.balance);
  store.addMoney(-ledger.rent);
  game.refreshHud();
  ui.setPhase('打烊');
  director.overview(1.0);
  await ui.ledger({
    night: store.state.night,
    ledger,
    getMoney: () => store.state.money,
    upgrades: () =>
      data.upgrades.map((up) => ({ up, level: store.level(up.key), status: canBuy(up, store.state.upgrades, store.state.money) })),
    onBuy: (key) => {
      const up = data.upgrades.find((u) => u.key === key);
      if (!canBuy(up, store.state.upgrades, store.state.money).ok) return false;
      store.addMoney(-up.price);
      store.state.upgrades[key] = store.level(key) + 1;
      clinic.applyUpgrades(store.state.upgrades);
      game.refreshHud();
      ui.toast(`${up.name} 已安装`, 'good');
      return true;
    },
  });
}
