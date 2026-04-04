/**
 * Epic C — operational aggregates from analysis sessions (client-side).
 */

function sessionTime(session) {
  const v = session?.completedAt || session?.completed_at || session?.analysis_date;
  const t = v ? new Date(v).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * @param {object[]} sessions
 * @returns {Map<string, object[]>} document_id -> sessions newest first
 */
export function groupSessionsByDocument(sessions) {
  const map = new Map();
  for (const s of sessions || []) {
    const docId = String(s.documentId || s.document_id || '').trim();
    if (!docId) continue;
    if (!map.has(docId)) map.set(docId, []);
    map.get(docId).push(s);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => sessionTime(b) - sessionTime(a));
  }
  return map;
}

/** @param {object} session */
export function riskMetricsForSession(session, computeRiskMetrics) {
  const rm = session?.riskMetrics ?? session?.risk_metrics;
  if (rm && typeof rm === 'object' && rm.gaps_by_band) return rm;
  if (session?.result && typeof computeRiskMetrics === 'function') {
    return computeRiskMetrics(session.result);
  }
  return null;
}

/**
 * One row per document: latest snapshot + run counts.
 * @param {object[]} sessions — already filtered (e.g. library-matched)
 * @param {function} computeRiskMetrics — from utils/riskMetrics
 */
export function buildDocumentHealthRows(sessions, computeRiskMetrics) {
  const byDoc = groupSessionsByDocument(sessions);
  const rows = [];
  for (const [documentId, runs] of byDoc.entries()) {
    const latest = runs[0];
    const rm = riskMetricsForSession(latest, computeRiskMetrics);
    const gb = rm?.gaps_by_band || {};
    const prev = runs.length > 1 ? runs[1] : null;
    rows.push({
      documentId,
      title: latest.title || documentId,
      sites: latest.sites || '',
      lastAt: latest.completedAt || latest.completed_at,
      runCount: runs.length,
      totalFindings: latest.totalFindings ?? latest.total_findings ?? 0,
      prevFindings: prev ? (prev.totalFindings ?? prev.total_findings ?? 0) : null,
      overallRisk: latest.overallRisk ?? latest.overall_risk ?? null,
      gapsCritical: Number(gb.critical) || 0,
      gapsHigh: Number(gb.high) || 0,
      gapsMedium: Number(gb.medium) || 0,
      gapsLow: Number(gb.low) || 0,
      latestSession: latest,
    });
  }
  rows.sort((a, b) => sessionTime({ completedAt: b.lastAt }) - sessionTime({ completedAt: a.lastAt }));
  return rows;
}

/**
 * Bucket by session.sites string (comma-separated labels).
 * @returns {{ label: string, sessions: number, findings: number }[]}
 */
export function aggregateBySiteLabel(sessions) {
  const map = new Map();
  for (const s of sessions || []) {
    const raw = String(s.sites || '').trim();
    const labels = raw
      ? raw.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)
      : ['(unspecified)'];
    const findings = s.totalFindings ?? s.total_findings ?? 0;
    for (const label of labels) {
      const prev = map.get(label) || { sessions: 0, findings: 0 };
      prev.sessions += 1;
      prev.findings += findings;
      map.set(label, prev);
    }
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.findings - a.findings || b.sessions - a.sessions);
}

/**
 * @returns {{ requester: string, sessions: number, findings: number }[]}
 */
export function aggregateByRequester(sessions) {
  const map = new Map();
  for (const s of sessions || []) {
    const r = String(s.requester || '').trim() || '(not recorded)';
    const findings = s.totalFindings ?? s.total_findings ?? 0;
    const prev = map.get(r) || { sessions: 0, findings: 0 };
    prev.sessions += 1;
    prev.findings += findings;
    map.set(r, prev);
  }
  return [...map.entries()]
    .map(([requester, v]) => ({ requester, ...v }))
    .sort((a, b) => b.findings - a.findings)
    .slice(0, 12);
}
