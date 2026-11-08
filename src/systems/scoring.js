// 五步手术的评分：每步 0–100，平均分决定手术质量

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round = (v) => Math.round(Math.max(0, Math.min(100, v)));

export function incisionScore(coverage, meanDeviationPx, tolPx) {
  const devScore = clamp01(1 - meanDeviationPx / (2 * tolPx));
  return round(100 * (0.6 * clamp01(coverage) + 0.4 * devScore));
}

export function removalScore(tears) {
  return round(Math.max(40, 100 - 25 * tears));
}

export function alignScore(angleErrDeg, tolDeg, attempts) {
  const precision = 1 - 0.5 * clamp01(angleErrDeg / tolDeg);
  return round(100 * precision - 10 * Math.max(0, attempts - 1));
}

export function wiringScore(mistakes) {
  return round(Math.max(30, 100 - 20 * mistakes));
}

// offsetsMs：每针点击时间与节拍的偏差，miss 记为 null
export function sutureScore(offsetsMs, windowMs) {
  if (!offsetsMs.length) return 0;
  const per = offsetsMs.map((off) => {
    if (off === null || off === undefined) return 30;
    const a = Math.abs(off);
    if (a <= windowMs / 3) return 100;
    if (a <= windowMs) return 75;
    return 45;
  });
  return round(per.reduce((s, v) => s + v, 0) / per.length);
}

export function gradeOf(score, thresholds) {
  if (score >= thresholds.perfect) return 'perfect';
  if (score >= thresholds.good) return 'good';
  return 'poor';
}

export const GRADE_LABEL = { perfect: '完美', good: '良好', poor: '勉强', fail: '失败' };

export function surgeryQuality(scores, thresholds, failed = false) {
  if (failed) return { average: 0, quality: 'fail' };
  const values = Object.values(scores);
  if (!values.length) return { average: 0, quality: 'fail' };
  const average = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  return { average, quality: gradeOf(average, thresholds) };
}
