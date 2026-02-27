import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { analyse } from '../api';
import { useAnalysis } from '../context/AnalysisContext';
import './AnalysePage.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FMEA_BAND_CLASS = {
  critical: 'fmea-critical',
  high:     'fmea-high',
  medium:   'fmea-medium',
  low:      'fmea-low',
};

const SEV_CLASS = {
  high:   'sev-high',
  medium: 'sev-medium',
  low:    'sev-low',
};

const INTEGRITY_TYPE_LABELS = {
  non_text_element:    'Non-text element',
  truncated_step:      'Truncated step',
  fragmented_sentence: 'Fragment',
  incomplete_list:     'Incomplete list',
  us_spelling:         'US spelling',
  encoding_anomaly:    'Encoding anomaly',
};

// Group an array of objects by a key value
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'other';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

// Render a single FMEA score bar (score 0–125, displayed as 20-segment bar)
function FmeaBar({ score, band }) {
  if (!score || !band) return null;
  const filled = Math.min(20, Math.round(score / 6.25));
  const empty = 20 - filled;
  return (
    <span className={`fmea-bar ${FMEA_BAND_CLASS[band] || ''}`} title={`FMEA ${band} — score ${score}`}>
      {'█'.repeat(filled)}{'░'.repeat(empty)}
      <span className="fmea-band-label">{band.toUpperCase()} {score}</span>
    </span>
  );
}

