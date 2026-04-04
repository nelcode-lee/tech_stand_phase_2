/**
 * Static scenarios for the HITL demo page — same shapes as analysis API results (subset).
 * Not loaded from the backend.
 */

export const DEMO_HITL_SCENARIOS = [
  {
    id: 'demo-critical-risk',
    queueTitle: 'Foreign body control — Hull',
    queueSubtitle: 'Submitted after Analyse · critical HACCP gap',
    submittedAt: '2026-04-02T14:30:00Z',
    result: {
      tracking_id: 'demo-fb-001',
      document_title: 'FSP-042 Foreign Body Detection and Control',
      overall_risk: 'critical',
      risk_gaps: [
        {
          location: 'Metal detection — verification',
          excerpt:
            'Foreign bodies can originate from many areas within the business, including hair, metal, plastic, equipment parts, machinery, personal items, raw materials, string, elastic, tape, and food contact packaging.',
          issue: 'Frequency of documented metal detector checks during production is not tied to risk or throughput.',
          risk: 'Undetected metal contamination could reach the customer if monitoring intervals are insufficient.',
          recommendation:
            'State minimum check frequency per line/shift and record retention; align to HACCP plan CCP limits.',
          severity: 6,
          likelihood: 5,
          detectability: 6,
          fmea_score: 180,
          fmea_band: 'critical',
        },
        {
          location: 'Corrective action',
          excerpt: 'When a foreign body is detected, isolate affected product and inform the supervisor.',
          issue: 'No defined threshold for placing additional upstream product on hold when metal is found.',
          risk: 'Product already despatched or blended may not be recalled in time.',
          recommendation:
            'Define hold scope (batch, time window, line) and escalation to QA for release decisions.',
          severity: 5,
          likelihood: 3,
          detectability: 2,
          fmea_score: 30,
          fmea_band: 'low',
        },
      ],
      sequencing_flags: [],
      glossary_candidates: [
        { term: 'throughput', recommendation: 'Define whether this means units per hour or kg per hour for this site.' },
        { term: 'line clearance', recommendation: 'Add to glossary or spell out on first use.' },
      ],
      compliance_flags: [],
    },
  },
  {
    id: 'demo-sequencing-hitl',
    queueTitle: 'Despatch load verification',
    queueSubtitle: 'Sequencing + policy clause review',
    submittedAt: '2026-04-01T09:15:00Z',
    result: {
      tracking_id: 'demo-desp-002',
      document_title: 'SOP-118 Vehicle Loading and Despatch',
      overall_risk: 'medium',
      risk_gaps: [],
      sequencing_flags: [
        {
          location: 'Section 4 — Load completion',
          excerpt: 'The driver signs the manifest to confirm loading is complete.',
          issue: 'Sign-off appears before the procedure describes seal application and temperature check.',
          finding_type: 'COMPLETION_SEQUENCE',
          dependency_signal: '3',
          signal_evidence: 'signs the manifest to confirm loading is complete',
          impact: 'Documentation may show approval before critical control steps are recorded.',
          recommendation: null,
          hitl_reason:
            'Two valid orderings exist (site A: sign then seal; site B: seal then sign). SME must confirm which applies for this document version.',
          priority: 'MUST FIX',
          citations: [],
        },
      ],
      glossary_candidates: [],
      compliance_flags: [
        {
          location: 'Temperature monitoring',
          excerpt: 'Vehicle temperature must be checked before unloading.',
          issue: 'BRCGS clause on transport temperature monitoring is not explicitly referenced.',
          recommendation: 'Add cross-reference to site cold chain policy or BRCGS expectation clause.',
          clause_mapping: {
            status: 'unmapped',
            unmapped_reason: 'no_candidates',
            standard_name: 'BRCGS Food Safety',
            requirement_preview: 'Monitoring of transport conditions for vehicles used for raw materials and finished products.',
            site_scope: ['Hull', 'Milton Keynes'],
          },
        },
      ],
    },
  },
];
