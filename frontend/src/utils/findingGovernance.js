/** Strip volatile fields so finding IDs stay stable across runs (same as AnalysePage). */
export function itemForFindingIdHash(item) {
  if (!item || typeof item !== 'object') return item;
  const {
    policy_evidence: _pe,
    policyEvidence: _pE,
    citations: _c,
    requirement_reference: _rr,
    clause_mapping: _cm,
    hazard_control_type: _hz,
    ...rest
  } = item;
  return rest;
}

/** Stable id per finding — must match governance rows and data-finding-id on cards. */
export function stableFindingId(agentKey, item) {
  const str = JSON.stringify(itemForFindingIdHash(item));
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
  return `${agentKey}:${h}`;
}

/**
 * Build stable finding rows for governance (disposition) — IDs must match stableFindingId.
 */
export function buildGovernanceRows(result, findingIdFn) {
  if (!result || typeof findingIdFn !== 'function') return [];
  const rows = [];
  const agents = [
    { label: 'Risk', key: 'risk', items: result.risk_gaps },
    { label: 'Cleanser', key: 'cleanser', items: result.cleanser_flags },
    { label: 'Structure', key: 'structure', items: result.structure_flags },
    { label: 'Specifying', key: 'specifying', items: result.specifying_flags },
    { label: 'Sequencing', key: 'sequencing', items: result.sequencing_flags },
    { label: 'Formatting', key: 'formatting', items: result.formatting_flags },
    { label: 'Compliance', key: 'compliance', items: result.compliance_flags },
    { label: 'Terminology', key: 'terminology', items: result.terminology_flags },
    { label: 'Conflict', key: 'conflict', items: result.conflicts },
  ];
  for (const { label, key, items } of agents) {
    if (!items?.length) continue;
    for (const item of items) {
      const id = findingIdFn(key, item);
      const excerpt = excerptPreview(key, item);
      const hazardModelHint = key === 'risk' ? String(item.hazard_control_type || '').trim() : '';
      rows.push({ id, agent: label, excerpt, hazardModelHint });
    }
  }
  for (const flag of result.content_integrity_flags || []) {
    const ft = flag.flag_type || 'non_text_element';
    const compositeKey = `content-integrity:${ft}`;
    const id = findingIdFn(compositeKey, flag);
    rows.push({
      id,
      agent: 'Content integrity',
      excerpt: excerptPreview('content-integrity', flag),
      hazardModelHint: '',
    });
  }
  return rows.slice(0, 200);
}

function excerptPreview(agentKey, item) {
  if (!item || typeof item !== 'object') return '';
  if (agentKey === 'risk') return String(item.excerpt || item.location || item.issue || '').slice(0, 140);
  if (agentKey === 'cleanser') return String(item.current_text || item.location || '').slice(0, 140);
  if (agentKey === 'structure') return String(item.section || item.detail || '').slice(0, 140);
  if (agentKey === 'content-integrity') return String(item.excerpt || item.location || item.detail || '').slice(0, 140);
  if (agentKey === 'specifying') return String(item.current_text || item.location || '').slice(0, 140);
  if (agentKey === 'sequencing') return String(item.excerpt || item.location || '').slice(0, 140);
  if (agentKey === 'formatting') return String(item.excerpt || item.location || item.issue || '').slice(0, 140);
  if (agentKey === 'compliance') return String(item.excerpt || item.location || item.issue || '').slice(0, 140);
  if (agentKey === 'terminology') return String(item.location || item.term || '').slice(0, 140);
  if (agentKey === 'conflict') return String(item.description || '').slice(0, 140);
  return String(item.excerpt || item.current_text || item.location || '').slice(0, 140);
}

export const DISPOSITION_OPTIONS = [
  { value: '', label: '— Not set —' },
  { value: 'must_fix', label: 'Must-fix' },
  { value: 'advisory', label: 'Advisory' },
  { value: 'info', label: 'Info' },
];

/** CCP / oPRP / PRP — risk findings only in UI; persisted map overrides model hint. */
export const HAZARD_CONTROL_OPTIONS = [
  { value: '', label: '— Inherit / not set —' },
  { value: 'ccp', label: 'CCP' },
  { value: 'oprp', label: 'oPRP' },
  { value: 'prp', label: 'PRP' },
];

/**
 * Effective hazard-control tag per risk gap id (user map wins, else model field on gap).
 * @param {Record<string, string>} userMap finding_hazard_control_tags from session
 */
export function effectiveHazardControlForRiskGap(gap, userMap, findingIdFn) {
  if (!gap || typeof findingIdFn !== 'function') return '';
  const id = findingIdFn('risk', gap);
  const u = userMap && typeof userMap === 'object' ? userMap[id] : '';
  if (u != null && String(u).trim() !== '') return String(u).trim();
  return String(gap.hazard_control_type || '').trim();
}
