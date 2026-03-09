import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { analyse, saveAnalysisSession, exportDraftDocx, getAnalysisSession, getDocumentContent } from '../api';
import { useAnalysis } from '../context/AnalysisContext';
import { resolveSitesForApi } from '../constants/sites';
import { Save, FileDown } from 'lucide-react';
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

// Flag count key -> section id for scroll target (metric tiles)
const FLAG_KEY_TO_SECTION_ID = {
  'risk gaps': 'agent-card-risk',
  'specifying': 'agent-card-specifying',
  'structure': 'agent-card-structure',
  'content integrity': 'agent-card-content-integrity',
  'sequencing': 'agent-card-sequencing',
  'formatting': 'agent-card-formatting',
  'compliance': 'agent-card-compliance',
  'terminology': 'agent-card-terminology',
  'conflicts': 'agent-card-conflict',
};

// Agent display name -> section id for scroll target (Proposed Solutions table)
const AGENT_SECTION_IDS = {
  'Risk': 'agent-card-risk',
  'Structure': 'agent-card-structure',
  'Content Integrity': 'agent-card-content-integrity',
  'Specifying': 'agent-card-specifying',
  'Sequencing': 'agent-card-sequencing',
  'Formatting': 'agent-card-formatting',
  'Compliance': 'agent-card-compliance',
  'Terminology': 'agent-card-terminology',
  'Conflict': 'agent-card-conflict',
};

function scrollToSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('proposed-solutions-highlight');
    setTimeout(() => el.classList.remove('proposed-solutions-highlight'), 1500);
  }
}

