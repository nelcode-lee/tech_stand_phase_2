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
    representation_class_id: _rc,
    representation_standard_ref: _rsr,
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
 * Build stable finding rows for governance — IDs must match stableFindingId.
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
      rows.push({ id, agent: label, excerpt });
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
  if (agentKey === 'sequencing') return String(item.excerpt || item.location || item.issue || '').slice(0, 140);
  if (agentKey === 'formatting') return String(item.excerpt || item.location || item.issue || '').slice(0, 140);
  if (agentKey === 'compliance') return String(item.excerpt || item.location || item.issue || '').slice(0, 140);
  if (agentKey === 'terminology') return String(item.location || item.term || '').slice(0, 140);
  if (agentKey === 'conflict') return String(item.description || '').slice(0, 140);
  return String(item.excerpt || item.current_text || item.location || '').slice(0, 140);
}

/** User response per finding — stored in finding_dispositions JSON (same key as before). */
export const FINDING_RESPONSE_OPTIONS = [
  { value: '', label: '— Not set —' },
  { value: 'accept', label: 'Accept' },
  { value: 'edit', label: 'Edit' },
  { value: 'ignore', label: 'Ignore' },
];

/** Display label for export / tables (includes legacy disposition values). */
export function formatFindingResponseLabel(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '—';
  if (v === 'accept') return 'Accept';
  if (v === 'edit') return 'Edit';
  if (v === 'ignore') return 'Ignore';
  if (v === 'must_fix') return 'Must-fix (legacy)';
  if (v === 'advisory') return 'Advisory (legacy)';
  if (v === 'info') return 'Info (legacy)';
  return String(value);
}
