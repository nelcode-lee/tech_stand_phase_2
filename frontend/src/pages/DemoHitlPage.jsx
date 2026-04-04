import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Info } from 'lucide-react';
import { DEMO_HITL_SCENARIOS } from '../data/demoHitlScenarios';
import './DemoHitlPage.css';

const STORAGE_KEY = 'demo-hitl-queue-v1';

const STATUS_LABEL = {
  pending: 'Pending review',
  approved: 'Approved',
  changes: 'Changes requested',
  rejected: 'Rejected',
};

function loadStatuses() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return typeof p === 'object' && p ? p : {};
  } catch {
    return {};
  }
}

function HaccpScoreLine({ gap }) {
  const band = (gap.fmea_band || '').toLowerCase();
  const score = gap.fmea_score || 0;
  if (!score && !band) return null;
  const filled = score ? Math.min(20, Math.round(score / 10.8)) : 0;
  const empty = 20 - filled;
  return (
    <div className="demo-hitl-rpn-row">
      <span className="demo-haccp-bar-wrap" title="HACCP score (demo data)">
        <span className={`demo-haccp-band ${band}`}>{band || '—'}</span>
        <span>{score ? `${'█'.repeat(filled)}${'░'.repeat(empty)} ${score}` : ''}</span>
      </span>
      <span>
        S={gap.severity ?? '—'} · L={gap.likelihood ?? gap.scope ?? '—'} · D=
        {gap.detectability > 0 ? gap.detectability : '3 (default)'}
      </span>
    </div>
  );
}