// Severity pill used by structure flags and content integrity flags
function SevPill({ severity }) {
  if (!severity) return null;
  return (
    <span className={`sev-pill ${SEV_CLASS[severity] || ''}`}>
      {severity.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalysePage({ mode = 'review' }) {
  const navigate = useNavigate();
  const ctx = useAnalysis();
  const result = ctx?.result ?? null;
  const setResult = ctx?.setResult ?? (() => {});
  const config = ctx?.config ?? { mode: 'full' };
  const recordSession = ctx?.recordSession ?? (() => {});
  const workflowMode = ctx?.workflowMode ?? mode;
  const base = `/${mode}`;

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleRun(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        tracking_id: `ui-${Date.now()}`,
        request_type: config.requestType || 'review_request',
        doc_layer: config.docLayer || 'sop',
        sites: config.sites ? config.sites.split(/[,\s]+/).filter(Boolean) : [],
        policy_ref: config.policyRef || null,
        document_id: config.documentId || null,
        title: config.title || config.documentId || null,
        query: query || undefined,
        agents: config?.mode && config.mode !== 'full' ? config.agents : undefined,
      };
      const res = await analyse(body);
      setResult(res);
      recordSession(res, config, workflowMode);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const flagCounts = result ? {
    'risk gaps':         result.risk_gaps?.length || 0,
    'specifying':        result.specifying_flags?.length || 0,
    'structure':         result.structure_flags?.length || 0,
    'content integrity': result.content_integrity_flags?.length || 0,
    'sequencing':        result.sequencing_flags?.length || 0,
    'formatting':        result.formatting_flags?.length || 0,
    'compliance':        result.compliance_flags?.length || 0,
    'terminology':       result.terminology_flags?.length || 0,
    'conflicts':         result.conflicts?.length || 0,
  } : null;

  const totalFindings = flagCounts
    ? Object.values(flagCounts).reduce((a, b) => a + b, 0)
    : 0;

  const isCreate = mode === 'create';

  return (
    <div className="analyse-page meatspec-main-content">
      <div className="doc-header">
        <div>
          <h2>{isCreate ? 'Analyse & Draft' : 'Review Findings'}</h2>
          <p className="doc-subtitle">Agent pipeline · {config.docLayer || 'sop'}{config.sites ? ` · ${config.sites}` : ''}</p>
        </div>
        <div className="doc-actions">
          <button type="button" className="doc-btn" onClick={() => navigate(`${base}/ingest`)}>← Back</button>
          <button type="submit" form="analyse-form" disabled={loading} className="doc-btn primary">
            {loading ? 'Analysing…' : 'Run Analysis'}
          </button>
        </div>
      </div>

      <form id="analyse-form" onSubmit={handleRun} className="analyse-form">
        <div className="form-row">
          <label>Search query (optional — used for vector retrieval)</label>
          <input
            type="text"
            placeholder="e.g. vehicle loading procedure"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </form>

      {error && <div className="analyse-error">{error}</div>}

      {result && (
        <section className="analyse-results docuguard-review">
          <div className="review-header">
            <h3>Findings</h3>
            <div className="resolved-counter">0 of {totalFindings} resolved</div>
            <button type="button" className="resolve-btn" onClick={() => navigate(`${base}/finalize`)}>
              {isCreate ? 'Continue to Draft →' : 'Resolve & Close →'}
            </button>
          </div>

          {/* Summary bar */}
          <div className="results-summary">
            <div className={`risk-badge risk-${result.overall_risk || 'unknown'}`}>
              {result.overall_risk || '—'}
            </div>
            <div className="summary-item">
              <span className="label">Draft ready</span>
              <span className="value">{result.draft_ready ? 'Yes' : 'No'}</span>
            </div>
            <div className="summary-item">
              <span className="label">Agents run</span>
              <span className="value">{result.agents_run?.join(', ') || '—'}</span>
            </div>
          </div>

          {/* Metric tiles */}
          {flagCounts && (
            <div className="flag-metrics">
              <h4>Flag counts</h4>
              <div className="metrics-grid">
                {Object.entries(flagCounts).map(([key, count]) => (
                  <div key={key} className={`metric${count === 0 ? ' metric-zero' : ''}`}>
                    <span className="metric-value">{count}</span>
                    <span className="metric-label">{key}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agent cards */}
          <div className="agent-cards">

            {/* Risk gaps — with FMEA scores */}
            {result.risk_gaps?.length > 0 && (
              <RiskGapCard items={result.risk_gaps} />
            )}

            {/* Structure flags — template compliance */}
            {result.structure_flags?.length > 0 && (
              <StructureCard items={result.structure_flags} />
            )}

            {/* Content integrity — grouped by sub-type */}
            {result.content_integrity_flags?.length > 0 && (
              <ContentIntegrityCard items={result.content_integrity_flags} />
            )}

            {result.specifying_flags?.length > 0 && (
              <AgentCard title="Specifying" items={result.specifying_flags}
                keys={['location', 'current_text', 'issue', 'recommendation']} />
            )}
            {result.sequencing_flags?.length > 0 && (
              <AgentCard title="Sequencing" items={result.sequencing_flags}
                keys={['location', 'issue', 'impact', 'recommendation']} />
            )}
            {result.formatting_flags?.length > 0 && (
              <AgentCard title="Formatting" items={result.formatting_flags}
                keys={['location', 'issue', 'recommendation']} />
            )}
            {result.compliance_flags?.length > 0 && (
              <AgentCard title="Compliance" items={result.compliance_flags}
                keys={['location', 'issue', 'requirement_reference', 'recommendation']} />
            )}
            {result.terminology_flags?.length > 0 && (
              <AgentCard title="Terminology" items={result.terminology_flags}
                keys={['term', 'location', 'issue', 'recommendation']} />
            )}
            {result.conflicts?.length > 0 && (
              <AgentCard title="Conflicts" items={result.conflicts}
                keys={['conflict_type', 'severity', 'description', 'recommendation']} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk Gap card — sorted by FMEA score, shows score bar inline
// ---------------------------------------------------------------------------
function RiskGapCard({ items }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...items].sort((a, b) => (b.fmea_score || 0) - (a.fmea_score || 0));
  const display = expanded ? sorted : sorted.slice(0, 3);

  return (
    <div className="agent-card">
      <button type="button" className="agent-card-header" onClick={() => setExpanded(!expanded)}>
        <h4>Risk Gaps</h4>
        <span className="count">{items.length}</span>
      </button>
      <ul className="agent-list">
        {display.map((gap, i) => (
          <li key={i} className="agent-item">
            <div className="risk-gap-top">
              <span className="agent-field-label">{gap.location || '—'}</span>
              <FmeaBar score={gap.fmea_score} band={gap.fmea_band} />
            </div>
            {gap.fmea_score > 0 && (
              <div className="fmea-dimensions">
                S={gap.severity} · Sc={gap.scope} · D={gap.detectability}
              </div>
            )}
            <div className="agent-field">
              <span className="agent-field-label">issue:</span>{' '}
              <span className="agent-field-value">{gap.issue}</span>
            </div>
            <div className="agent-field">
              <span className="agent-field-label">risk:</span>{' '}
              <span className="agent-field-value">{gap.risk}</span>
            </div>
            <div className="agent-field">
              <span className="agent-field-label">recommendation:</span>{' '}
              <span className="agent-field-value">{gap.recommendation}</span>
            </div>
          </li>
        ))}
      </ul>
      {items.length > 3 && !expanded && (
        <button type="button" className="show-more" onClick={() => setExpanded(true)}>
          Show {items.length - 3} more
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structure flag card — omission/ordering, shows severity pill
// ---------------------------------------------------------------------------
function StructureCard({ items }) {
  const [expanded, setExpanded] = useState(false);
  // Required-section omissions first, then ordering, then optional omissions
  const sorted = [...items].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.severity] ?? 1) - (order[b.severity] ?? 1);
  });
  const display = expanded ? sorted : sorted.slice(0, 5);

  return (
    <div className="agent-card">
      <button type="button" className="agent-card-header" onClick={() => setExpanded(!expanded)}>
        <h4>Structure — Template Compliance</h4>
        <span className="count">{items.length}</span>
      </button>
      <ul className="agent-list">
        {display.map((flag, i) => (
          <li key={i} className="agent-item structure-item">
            <div className="structure-top">
              <SevPill severity={flag.severity} />
              <span className="structure-type">{flag.flag_type}</span>
              <strong className="structure-section">{flag.section}</strong>
            </div>
            <div className="agent-field">
              <span className="agent-field-value">{flag.detail}</span>
            </div>
            <div className="agent-field">
              <span className="agent-field-label">recommendation:</span>{' '}
              <span className="agent-field-value">{flag.recommendation}</span>
            </div>
          </li>
        ))}
      </ul>
      {items.length > 5 && !expanded && (
        <button type="button" className="show-more" onClick={() => setExpanded(true)}>
          Show {items.length - 5} more
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content integrity card — grouped by flag_type sub-section
// ---------------------------------------------------------------------------
function ContentIntegrityCard({ items }) {
  const [expanded, setExpanded] = useState(false);
  const grouped = groupBy(items, 'flag_type');

  // Priority order for sub-sections: non-text and truncation first
  const typeOrder = ['non_text_element', 'truncated_step', 'fragmented_sentence',
                     'incomplete_list', 'encoding_anomaly', 'us_spelling'];
  const orderedTypes = [
    ...typeOrder.filter(t => grouped[t]),
    ...Object.keys(grouped).filter(t => !typeOrder.includes(t)),
  ];

  return (
    <div className="agent-card">
      <button type="button" className="agent-card-header" onClick={() => setExpanded(!expanded)}>
        <h4>Content Integrity</h4>
        <span className="count">{items.length}</span>
      </button>

      {expanded && (
        <div className="integrity-groups">
          {orderedTypes.map(ftype => {
            const group = grouped[ftype];
            return (
              <IntegrityGroup key={ftype} ftype={ftype} items={group} />
            );
          })}
        </div>
      )}

      {/* Collapsed preview: show one item from highest-priority non-empty group */}
      {!expanded && (
        <ul className="agent-list">
          {orderedTypes.slice(0, 2).map(ftype => {
            const first = grouped[ftype][0];
            return (
              <li key={ftype} className="agent-item">
                <div className="integrity-top">
                  <span className="integrity-type-badge">{INTEGRITY_TYPE_LABELS[ftype] || ftype}</span>
                  <SevPill severity={first.severity} />
                  <span className="integrity-count-note">{grouped[ftype].length} finding{grouped[ftype].length > 1 ? 's' : ''}</span>
                </div>
                <div className="agent-field">
                  <span className="agent-field-value">{first.detail?.slice(0, 160)}{first.detail?.length > 160 ? '…' : ''}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="show-more" onClick={() => setExpanded(e => !e)}>
        {expanded ? 'Collapse ▲' : `Expand all ${items.length} findings ▼`}
      </button>
    </div>
  );
}

function IntegrityGroup({ ftype, items }) {
  const [open, setOpen] = useState(false);
  const label = INTEGRITY_TYPE_LABELS[ftype] || ftype.replace(/_/g, ' ');
  const display = open ? items : items.slice(0, 2);

  return (
    <div className="integrity-group">
      <button type="button" className="integrity-group-header" onClick={() => setOpen(o => !o)}>
        <span className="integrity-type-badge">{label}</span>
        <span className="integrity-group-count">{items.length}</span>
        <span className="integrity-toggle">{open ? '▲' : '▼'}</span>
      </button>
      <ul className="agent-list">
        {display.map((flag, i) => (
          <li key={i} className="agent-item">
            <div className="integrity-top">
              <SevPill severity={flag.severity} />
              {flag.location && (
                <span className="integrity-location">{flag.location}</span>
              )}
            </div>
            {flag.excerpt && (
              <div className="integrity-excerpt">
                <code>{flag.excerpt.slice(0, 120)}{flag.excerpt.length > 120 ? '…' : ''}</code>
              </div>
            )}
            <div className="agent-field">
              <span className="agent-field-value">{flag.detail}</span>
            </div>
            <div className="agent-field">
              <span className="agent-field-label">recommendation:</span>{' '}
              <span className="agent-field-value">{flag.recommendation}</span>
            </div>
          </li>
        ))}
      </ul>
      {items.length > 2 && !open && (
        <button type="button" className="show-more" onClick={() => setOpen(true)}>
          Show {items.length - 2} more in this group
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic agent card (existing behaviour, unchanged)
// ---------------------------------------------------------------------------
function AgentCard({ title, items, keys }) {
  const [expanded, setExpanded] = useState(false);
  const displayItems = expanded ? items : items.slice(0, 3);
  const hasMore = items.length > 3;

  return (
    <div className="agent-card">
      <button type="button" className="agent-card-header" onClick={() => setExpanded(!expanded)}>
        <h4>{title}</h4>
        <span className="count">{items.length}</span>
      </button>
      <ul className="agent-list">
        {displayItems.map((item, i) => (
          <li key={i} className="agent-item">
            {keys.map((k) => (
              item[k] && (
                <div key={k} className="agent-field">
                  <span className="agent-field-label">{k}:</span>{' '}
                  <span className="agent-field-value">
                    {String(item[k]).slice(0, 200)}{String(item[k]).length > 200 ? '…' : ''}
                  </span>
                </div>
              )
            ))}
          </li>
        ))}
      </ul>
      {hasMore && !expanded && (
        <button type="button" className="show-more" onClick={() => setExpanded(true)}>
          Show {items.length - 3} more
        </button>
      )}
    </div>
  );
}