// Flatten all findings into a unified Proposed Solutions list
// searchText: best string to search for in original doc (excerpt > current_text > location)
function buildProposedSolutions(result) {
  const solutions = [];
  const push = (agent, current, proposal, searchText) => {
    if (proposal) solutions.push({
      agent,
      current: current || '—',
      proposal,
      sectionId: AGENT_SECTION_IDS[agent],
      searchText: searchText || current || '',
    });
  };

  (result.risk_gaps || []).forEach(g => push('Risk', [g.location, g.issue].filter(Boolean).join(' · '), g.recommendation, g.location));
  (result.structure_flags || []).forEach(f => push('Structure', [f.section, f.detail].filter(Boolean).join(' — '), f.recommendation, f.section));
  (result.content_integrity_flags || []).forEach(f => push('Content Integrity', [f.location, f.detail].filter(Boolean).join(' · ') || f.excerpt, f.recommendation, f.excerpt || f.location));
  (result.specifying_flags || []).forEach(f => push('Specifying', [f.location, f.current_text, f.issue].filter(Boolean).join(' · '), f.recommendation, f.current_text || f.location));
  (result.sequencing_flags || []).forEach(f => push('Sequencing', [f.location, f.issue, f.impact].filter(Boolean).join(' · '), f.recommendation, f.location));
  (result.formatting_flags || []).forEach(f => push('Formatting', [f.location, f.issue].filter(Boolean).join(' · '), f.recommendation, f.location));
  (result.compliance_flags || []).forEach(f => push('Compliance', [f.location, f.issue].filter(Boolean).join(' · '), f.recommendation, f.location));
  (result.terminology_flags || []).forEach(f => push('Terminology', [f.term, f.location, f.issue].filter(Boolean).join(' · '), f.recommendation, f.term || f.location));
  (result.conflicts || []).forEach(c => push('Conflict', [c.conflict_type, c.description].filter(Boolean).join(' — '), c.recommendation, c.description));

  return solutions;
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const documentIdFromUrl = searchParams.get('documentId');
  const titleFromUrl = searchParams.get('title');
  const trackingIdFromUrl = searchParams.get('trackingId');
  const storedResultFromState = location.state?.storedResult;
  const sessionFromState = location.state?.session;
  const ctx = useAnalysis();
  const result = ctx?.result ?? null;
  const setResult = ctx?.setResult ?? (() => {});
  const setConfig = ctx?.setConfig ?? (() => {});
  const config = ctx?.config ?? { mode: 'full' };
  const recordSession = ctx?.recordSession ?? (() => {});
  const workflowMode = ctx?.workflowMode ?? mode;
  const base = `/${mode}`;

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStored, setLoadingStored] = useState(!!trackingIdFromUrl);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [error, setError] = useState(null);
  const [sessionNotPersisted, setSessionNotPersisted] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [exporting, setExporting] = useState(false);
  const [documentContent, setDocumentContent] = useState(null);
  const [documentSections, setDocumentSections] = useState([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [highlightSearch, setHighlightSearch] = useState('');
  const originalDocRef = useRef(null);

  const fromIngestState = location.state?.fromIngest && location.state?.documentId;
  // Effective document: URL (from fresh ingest) overrides everything — cannot be overwritten by config/session
  const effectiveDocId = documentIdFromUrl || (location.state?.fromIngest && location.state?.documentId) || config.documentId || '';
  const effectiveTitle = titleFromUrl || (location.state?.fromIngest && location.state?.title) || config.title || config.documentId || '';

  // When arriving from Ingest (state or URL), sync config so it matches the document we're analysing
  useEffect(() => {
    const docId = documentIdFromUrl || (location.state?.fromIngest && location.state?.documentId) || '';
    const docTitle = titleFromUrl || (location.state?.fromIngest && location.state?.title) || docId;
    if (!docId) return;
    setConfig(c => ({ ...c, documentId: docId, title: docTitle }));
  }, [documentIdFromUrl, titleFromUrl, fromIngestState, location.state?.documentId, location.state?.title, setConfig]);

  // When trackingId in URL, use passed result or fetch stored session
  // Do NOT overwrite documentId when documentIdFromUrl is set (fresh ingest takes precedence)
  useEffect(() => {
    if (!trackingIdFromUrl) return;
    // Use result passed from Dashboard (sessionLog) if available — avoids 404 when not in DB
    if (storedResultFromState) {
      setResult(storedResultFromState);
      setDraftContent(storedResultFromState.draft_content || '');
      if (sessionFromState && !documentIdFromUrl) {
        const sitesArr = sessionFromState.sites
          ? (Array.isArray(sessionFromState.sites) ? sessionFromState.sites : String(sessionFromState.sites).split(',').map(s => s.trim()).filter(Boolean))
          : [];
        setConfig(c => ({
          ...c,
          documentId: sessionFromState.documentId || '',
          title: sessionFromState.title || '',
          requester: sessionFromState.requester || '',
          docLayer: sessionFromState.docLayer || 'sop',
          sites: sitesArr,
        }));
      }
      setLoadingStored(false);
      return;
    }
    setLoadingStored(true);
    getAnalysisSession(trackingIdFromUrl)
      .then(session => {
        const res = session?.result;
        if (res) {
          setResult(res);
          setDraftContent(res.draft_content || '');
        } else if (session) {
          setError('Results not stored for this session. Run a new analysis to see findings.');
        }
        if (session && !documentIdFromUrl) {
          const sitesArr = session.sites ? String(session.sites).split(',').map(s => s.trim()).filter(Boolean) : [];
          setConfig(c => ({
            ...c,
            documentId: session.documentId || '',
            title: session.title || '',
            requester: session.requester || '',
            docLayer: session.docLayer || 'sop',
            sites: sitesArr,
          }));
        }
      })
      .catch(() => setError('Could not load analysis results. The session may not be in the database — run a new analysis to see results.'))
      .finally(() => setLoadingStored(false));
  }, [trackingIdFromUrl, documentIdFromUrl, storedResultFromState, sessionFromState, setResult, setConfig]);

  // Fetch original document content for split view (cross-reference with findings)
  useEffect(() => {
    if (!result || !effectiveDocId) {
      setDocumentContent(null);
      setDocumentSections([]);
      return;
    }
    setLoadingContent(true);
    setDocumentContent(null);
    setDocumentSections([]);
    getDocumentContent(effectiveDocId)
      .then(data => {
        setDocumentContent(data?.content || null);
        setDocumentSections(Array.isArray(data?.sections) ? data.sections : []);
      })
      .catch(() => {
        setDocumentContent(null);
        setDocumentSections([]);
      })
      .finally(() => setLoadingContent(false));
  }, [result, effectiveDocId]);

  // Scroll to specific section or highlight when user clicks a finding
  useEffect(() => {
    if (!highlightSearch || !originalDocRef.current) return;
    const container = originalDocRef.current;
    const search = highlightSearch.trim();
    if (search.length < 2) return;
    const searchLower = search.toLowerCase();

    const doScroll = () => {
      // 1. Try section-based scroll: find section matching the finding
      if (documentSections.length > 0) {
        const findSection = (needle) => documentSections.findIndex(s => {
          const heading = (s.heading || '').toLowerCase();
          const content = (s.content || '').toLowerCase();
          return heading === needle || heading.includes(needle) || content.includes(needle);
        });
        let idx = findSection(searchLower);
        // "Step 3" / "Section 4" — extract number and match "3. X" or "4. X"
        if (idx < 0) {
          const numMatch = searchLower.match(/(?:step|section)\s*(\d+)/);
          if (numMatch) {
            const num = numMatch[1];
            idx = documentSections.findIndex(s => {
              const h = (s.heading || '').toLowerCase();
              return h.startsWith(num + '.') || h.startsWith(num + ' ');
            });
          }
        }
        if (idx < 0 && searchLower.length > 20) {
          const short = searchLower.slice(0, 50).trim();
          if (short.length >= 5) idx = findSection(short);
        }
        if (idx < 0 && searchLower.length > 10) {
          const firstWords = searchLower.split(/\s+/).slice(0, 3).join(' ');
          if (firstWords.length >= 3) idx = findSection(firstWords);
        }
        if (idx >= 0) {
          const target = container.querySelector(`[data-doc-section="${idx}"]`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
      }
      // 2. Fallback: scroll to first highlight in document (after DOM has rendered)
      const highlightEl = container.querySelector('.original-doc-highlight');
      if (highlightEl) highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    // Defer scroll until after React has rendered the highlights
    const t = requestAnimationFrame(() => requestAnimationFrame(doScroll));
    return () => cancelAnimationFrame(t);
  }, [highlightSearch, documentSections]);

  async function handleRun(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setSessionNotPersisted(false);
    try {
      const sitesArr = Array.isArray(config.sites) ? config.sites : (config.sites ? String(config.sites).split(/[,\s]+/).filter(Boolean) : []);
      const body = {
        tracking_id: `ui-${Date.now()}`,
        request_type: config.requestType || 'single_document_review',
        doc_layer: config.docLayer || 'sop',
        sites: resolveSitesForApi(sitesArr),
        policy_ref: config.policyRef || null,
        document_id: effectiveDocId || null,
        title: effectiveTitle || effectiveDocId || null,
        requester: config.requester || null,
        query: query || undefined,
        agents: config?.mode && config.mode !== 'full' ? config.agents : undefined,
      };
      const res = await analyse(body);
      setResult(res);
      setDraftContent(res.draft_content || '');
      recordSession(res, { ...config, documentId: effectiveDocId, title: effectiveTitle }, workflowMode);
      if (res.session_saved === false) {
        setSessionNotPersisted(true);
      }
      // Auto-save to backend so dashboard reflects metrics
      const totalFindings =
        (res.risk_gaps?.length || 0) + (res.specifying_flags?.length || 0) + (res.structure_flags?.length || 0) +
        (res.content_integrity_flags?.length || 0) + (res.sequencing_flags?.length || 0) + (res.formatting_flags?.length || 0) +
        (res.compliance_flags?.length || 0) + (res.terminology_flags?.length || 0) + (res.conflicts?.length || 0);
      const agentFindings = {};
      if (res.risk_gaps?.length) agentFindings.risk = res.risk_gaps.length;
      if (res.specifying_flags?.length) agentFindings.specifying = res.specifying_flags.length;
      if (res.structure_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + res.structure_flags.length;
      if (res.content_integrity_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + res.content_integrity_flags.length;
      if (res.sequencing_flags?.length) agentFindings.sequencing = res.sequencing_flags.length;
      if (res.formatting_flags?.length) agentFindings.formatting = res.formatting_flags.length;
      if (res.compliance_flags?.length) agentFindings.validation = res.compliance_flags.length;
      if (res.terminology_flags?.length) agentFindings.terminology = res.terminology_flags.length;
      if (res.conflicts?.length) agentFindings.conflict = res.conflicts.length;
      try {
        await saveAnalysisSession({
          tracking_id: res.tracking_id,
          document_id: effectiveDocId || '',
          title: effectiveTitle || effectiveDocId || 'Unnamed',
          doc_layer: config.docLayer || 'sop',
          sites: Array.isArray(config.sites) ? (config.sites.includes('all') ? 'All Sites' : config.sites.join(',')) : (config.sites || ''),
          overall_risk: res.overall_risk || null,
          total_findings: totalFindings,
          agents_run: res.agents_run || [],
          agent_findings: agentFindings,
        });
      } catch (_) { /* non-blocking */ }
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
  const hasDraft = isCreate && result;
  const displayDraft = draftContent || result?.draft_content || '';

  async function handleExportDocx() {
    const content = draftContent || result?.draft_content;
    if (!content) return;
    setExporting(true);
    try {
      const blob = await exportDraftDocx(content, config.documentId || 'draft');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${config.documentId || 'draft'}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const sitesDisplay = Array.isArray(config.sites)
        ? (config.sites.includes('all') ? 'All Sites' : config.sites.join(','))
        : (config.sites || '');
      const agentFindings = {};
      if (result.risk_gaps?.length) agentFindings.risk = result.risk_gaps.length;
      if (result.specifying_flags?.length) agentFindings.specifying = (agentFindings.specifying || 0) + result.specifying_flags.length;
      if (result.structure_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + result.structure_flags.length;
      if (result.content_integrity_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + result.content_integrity_flags.length;
      if (result.sequencing_flags?.length) agentFindings.sequencing = result.sequencing_flags.length;
      if (result.formatting_flags?.length) agentFindings.formatting = result.formatting_flags.length;
      if (result.compliance_flags?.length) agentFindings.validation = result.compliance_flags.length;
      if (result.terminology_flags?.length) agentFindings.terminology = result.terminology_flags.length;
      if (result.conflicts?.length) agentFindings.conflict = result.conflicts.length;

      const res = await saveAnalysisSession({
        tracking_id: result.tracking_id,
        document_id: config.documentId || '',
        title: config.title || config.documentId || 'Unnamed',
        requester: config.requester || '',
        doc_layer: config.docLayer || 'sop',
        sites: sitesDisplay,
        overall_risk: result.overall_risk || null,
        total_findings: totalFindings,
        agents_run: result.agents_run || [],
        agent_findings: agentFindings,
      });
      setSaveStatus(res?.ok !== false ? 'saved' : 'error');
      if (res?.ok !== false) setTimeout(() => setSaveStatus(null), 2500);
    } catch (err) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="analyse-page-layout">
      <div className="doc-header doc-header-outside">
        <div>
          <h2>{isCreate ? 'Analyse & Draft' : 'Review Findings'}</h2>
          <p className="doc-subtitle">
            {(effectiveDocId || effectiveTitle) ? `${[effectiveDocId, effectiveTitle].filter(Boolean).join(' — ')} · ` : ''}
            Agent pipeline · {config.docLayer || 'sop'}
            {config.sites?.length ? ` · ${Array.isArray(config.sites) && config.sites.includes('all') ? 'All Sites' : (Array.isArray(config.sites) ? config.sites.join(', ') : config.sites)}` : ''}
            {config.requester ? ` · Requester: ${config.requester}` : ''}
          </p>
        </div>
        <div className="doc-actions">
          <button type="button" className="doc-btn" onClick={() => navigate(`${base}/ingest`)}>← Back</button>
          <button type="submit" form="analyse-form" disabled={loading} className="doc-btn primary">
            {loading ? 'Analysing…' : 'Run Analysis'}
          </button>
        </div>
      </div>

      <div className="analyse-page meatspec-main-content">
      <form id="analyse-form" onSubmit={handleRun} className="analyse-form">
        {!effectiveDocId && (
          <div className="analyse-no-doc-warning">
            No document selected — analysis will use unfiltered chunks from all documents. Go to Ingest and upload a document, or use Configure to set a document ID.
          </div>
        )}
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

      {loadingStored && (
        <div className="analyse-loading-overlay">
          <div className="analyse-loading-spinner" />
          <p>Loading analysis results…</p>
        </div>
      )}

      {loading && (
        <div className="analyse-loading-overlay">
          <div className="analyse-loading-spinner" />
          <p>Running analysis — this may take 1–2 minutes…</p>
        </div>
      )}

      {error && <div className="analyse-error">{error}</div>}

      {sessionNotPersisted && (
        <div className="analyse-warning">
          Findings were not saved to the dashboard database. The session will appear in the dashboard for now, but full results may not load when viewing later. Set SUPABASE_DB_URL in the backend to persist sessions.
        </div>
      )}

      {result && (
        <div className="analyse-results-wrapper">
          {/* Flag counts bar — full width across top */}
          {flagCounts && (
            <div className="flag-metrics-top">
              <div className="metrics-grid">
                {Object.entries(flagCounts).map(([key, count]) => {
                  const sectionId = FLAG_KEY_TO_SECTION_ID[key];
                  const isClickable = count > 0 && sectionId;
                  return (
                    <div
                      key={key}
                      className={`metric${count === 0 ? ' metric-zero' : ''}${isClickable ? ' metric-clickable' : ''}`}
                      onClick={isClickable ? () => scrollToSection(sectionId) : undefined}
                      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollToSection(sectionId); } } : undefined}
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      title={isClickable ? `Jump to ${key}` : undefined}
                    >
                      <span className="metric-value">{count}</span>
                      <span className="metric-label">{key}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flag-metrics-total">{totalFindings} total findings</div>
            </div>
          )}

          {/* Doc and findings side by side */}
          <div className={effectiveDocId ? 'analyse-split-view' : 'analyse-single-column'}>
            {/* Left panel: Original document */}
            {effectiveDocId && (
              <div className="analyse-split-left" ref={originalDocRef}>
                <h3 className="split-panel-title">Original Document</h3>
                {loadingContent && <p className="split-loading">Loading document…</p>}
                {!loadingContent && !documentContent && <p className="split-unavailable">Document content not available. Re-ingest to enable cross-reference.</p>}
              {!loadingContent && documentContent && (
                <OriginalDocumentPanel
                  content={documentContent}
                  sections={documentSections}
                  highlightSearch={highlightSearch}
                />
              )}
              </div>
            )}
            {/* Right panel: Findings */}
            <div className={effectiveDocId ? 'analyse-split-right' : ''}>
          {/* Draft content — Create mode only */}
          {hasDraft && (
            <section className="draft-section">
              <div className="draft-header">
                <h3>Draft Content</h3>
                <div className="draft-actions">
                  <button
                    type="button"
                    className="draft-export-btn"
                    onClick={handleExportDocx}
                    disabled={exporting || !displayDraft}
                  >
                    <FileDown size={16} />
                    {exporting ? 'Exporting…' : 'Export DOCX'}
                  </button>
                </div>
              </div>
              <textarea
                className="draft-textarea"
                value={displayDraft}
                onChange={e => setDraftContent(e.target.value)}
                placeholder="Draft content will appear here after analysis…"
                spellCheck="true"
              />
            </section>
          )}

        <section className="analyse-results docuguard-review">
          <div className="review-header">
            <h3>Findings</h3>
            <div className="resolved-counter">0 of {totalFindings} resolved</div>
            <div className="review-header-actions">
              <button
                type="button"
                className={`save-btn ${saveStatus === 'saved' ? 'saved' : ''} ${saveStatus === 'error' ? 'error' : ''}`}
                onClick={handleSave}
                disabled={saving}
                title="Save changes"
              >
                <Save size={14} />
                {saving ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed' : 'Save'}
              </button>
              <button type="button" className="resolve-btn" onClick={() => navigate(`${base}/finalize`)}>
                {isCreate ? 'Continue to Draft →' : 'Resolve & Close →'}
              </button>
            </div>
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

          {/* Glossary candidates — vague terminology: route to HITL, add to glossary */}
          {result.glossary_candidates?.length > 0 && (
            <div className="glossary-candidates-banner">
              <h4>Add to glossary</h4>
              <p className="glossary-candidates-desc">Vague terminology detected — route to HITL. Consider adding these terms to the standard glossary:</p>
              <ul className="glossary-candidates-list">
                {result.glossary_candidates.map((c, i) => (
                  <li key={i}>
                    <strong>{c.term}</strong>
                    {c.recommendation && <span> — {c.recommendation}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Agent cards — each wrapped with id for Proposed Solutions scroll target */}
          <div className="agent-cards">
            {result.risk_gaps?.length > 0 && (
              <div id="agent-card-risk"><RiskGapCard items={result.risk_gaps} onFindingClick={effectiveDocId ? setHighlightSearch : undefined} /></div>
            )}
            {result.structure_flags?.length > 0 && (
              <div id="agent-card-structure"><StructureCard items={result.structure_flags} onFindingClick={effectiveDocId ? setHighlightSearch : undefined} /></div>
            )}
            {result.content_integrity_flags?.length > 0 && (
              <div id="agent-card-content-integrity"><ContentIntegrityCard items={result.content_integrity_flags} onFindingClick={effectiveDocId ? setHighlightSearch : undefined} /></div>
            )}
            {result.specifying_flags?.length > 0 && (
              <div id="agent-card-specifying"><AgentCard title="Specifying" items={result.specifying_flags}
                keys={['location', 'current_text', 'issue', 'recommendation']} searchTextKey="current_text" onFindingClick={effectiveDocId ? setHighlightSearch : undefined} /></div>
            )}
            {result.sequencing_flags?.length > 0 && (
              <div id="agent-card-sequencing"><AgentCard title="Sequencing" items={result.sequencing_flags}
                keys={['location', 'issue', 'impact', 'recommendation']} searchTextKey="location" onFindingClick={effectiveDocId ? setHighlightSearch : undefined} /></div>
            )}
            {result.formatting_flags?.length > 0 && (
              <div id="agent-card-formatting"><AgentCard title="Formatting" items={result.formatting_flags}
                keys={['location', 'issue', 'recommendation']} searchTextKey="location" onFindingClick={effectiveDocId ? setHighlightSearch : undefined} /></div>
            )}
            {result.compliance_flags?.length > 0 && (
              <div id="agent-card-compliance"><AgentCard title="Compliance" items={result.compliance_flags}
                keys={['location', 'issue', 'requirement_reference', 'recommendation']} searchTextKey="location" onFindingClick={effectiveDocId ? setHighlightSearch : undefined} /></div>
            )}
            {result.terminology_flags?.length > 0 && (
              <div id="agent-card-terminology"><AgentCard title="Terminology" items={result.terminology_flags}
                keys={['term', 'location', 'issue', 'recommendation']} searchTextKey="term" onFindingClick={effectiveDocId ? setHighlightSearch : undefined} /></div>
            )}
            {result.conflicts?.length > 0 && (
              <div id="agent-card-conflict"><AgentCard title="Conflicts" items={result.conflicts}
                keys={['conflict_type', 'severity', 'description', 'recommendation']} searchTextKey="description" onFindingClick={effectiveDocId ? setHighlightSearch : undefined} /></div>
            )}
          </div>

          {/* Proposed Solutions summary — at bottom */}
          {totalFindings > 0 && (
            <ProposedSolutionsSummary
              solutions={buildProposedSolutions(result)}
              onFindingClick={effectiveDocId ? (searchText) => setHighlightSearch(searchText || '') : undefined}
            />
          )}
        </section>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Original document panel — highlights only the selected finding (one at a time)
// ---------------------------------------------------------------------------
function OriginalDocumentPanel({ content, sections = [], highlightSearch }) {
  if (!content) return null;
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function highlightInText(text) {
    if (!highlightSearch || highlightSearch.trim().length < 2) return text;
    const search = highlightSearch.trim();
    try {
      const re = new RegExp(`(${escapeRegex(search)})`, 'gi');
      const parts = text.split(re);
      if (parts.length <= 1) return text;
      return parts.map((part, j) =>
        j % 2 === 1 ? (
          <mark key={j} className="original-doc-highlight" data-highlight>{part}</mark>
        ) : part
      );
    } catch (_) {
      return text;
    }
  }

  // Render by sections when available — enables scroll-to-section
  if (sections.length > 0) {
    return (
      <div className="original-document-panel">
        {sections.map((sec, i) => (
          <section
            key={i}
            className="original-doc-section"
            data-doc-section={i}
          >
            <h4 className="original-doc-section-heading">{sec.heading}</h4>
            <div className="original-doc-section-body">
              {sec.content ? (
                sec.content.split(/\n\n+/).filter(Boolean).map((para, j) => (
                  <p key={j} className="original-doc-para">
                    {highlightInText(para)}
                  </p>
                ))
              ) : null}
            </div>
          </section>
        ))}
      </div>
    );
  }

  // Fallback: paragraphs only (no sections)
  const paragraphs = content.split(/\n\n+/).filter(Boolean);
  return (
    <div className="original-document-panel">
      {paragraphs.map((para, i) => (
        <p key={i} className="original-doc-para">
          {highlightInText(para)}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposed Solutions summary — consolidated view of all recommendations
// ---------------------------------------------------------------------------
function ProposedSolutionsSummary({ solutions, onFindingClick }) {
  const [expanded, setExpanded] = useState(true);
  if (!solutions?.length) return null;

  function handleRowClick(row) {
    if (row.sectionId) scrollToSection(row.sectionId);
    if (onFindingClick && row.searchText) onFindingClick(row.searchText);
  }

  return (
    <div className="proposed-solutions-summary">
      <button type="button" className="proposed-solutions-header" onClick={() => setExpanded(!expanded)}>
        <h4>Proposed Solutions</h4>
        <span className="proposed-solutions-count">{solutions.length} recommendation{solutions.length !== 1 ? 's' : ''}</span>
        <span className="proposed-solutions-toggle">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="proposed-solutions-table-wrap">
          <table className="proposed-solutions-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Current / Issue</th>
                <th>Proposed solution</th>
              </tr>
            </thead>
            <tbody>
              {solutions.map((row, i) => (
                <tr
                  key={i}
                  className="proposed-solutions-row-clickable"
                  onClick={() => handleRowClick(row)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(row); } }}
                  title={onFindingClick ? 'Click to jump to finding and highlight in original' : 'Click to jump to this finding'}
                >
                  <td className="proposed-agent">{row.agent}</td>
                  <td className="proposed-current">{row.current}</td>
                  <td className="proposed-proposal">{row.proposal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk Gap card — sorted by FMEA score, shows score bar inline
// ---------------------------------------------------------------------------
function RiskGapCard({ items, onFindingClick }) {
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
          <li
            key={i}
            className={`agent-item ${onFindingClick && gap.location ? 'agent-item-clickable' : ''}`}
            onClick={onFindingClick && gap.location ? () => onFindingClick(gap.location) : undefined}
            onKeyDown={onFindingClick && gap.location ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFindingClick(gap.location); } } : undefined}
            role={onFindingClick && gap.location ? 'button' : undefined}
            tabIndex={onFindingClick && gap.location ? 0 : undefined}
            title={onFindingClick && gap.location ? 'Click to highlight in original document' : undefined}
          >
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
function StructureCard({ items, onFindingClick }) {
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
          <li
            key={i}
            className={`agent-item structure-item ${onFindingClick && flag.section ? 'agent-item-clickable' : ''}`}
            onClick={onFindingClick && flag.section ? () => onFindingClick(flag.section) : undefined}
            onKeyDown={onFindingClick && flag.section ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFindingClick(flag.section); } } : undefined}
            role={onFindingClick && flag.section ? 'button' : undefined}
            tabIndex={onFindingClick && flag.section ? 0 : undefined}
            title={onFindingClick && flag.section ? 'Click to highlight in original document' : undefined}
          >
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
function ContentIntegrityCard({ items, onFindingClick }) {
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
              <IntegrityGroup key={ftype} ftype={ftype} items={group} onFindingClick={onFindingClick} />
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

function IntegrityGroup({ ftype, items, onFindingClick }) {
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
        {display.map((flag, i) => {
          const searchText = flag.excerpt || flag.location;
          return (
          <li
            key={i}
            className={`agent-item ${onFindingClick && searchText ? 'agent-item-clickable' : ''}`}
            onClick={onFindingClick && searchText ? () => onFindingClick(searchText) : undefined}
            onKeyDown={onFindingClick && searchText ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFindingClick(searchText); } } : undefined}
            role={onFindingClick && searchText ? 'button' : undefined}
            tabIndex={onFindingClick && searchText ? 0 : undefined}
            title={onFindingClick && searchText ? 'Click to highlight in original document' : undefined}
          >
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
          );
        })}
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
// Generic agent card — supports click-to-highlight via searchTextKey
// ---------------------------------------------------------------------------
function AgentCard({ title, items, keys, searchTextKey = 'location', onFindingClick }) {
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
        {displayItems.map((item, i) => {
          const searchText = searchTextKey && item[searchTextKey] ? String(item[searchTextKey]).slice(0, 150) : null;
          return (
          <li
            key={i}
            className={`agent-item ${onFindingClick && searchText ? 'agent-item-clickable' : ''}`}
            onClick={onFindingClick && searchText ? () => onFindingClick(searchText) : undefined}
            onKeyDown={onFindingClick && searchText ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFindingClick(searchText); } } : undefined}
            role={onFindingClick && searchText ? 'button' : undefined}
            tabIndex={onFindingClick && searchText ? 0 : undefined}
            title={onFindingClick && searchText ? 'Click to highlight in original document' : undefined}
          >
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
          );
        })}
      </ul>
      {hasMore && !expanded && (
        <button type="button" className="show-more" onClick={() => setExpanded(true)}>
          Show {items.length - 3} more
        </button>
      )}
    </div>
  );
}