export default function DemoHitlPage() {
  const scenarios = useMemo(() => DEMO_HITL_SCENARIOS, []);
  const [selectedId, setSelectedId] = useState(scenarios[0]?.id || '');
  const [statuses, setStatuses] = useState(loadStatuses);
  const [actionToast, setActionToast] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses));
  }, [statuses]);

  const selected = useMemo(
    () => scenarios.find((s) => s.id === selectedId) || scenarios[0],
    [scenarios, selectedId]
  );

  const status = statuses[selected?.id] || 'pending';

  const setStatus = useCallback((next) => {
    if (!selected) return;
    setStatuses((prev) => ({ ...prev, [selected.id]: next }));
    setActionToast(
      next === 'approved'
        ? 'In production, Workato would record approval and notify the document owner.'
        : next === 'changes'
          ? 'In production, this would return the draft with comments (e.g. Teams or email).'
          : next === 'rejected'
            ? 'In production, rejection would stop the publish path and alert the requester.'
            : ''
    );
    setTimeout(() => setActionToast(''), 5000);
  }, [selected]);

  const resetDemo = useCallback(() => {
    setStatuses({});
    localStorage.removeItem(STORAGE_KEY);
    setActionToast('Queue reset. All items are pending again.');
    setTimeout(() => setActionToast(''), 3000);
  }, []);

  if (!selected) {
    return (
      <div className="demo-hitl-page">
        <p className="demo-hitl-empty">No demo scenarios configured.</p>
      </div>
    );
  }

  const r = selected.result;
  const submitted = selected.submittedAt
    ? new Date(selected.submittedAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

  return (
    <div className="demo-hitl-page">
      <div className="demo-hitl-banner">
        <Info className="demo-hitl-banner-icon" size={22} aria-hidden />
        <div>
          <h2>HITL review (simulation)</h2>
          <p>
            This page is for demonstrations only. Findings are static fixtures. Approve, request changes, and reject
            update <strong>this browser</strong> only. They do not call Workato, Teams, or your library.
          </p>
        </div>
      </div>

      <div className="demo-hitl-layout">
        <aside className="demo-hitl-queue" aria-label="Demo queue">
          <div className="demo-hitl-queue-header">Review queue</div>
          <ul className="demo-hitl-queue-list">
            {scenarios.map((s) => {
              const st = statuses[s.id] || 'pending';
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`demo-hitl-queue-item ${selectedId === s.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(s.id)}
                  >
                    <span className="demo-hitl-queue-title">{s.queueTitle}</span>
                    <span className="demo-hitl-queue-sub">{s.queueSubtitle}</span>
                    <span className={`demo-hitl-status-pill ${st}`}>{STATUS_LABEL[st]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="demo-hitl-detail" aria-label="Finding detail">
          <div className="demo-hitl-detail-head">
            <h3>{r.document_title || 'Document'}</h3>
            <div className="demo-hitl-meta">
              Tracking <code>{r.tracking_id}</code>
              {' · '}
              Submitted {submitted}
              {r.overall_risk && (
                <>
                  {' · '}
                  Overall risk: <strong>{r.overall_risk}</strong>
                </>
              )}
            </div>
          </div>

          <div className="demo-hitl-actions">
            <button type="button" className="primary" onClick={() => setStatus('approved')}>
              Approve
            </button>
            <button type="button" onClick={() => setStatus('changes')}>
              Request changes
            </button>
            <button type="button" className="danger" onClick={() => setStatus('rejected')}>
              Reject
            </button>
            <button type="button" onClick={resetDemo}>
              Reset demo
            </button>
          </div>

          {actionToast && <div className="demo-hitl-toast">{actionToast}</div>}

          {Array.isArray(r.risk_gaps) && r.risk_gaps.length > 0 && (
            <div className="demo-hitl-section">
              <h4>Risk gaps</h4>
              {r.risk_gaps.map((g, i) => (
                <div key={i} className="demo-hitl-card">
                  <div className="demo-hitl-card-label">{g.location || '—'}</div>
                  {g.excerpt && <div className="demo-hitl-excerpt">{g.excerpt}</div>}
                  <p>
                    <strong>Issue:</strong> {g.issue}
                  </p>
                  <p>
                    <strong>Risk:</strong> {g.risk}
                  </p>
                  <p>
                    <strong>Recommendation:</strong> {g.recommendation}
                  </p>
                  <HaccpScoreLine gap={g} />
                </div>
              ))}
            </div>
          )}

          {Array.isArray(r.sequencing_flags) && r.sequencing_flags.length > 0 && (
            <div className="demo-hitl-section">
              <h4>Sequencing</h4>
              {r.sequencing_flags.map((f, i) => (
                <div key={i} className="demo-hitl-card">
                  <div className="demo-hitl-card-label">{f.location}</div>
                  {f.excerpt && <div className="demo-hitl-excerpt">{f.excerpt}</div>}
                  <p>
                    <strong>Issue:</strong> {f.issue}
                  </p>
                  <p>
                    <strong>Impact:</strong> {f.impact}
                  </p>
                  {f.recommendation && (
                    <p>
                      <strong>Recommendation:</strong> {f.recommendation}
                    </p>
                  )}
                  {f.hitl_reason && (
                    <div className="demo-hitl-hitl-box">
                      <strong>HITL:</strong> {f.hitl_reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {Array.isArray(r.glossary_candidates) && r.glossary_candidates.length > 0 && (
            <div className="demo-hitl-section">
              <h4>Glossary candidates</h4>
              <ul className="demo-hitl-card" style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {r.glossary_candidates.map((c, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <strong>{c.term}</strong> — {c.recommendation}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(r.compliance_flags) && r.compliance_flags.length > 0 && (
            <div className="demo-hitl-section">
              <h4>Compliance</h4>
              {r.compliance_flags.map((c, i) => (
                <div key={i} className="demo-hitl-card">
                  <div className="demo-hitl-card-label">{c.location}</div>
                  {c.excerpt && <div className="demo-hitl-excerpt">{c.excerpt}</div>}
                  <p>
                    <strong>Issue:</strong> {c.issue}
                  </p>
                  <p>
                    <strong>Recommendation:</strong> {c.recommendation}
                  </p>
                  {c.clause_mapping?.status === 'unmapped' && (
                    <div className="demo-hitl-clause-unmapped">
                      <strong>Policy clause:</strong> review needed ({c.clause_mapping.unmapped_reason || 'unmapped'})
                      {c.clause_mapping.standard_name && ` · ${c.clause_mapping.standard_name}`}
                      {c.clause_mapping.requirement_preview && (
                        <>
                          <br />
                          <em>{c.clause_mapping.requirement_preview}</em>
                        </>
                      )}
                      {Array.isArray(c.clause_mapping.site_scope) && c.clause_mapping.site_scope.length > 0 && (
                        <>
                          <br />
                          Sites: {c.clause_mapping.site_scope.join(', ')}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!r.risk_gaps?.length &&
            !r.sequencing_flags?.length &&
            !r.glossary_candidates?.length &&
            !r.compliance_flags?.length && (
              <p className="demo-hitl-empty">No findings in this scenario.</p>
            )}
        </section>
      </div>

      <p style={{ marginTop: 'var(--space-lg)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        <ClipboardCheck size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
        Tip: use <strong>Reset demo</strong> before the next stakeholder walkthrough so everything shows as pending.
      </p>
    </div>
  );
}
