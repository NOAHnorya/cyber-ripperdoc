// 经济结算：纯函数，不碰渲染和 DOM，可以直接单元测试

export function matchType(customer, implant) {
  if (!implant || implant.slot !== customer.slot) return 'mismatch';
  if (implant.id === customer.best) return 'best';
  return 'ok';
}

export function effectiveBudget(customer, fx = {}) {
  return Math.round(customer.budget * (1 + (fx.budgetBonus || 0)));
}

export function isOverloaded(customer, implant) {
  return implant.load > customer.capacity;
}

// 货架上一款义体对这位客人是否可选，以及不可选的原因
export function shelfStatus(customer, implant, fx = {}) {
  if (implant.slot !== customer.slot) return { selectable: false, reason: '部位不对' };
  if (implant.price > effectiveBudget(customer, fx)) return { selectable: false, reason: '超预算' };
  if (isOverloaded(customer, implant)) return { selectable: true, warning: '神经超载' };
  return { selectable: true };
}

export function settleSurgery({ customer, implant, quality, discount = 0, balance, fx = {}, rng = Math.random }) {
  const match = matchType(customer, implant);
  const cost = Math.round(implant.price * balance.costRatio);
  if (quality === 'fail' || match === 'mismatch') {
    return { match, charged: 0, tip: 0, cost, repDelta: balance.reputation.fail, satisfaction: 0 };
  }
  const qualityMult = balance.qualityMultiplier[quality] ?? 1;
  const matchMult = match === 'best' ? 1 : balance.mismatchFactor;
  const charged = Math.round(implant.price * qualityMult * matchMult * (1 - discount));
  const qualitySat = quality === 'perfect' ? 1 : quality === 'good' ? 0.85 : 0.6;
  const satisfaction = matchMult * qualitySat;

  let tip = 0;
  if (satisfaction >= 0.85) {
    const [lo, hi] = balance.tipRange;
    tip = Math.round(charged * (lo + (hi - lo) * rng() + (fx.tipBonus || 0)));
  }

  let repDelta = quality === 'perfect' ? balance.reputation.perfect : 0;
  if (discount > 0 && match === 'best') repDelta += balance.reputation.discountBonus;
  return { match, charged, tip, cost, repDelta, satisfaction };
}

export function rejectionRisk({ implant, overloaded, quality, balance }) {
  let risk = balance.rejectionBase[implant.brand] ?? 0.1;
  if (overloaded) risk *= 2;
  if (quality === 'poor') risk *= 1.5;
  return Math.min(risk, 0.95);
}

export function nightLedger(records, balance) {
  const income = records.reduce((sum, r) => sum + r.charged + r.tip, 0);
  const costs = records.reduce((sum, r) => sum + r.cost, 0);
  const rent = balance.rentPerNight;
  return { income, costs, rent, net: income - costs - rent };
}

export function clampReputation(value, balance) {
  return Math.min(balance.reputation.max, Math.max(balance.reputation.min, value));
}
