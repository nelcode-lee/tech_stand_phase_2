/**
 * Derive dashboard risk metrics from an analysis API result (matches backend _compute_risk_metrics).
 * @param {Record<string, unknown> | null | undefined} resultJson
 */

export function computeRiskMetrics(resultJson) {
  if (!resultJson || typeof resultJson !== 'object') return null;
  const gaps = Array.isArray(resultJson.risk_gaps) ? resultJson.risk_gaps : [];
  const bands = { low: 0, medium: 0, high: 0, critical: 0 };
  let unknownBand = 0;
  const rpns = [];
  let gapCount = 0;
  for (const g of gaps) {
    if (!g || typeof g !== 'object') continue;
    gapCount += 1;
    const b = String(g.fmea_band || '')
      .toLowerCase()
      .trim();
    if (b in bands) bands[b] += 1;
    else unknownBand += 1;
    const score = g.fmea_score;
    const n = Number(score);
    if (Number.isFinite(n) && n > 0) rpns.push(Math.round(n));
  }
  return {
    risk_gap_count: gapCount,
    gaps_by_band: bands,
    gaps_unknown_band: unknownBand,
    max_rpn: rpns.length ? Math.max(...rpns) : 0,
    avg_rpn: rpns.length ? Math.round((rpns.reduce((a, x) => a + x, 0) / rpns.length) * 10) / 10 : 0,
  };
}
