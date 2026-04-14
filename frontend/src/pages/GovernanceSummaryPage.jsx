import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { getAnalysisSession, saveAnalysisSession, docLayerForApi } from '../api';
import { resolveSitesForApi } from '../constants/sites';
import { buildGovernanceRows, stableFindingId, FINDING_RESPONSE_OPTIONS } from '../utils/findingGovernance';
import './GovernanceSummaryPage.css';

function normaliseSessionSites(sites) {
  if (Array.isArray(sites)) return sites.map((s) => String(s).trim()).filter(Boolean);
  return String(sites || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export default function GovernanceSummaryPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const trackingId = searchParams.get('trackingId');
  const isReview = location.pathname.startsWith('/review');
  const base = isReview ? '/review' : '/create';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [meta, setMeta] = useState(null);
  const [findingDispositions, setFindingDispositions] = useState({});
  const [findingGovernanceNotes, setFindingGovernanceNotes] = useState({});
  const [signOffUser, setSignOffUser] = useState('');
  const [signOffStatement, setSignOffStatement] = useState('');
  const [signOffAt, setSignOffAt] = useState('');
  const [governancePolicyRef, setGovernancePolicyRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  const governanceRows = useMemo(
    () => (result ? buildGovernanceRows(result, stableFindingId) : []),
    [result],
  );

  useEffect(() => {
    if (!trackingId) {
      setLoading(false);
      setError('Missing trackingId. Open this page from Analyse after running analysis.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const navHandoff = location.state && typeof location.state === 'object'
      ? location.state
      : null;
    const hadNavHandoff = !!(
      navHandoff?.findingDispositions ||
      navHandoff?.findingGovernanceNotes ||
      (navHandoff?.governancePolicyRef != null && String(navHandoff.governancePolicyRef).trim() !== '')
    );
    getAnalysisSession(trackingId)
      .then((session) => {
        if (cancelled) return;
        if (!session?.result) {
          setError('No stored results for this session. Run analysis again or check the database.');
          setLoading(false);
          return;
        }
        setResult(session.result);
        setMeta({
          documentId: session.documentId || '',
          title: session.title || '',
          requester: session.requester || '',
          docLayer: session.docLayer || 'sop',
          sites: normaliseSessionSites(session.sites),
        });
        setGovernancePolicyRef((session.policyRef || '').trim());
        setSignOffUser(session.signOffUser || '');
        setSignOffStatement(session.signOffStatement || '');
        setSignOffAt(session.signOffAt || '');
        const serverDisp =
          session.findingDispositions && typeof session.findingDispositions === 'object'
            ? { ...session.findingDispositions }
            : {};
        const navDisp = navHandoff?.findingDispositions;
        const overlay =
          navDisp && typeof navDisp === 'object' ? { ...navDisp } : {};
        setFindingDispositions({ ...serverDisp, ...overlay });
        const serverNotes =
          session.findingGovernanceNotes && typeof session.findingGovernanceNotes === 'object'
            ? { ...session.findingGovernanceNotes }
            : {};
        const navNotes = navHandoff?.findingGovernanceNotes;
        const notesOverlay =
          navNotes && typeof navNotes === 'object' ? { ...navNotes } : {};
        setFindingGovernanceNotes({ ...serverNotes, ...notesOverlay });
        const navPolicy = navHandoff?.governancePolicyRef;
        if (navPolicy != null && String(navPolicy).trim() !== '') {
          setGovernancePolicyRef(String(navPolicy).trim());
        }
        setLoading(false);
        /* Drop router handoff so browser Back/Forward does not re-apply stale overlays over fresh GET data */
        if (hadNavHandoff) {
          const path = `${location.pathname}${location.search}`;
          window.setTimeout(() => {
            navigate(path, { replace: true, state: null });
          }, 0);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load session.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [trackingId, location.key, location.pathname, location.search, navigate, location.state]);

  async function handleSave() {
    if (!result || !trackingId) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      /* Re-read session so result_json matches DB (avoids overwriting a newer analysis with stale React state). */
      let baseResult = result;
      try {
        const fresh = await getAnalysisSession(trackingId);
        if (fresh?.result) baseResult = fresh.result;
      } catch {
        /* keep baseResult from state */
      }

      const agentFindings = {};
      if (baseResult.risk_gaps?.length) agentFindings.risk = baseResult.risk_gaps.length;
      if (baseResult.cleanser_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + baseResult.cleanser_flags.length;
      if (baseResult.specifying_flags?.length) agentFindings.specifying = (agentFindings.specifying || 0) + baseResult.specifying_flags.length;
      if (baseResult.structure_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + baseResult.structure_flags.length;
      if (baseResult.content_integrity_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + baseResult.content_integrity_flags.length;
      if (baseResult.sequencing_flags?.length) agentFindings.sequencing = baseResult.sequencing_flags.length;
      if (baseResult.formatting_flags?.length) agentFindings.formatting = baseResult.formatting_flags.length;
      if (baseResult.compliance_flags?.length) agentFindings.validation = baseResult.compliance_flags.length;
      if (baseResult.terminology_flags?.length) agentFindings.terminology = baseResult.terminology_flags.length;
      if (baseResult.conflicts?.length) agentFindings.conflict = baseResult.conflicts.length;

      const totalFindings =
        (baseResult.risk_gaps?.length || 0) + (baseResult.cleanser_flags?.length || 0) + (baseResult.specifying_flags?.length || 0) +
        (baseResult.structure_flags?.length || 0) + (baseResult.content_integrity_flags?.length || 0) + (baseResult.sequencing_flags?.length || 0) +
        (baseResult.formatting_flags?.length || 0) + (baseResult.compliance_flags?.length || 0) + (baseResult.terminology_flags?.length || 0) +
        (baseResult.conflicts?.length || 0);

      const sitesArr = meta?.sites?.length ? resolveSitesForApi(meta.sites) : [];
      const sitesStr = sitesArr.includes('all') ? 'All Sites' : sitesArr.join(',');

      const res = await saveAnalysisSession({
        tracking_id: trackingId,
        document_id: meta?.documentId || baseResult.document_id || '',
        title: meta?.title || baseResult.title || meta?.documentId || 'Unnamed',
        requester: meta?.requester || baseResult.requester || '',
        doc_layer: docLayerForApi((meta?.docLayer || baseResult.doc_layer || 'sop').toLowerCase()),
        sites: sitesStr,
        policy_ref: (governancePolicyRef || '').trim(),
        overall_risk: baseResult.overall_risk || null,
        total_findings: totalFindings,
        agents_run: baseResult.agents_run || [],
        agent_findings: agentFindings,
        corrections_implemented: 0,
        sign_off_user: (signOffUser || '').trim(),
        sign_off_statement: (signOffStatement || '').trim(),
        sign_off_at: signOffAt || null,
        finding_dispositions: findingDispositions,
        finding_governance_notes: findingGovernanceNotes,
        finding_hazard_control_tags: {},
        result_json: {
          ...baseResult,
          document_id: meta?.documentId || baseResult.document_id || '',
          title: meta?.title || baseResult.title || '',
          doc_layer: meta?.docLayer || baseResult.doc_layer || 'sop',
          finding_dispositions: findingDispositions,
          finding_governance_notes: findingGovernanceNotes,
        },
        governance_save_mode: 'full',
      });
      setSaveStatus(res?.ok !== false ? 'saved' : 'error');
      if (res?.ok !== false) {
        try {
          const refreshed = await getAnalysisSession(trackingId);
          if (refreshed?.result) {
            setResult(refreshed.result);
            setGovernancePolicyRef((refreshed.policyRef || '').trim());
            setSignOffUser(refreshed.signOffUser || '');
            setSignOffStatement(refreshed.signOffStatement || '');
            setSignOffAt(refreshed.signOffAt || '');
            setFindingDispositions(
              refreshed.findingDispositions && typeof refreshed.findingDispositions === 'object'
                ? { ...refreshed.findingDispositions }
                : {},
            );
            setFindingGovernanceNotes(
              refreshed.findingGovernanceNotes && typeof refreshed.findingGovernanceNotes === 'object'
                ? { ...refreshed.findingGovernanceNotes }
                : {},
            );
            setMeta((m) => ({
              documentId: refreshed.documentId || m?.documentId || '',
              title: refreshed.title || m?.title || '',
              requester: refreshed.requester || m?.requester || '',
              docLayer: refreshed.docLayer || m?.docLayer || 'sop',
              sites: normaliseSessionSites(refreshed.sites ?? m?.sites),
            }));
          }
        } catch {
          /* ignore refresh errors; save already succeeded */
        }
        setTimeout(() => setSaveStatus(null), 2500);
      }
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }

  const analyseBackUrl = trackingId
    ? `${base}/analyse/overview?trackingId=${encodeURIComponent(trackingId)}`
    : `${base}/analyse/overview`;

  if (!trackingId && !loading) {
    return (
      <div className="governance-summary-page">
        <p className="governance-summary-error">{error || 'Missing session.'}</p>
        <Link to={`${base}/configure`} className="doc-btn">← Back to configure</Link>
      </div>
    );
  }

  return (
    <div className="governance-summary-page meatspec-main-content">
      <div className="doc-header doc-header-outside">
        <div>
          <h2>Governance summary & sign-off</h2>
          <p className="doc-subtitle">
            Review accept / edit / ignore responses for every finding and record formal sign-off for this analysis session.
          </p>
        </div>
        <div className="doc-actions">
          <button type="button" className="doc-btn" onClick={() => navigate(-1)}>← Back</button>
          <Link to={analyseBackUrl} className="doc-btn">Open Analyse</Link>
        </div>
      </div>

      {loading && <p className="governance-summary-loading">Loading session…</p>}
      {error && !loading && <div className="governance-summary-error">{error}</div>}

      {!loading && result && meta && (
        <>
          <section className="governance-summary-meta" aria-label="Session scope">
            <div><span className="governance-summary-label">Document</span> {meta.documentId || '—'}{meta.title && meta.title !== meta.documentId ? ` — ${meta.title}` : ''}</div>
            <div><span className="governance-summary-label">Layer</span> {meta.docLayer}</div>
            <div><span className="governance-summary-label">Session</span> <code>{trackingId}</code></div>
          </section>

          <section className="governance-summary-signoff" aria-labelledby="gov-signoff-h">
            <h3 id="gov-signoff-h">Human sign-off</h3>
            <div className="governance-summary-field">
              <label htmlFor="gov-so-user">Reviewer (name)</label>
              <input id="gov-so-user" value={signOffUser} onChange={(e) => setSignOffUser(e.target.value)} placeholder="Name or role" />
            </div>
            <div className="governance-summary-field wide">
              <label htmlFor="gov-so-stmt">Confirmation</label>
              <textarea id="gov-so-stmt" rows={3} value={signOffStatement} onChange={(e) => setSignOffStatement(e.target.value)} placeholder="e.g. Reviewed for release against internal checklist" />
            </div>
            <div className="governance-summary-signoff-row">
              {signOffAt ? (
                <span className="governance-summary-signed">Signed off: {new Date(signOffAt).toLocaleString()}</span>
              ) : (
                <span className="governance-summary-muted">No timestamp recorded yet.</span>
              )}
              <button type="button" className="doc-btn" onClick={() => setSignOffAt(new Date().toISOString())}>Record sign-off now</button>
            </div>
          </section>

          <section className="governance-summary-table-section" aria-labelledby="gov-disp-h">
            <h3 id="gov-disp-h">Finding responses</h3>
            <p className="governance-summary-lead">Set Accept, Edit, or Ignore per finding and optional governance notes. Same IDs as on the Analyse step.</p>
            {governanceRows.length === 0 ? (
              <p className="governance-summary-muted">No findings in this session.</p>
            ) : (
              <div className="governance-summary-table-wrap">
                <table className="governance-summary-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Excerpt</th>
                      <th>Response</th>
                      <th>Governance note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {governanceRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.agent}</td>
                        <td className="governance-summary-excerpt">{row.excerpt || '—'}</td>
                        <td>
                          <select
                            className="governance-summary-disp-select"
                            value={typeof findingDispositions[row.id] === 'string' ? findingDispositions[row.id] : ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setFindingDispositions((prev) => {
                                const next = { ...prev, [row.id]: v };
                                if (!v) delete next[row.id];
                                return next;
                              });
                            }}
                          >
                            {FINDING_RESPONSE_OPTIONS.map((opt) => (
                              <option key={opt.value || 'u'} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="governance-summary-note-cell">
                          <textarea
                            className="governance-summary-note-input"
                            rows={2}
                            value={findingGovernanceNotes[row.id] || ''}
                            onChange={(e) => {
                              const t = e.target.value;
                              setFindingGovernanceNotes((prev) => {
                                const next = { ...prev, [row.id]: t };
                                if (!String(t || '').trim()) delete next[row.id];
                                return next;
                              });
                            }}
                            placeholder="Optional — appears in audit pack on this row"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="governance-summary-actions">
            <button type="button" className="doc-btn primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed — retry' : 'Save governance'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
