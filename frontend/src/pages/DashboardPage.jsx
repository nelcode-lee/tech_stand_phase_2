import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  FileSearch,
  FilePlus2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  FileText,
  Activity,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { useAnalysis } from '../context/AnalysisContext';
import { addInteractionLog, listDocuments, listAnalysisSessions } from '../api';
import { computeRiskMetrics } from '../utils/riskMetrics';
import './DashboardPage.css';

const SEVERITY_CLASS = { critical: 'alert-critical', high: 'alert-high', medium: 'alert-medium', low: 'alert-low' };

const DISMISSED_ALERTS_KEY = 'tech-standards-dismissed-alerts';
function loadDismissedAlerts() {
  try {
    const raw = localStorage.getItem(DISMISSED_ALERTS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}
function saveDismissedAlerts(set) {
  try {
    localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify([...set]));
  } catch (_) { /* ignore */ }
}

// Map agent run-names from pipeline to display labels
const AGENT_DISPLAY = {
  risk:        'Risk-Assessor',
  cleansing:   'Cleansor',
  conflict:    'Conflictor',
  specifying:  'Specifier',
  terminology: 'Terminator',
  validation:  'Validator',
  formatting:  'Formatter',
  sequencing:  'Sequencer',
};

function sessionRiskMetrics(session) {
  if (!session) return null;
  const rm = session.riskMetrics ?? session.risk_metrics;
  if (rm && typeof rm === 'object') return rm;
  if (session.result) return computeRiskMetrics(session.result);
  return null;
}

function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)  return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

function sessionTimestamp(session) {
  const value = session?.completedAt || session?.completed_at || session?.analysis_date || 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sessionDocumentKey(session) {
  const key = String(
    session?.documentId ||
    session?.document_id ||
    session?.title ||
    ''
  ).trim().toLowerCase();
  return key || String(session?.trackingId || session?.tracking_id || '').trim().toLowerCase();
}

/** True if session document_id matches a row in Library (exact or same base id, e.g. FSP003 vs FSP003-VEHICLE-…). */
function sessionDocMatchesLibrary(sessionDocId, libraryDocs) {
  if (!sessionDocId || !libraryDocs?.length) return false;
  const req = String(sessionDocId).trim();
  if (!req) return false;
  const upperReq = req.toUpperCase();
  for (const d of libraryDocs) {
    const lid = String(d.document_id || '').trim();
    if (!lid) continue;
    const chunk = lid.toUpperCase();
    if (upperReq === chunk) return true;
    if (chunk.startsWith(upperReq) && (chunk.length === upperReq.length || '-_: '.includes(chunk[upperReq.length]))) {
      return true;
    }
    const base = upperReq.split(/\s+/)[0];
    if (base && chunk === base) return true;
    if (base && chunk.startsWith(base) && (chunk.length === base.length || '-_: '.includes(chunk[base.length]))) {
      return true;
    }
  }
  return false;
}

// Line chart: sessions per day (last 7 days)
function SessionsLineChart({ data }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  // Wide viewBox so preserveAspectRatio="meet" uses full card width (narrow VB + meet = side letterboxing)
  const padding = { top: 8, right: 20, bottom: 28, left: 36 };
  const width = 640;
  const height = 100;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const maxVal = Math.max(1, ...data.map((d) => d.sessions));
  const xScale = data.length > 1 ? (i) => (i / (data.length - 1)) * innerW : () => 0;
  const points = data.map((d, i) => {
    const x = padding.left + xScale(i);
    const y = padding.top + innerH - (d.sessions / maxVal) * innerH;
    return { x, y, ...d };
  });
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const tip = hoverIdx != null && data[hoverIdx] ? data[hoverIdx] : null;
  return (
    <div className="sessions-line-chart-wrap">
      {tip && (
        <div className="sessions-chart-tooltip" role="status">
          <strong>{tip.label}</strong>
          {' — '}
          {tip.sessions} session{tip.sessions !== 1 ? 's' : ''}, {tip.findings} findings
        </div>
      )}
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="sessions-line-chart"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="sessions-line-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--yb-blue)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--yb-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${pathD} L ${points[points.length - 1]?.x ?? 0} ${padding.top + innerH} L ${padding.left} ${padding.top + innerH} Z`}
          fill="url(#sessions-line-gradient)"
        />
        <path d={pathD} fill="none" stroke="var(--yb-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hoverIdx === i ? 6 : 4}
              fill="var(--yb-blue)"
              className="chart-dot"
              style={{ transition: 'r 0.15s ease' }}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r="14"
              fill="transparent"
              className="chart-dot-hit"
              onMouseEnter={() => setHoverIdx(i)}
            />
          </g>
        ))}
        {data.map((d, i) => (
          <text
            key={d.dateKey}
            x={padding.left + xScale(i)}
            y={height - 6}
            textAnchor="middle"
            className="chart-axis-label"
          >
            {d.label.split(' ')[0]}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setWorkflowMode, setConfig, sessionLog, reloadSessionLog, removeSessionFromLog, selectedSite } = useAnalysis();

  const [backendDocs, setBackendDocs] = useState([]);
  const [backendSessions, setBackendSessions] = useState([]);
  const [docsError, setDocsError] = useState(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [dismissedAlerts, setDismissedAlerts] = useState(loadDismissedAlerts);

  async function fetchDocs() {
    setLoadingDocs(true);
    try {
      const data = await listDocuments();
      setBackendDocs(data || []);
      setDocsError(null);
    } catch (err) {
      setDocsError(err?.message || 'Could not load document library');
      // Keep prior backendDocs so KPI "Docs in Store" isn’t wiped on transient errors
    } finally {
      setLoadingDocs(false);
    }
  }

  async function fetchSessions() {
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      const data = await listAnalysisSessions(50);
      setBackendSessions(data || []);
    } catch (err) {
      setSessionsError(err.message || 'Could not load sessions');
    } finally {
      setLoadingSessions(false);
    }
  }

  // Refetch only when navigating to dashboard (not on every context change)
  useEffect(() => {
    if (location.pathname !== '/dashboard') return;
    if (reloadSessionLog) reloadSessionLog();
    fetchDocs();
    fetchSessions();
  }, [location.pathname, reloadSessionLog]);

  // Refetch when tab becomes visible, with debounce to avoid rapid successive fetches
  useEffect(() => {
    let timeoutId = null;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (reloadSessionLog) reloadSessionLog();
        fetchDocs();
        fetchSessions();
        timeoutId = null;
      }, 300);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [reloadSessionLog]);

  // Merge sessionLog (in-memory + persisted) with backend sessions
  const allSessions = useMemo(() => {
    const byId = {};
    let fallbackIdx = 0;
    for (const s of backendSessions) {
      const id = s.trackingId || s.tracking_id || `b-${fallbackIdx++}`;
      byId[id] = { ...s, trackingId: s.trackingId || s.tracking_id || id };
    }
    fallbackIdx = 0;
    for (const s of sessionLog) {
      const id = s.trackingId || s.tracking_id || `s-${fallbackIdx++}`;
      byId[id] = { ...s, trackingId: s.trackingId || s.tracking_id || id };
    }
    return Object.values(byId).sort(
      (a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0)
    );
  }, [sessionLog, backendSessions]);

  // Site-filtered docs (policy always; otherwise by selected site)
  const siteFilteredDocIds = useMemo(() => {
    if (selectedSite === 'all') return null; // null = no filter, all docs
    const ids = new Set();
    for (const d of backendDocs) {
      if (d.doc_layer === 'policy') ids.add(d.document_id);
      else {
        const sites = Array.isArray(d.sites) ? d.sites : (d.sites ? String(d.sites).split(/[,\s]+/).filter(Boolean) : []);
        if (sites.includes(selectedSite)) ids.add(d.document_id);
      }
    }
    return ids;
  }, [backendDocs, selectedSite]);

  const siteFilteredSessions = useMemo(() => {
    if (!siteFilteredDocIds) return allSessions;
    return allSessions.filter((s) => {
      const docId = s.documentId || s.document_id;
      return !docId || siteFilteredDocIds.has(docId);
    });
  }, [allSessions, siteFilteredDocIds]);

  // Metrics, charts, and Attention Required only count sessions whose document still exists in Library.
  // Otherwise cleared / deleted docs leave orphan rows in analysis_sessions and inflate totals.
  const sessionsForMetrics = useMemo(() => {
    if (loadingDocs) return siteFilteredSessions;
    // Library unknown — don’t treat as “empty” and zero all metrics
    if (docsError) return siteFilteredSessions;
    if (!backendDocs.length) return [];
    return siteFilteredSessions.filter((s) => {
      const docId = s.documentId || s.document_id;
      if (!docId || !String(docId).trim()) return false;
      return sessionDocMatchesLibrary(docId, backendDocs);
    });
  }, [siteFilteredSessions, backendDocs, loadingDocs, docsError]);

  const hiddenSessionCount = useMemo(() => {
    if (loadingDocs || docsError || !backendDocs.length) return 0;
    return Math.max(0, siteFilteredSessions.length - sessionsForMetrics.length);
  }, [loadingDocs, docsError, backendDocs.length, siteFilteredSessions, sessionsForMetrics]);

  // Gap-level FMEA bands (aggregated from risk_metrics / local result)
  const fmeaGapTotals = useMemo(() => {
    const counts = { low: 0, medium: 0, high: 0, critical: 0 };
    let unknown = 0;
    let hasData = false;
    for (const s of sessionsForMetrics) {
      const rm = sessionRiskMetrics(s);
      if (!rm?.gaps_by_band) continue;
      hasData = true;
      const gb = rm.gaps_by_band;
      counts.low += Number(gb.low) || 0;
      counts.medium += Number(gb.medium) || 0;
      counts.high += Number(gb.high) || 0;
      counts.critical += Number(gb.critical) || 0;
      unknown += Number(rm.gaps_unknown_band) || 0;
    }
    const sumBands = Object.values(counts).reduce((a, b) => a + b, 0);
    const total = sumBands + unknown;
    return { counts, unknown, total: total > 0 ? total : 1, hasData, sumBands };
  }, [sessionsForMetrics]);

  const repeatDocAnalyses = useMemo(() => {
    const m = new Map();
    for (const s of sessionsForMetrics) {
      const docId = s.documentId || s.document_id;
      if (!docId) continue;
      const cur = m.get(docId) || { documentId: docId, title: s.title || docId, count: 0 };
      cur.count += 1;
      if (s.title) cur.title = s.title;
      m.set(docId, cur);
    }
    return [...m.values()]
      .filter((x) => x.count > 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [sessionsForMetrics]);

  // ---- Derived KPIs ---------------------------------------------------

  const kpi = useMemo(() => {
    const totalDocs    = siteFilteredDocIds ? siteFilteredDocIds.size : backendDocs.length;
    const totalSessions= sessionsForMetrics.length;
    const openFindings = sessionsForMetrics.reduce((sum, s) => sum + (s.totalFindings || 0), 0);
    // Per-agent finding totals across site-filtered sessions
    const agentTotals = {};

    // Risk severity breakdown from session log (use latest per tracking_id)
    const riskCounts = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const s of sessionsForMetrics) {
      if (s.overallRisk && riskCounts[s.overallRisk] !== undefined) {
        riskCounts[s.overallRisk] += 1;
      }
    }

    return {
      totalDocs,
      totalSessions,
      openFindings,
      agentTotals,
      riskCounts,
      overdueReviews: 0,   // Without a review DB, leave at 0
      reviewsDue:     0,
      criticalFmeaGaps: fmeaGapTotals.counts.critical,
    };
  }, [backendDocs.length, siteFilteredDocIds, sessionsForMetrics, fmeaGapTotals]);

  // Agent breakdown: findings (flags) vs pipeline runs per agent
  const agentStats = useMemo(() => {
    const findingTotals = {};
    const runTotals = {};
    for (const s of sessionsForMetrics) {
      const findings = s.agentFindings || s.agent_findings || {};
      for (const [agent, count] of Object.entries(findings)) {
        const key = AGENT_DISPLAY[agent] || agent;
        findingTotals[key] = (findingTotals[key] || 0) + (typeof count === 'number' ? count : 0);
      }
      const runs = s.agentsRun || s.agents_run || [];
      if (Array.isArray(runs)) {
        for (const name of runs) {
          const key = AGENT_DISPLAY[name] || name;
          runTotals[key] = (runTotals[key] || 0) + 1;
        }
      }
    }
    const names = new Set([...Object.keys(findingTotals), ...Object.keys(runTotals)]);
    if (names.size === 0) return [];
    return [...names]
      .map((agent) => ({
        agent,
        findings: findingTotals[agent] || 0,
        runs: runTotals[agent] || 0,
      }))
      .filter((a) => a.findings > 0 || a.runs > 0)
      .sort((a, b) => b.findings - a.findings || b.runs - a.runs);
  }, [sessionsForMetrics]);

  // Activity feed — same library filter as KPIs (most recent first, max 8)
  const activity = useMemo(() =>
    sessionsForMetrics.slice(0, 8).map((s, i) => ({
      id:           s.trackingId || i,
      type:         s.workflowType || 'review',
      doc:          s.title || s.documentId || 'Unnamed',
      time:         timeAgo(s.completedAt),
      status:       'complete',
      risk:         s.overallRisk || null,
      totalFindings: s.totalFindings || 0,
    })),
  [sessionsForMetrics]);

  // Line chart: sessions per day for last 7 days (oldest to newest)
  const sessionsChartData = useMemo(() => {
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push({
        dateKey: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        sessions: 0,
        findings: 0,
      });
    }
    for (const s of sessionsForMetrics) {
      const at = s.completedAt ? new Date(s.completedAt) : null;
      if (!at) continue;
      const key = at.toISOString().slice(0, 10);
      const row = days.find((r) => r.dateKey === key);
      if (row) {
        row.sessions += 1;
        row.findings += s.totalFindings || 0;
      }
    }
    return days;
  }, [sessionsForMetrics]);

  // Health bar: count analysed docs by risk band
  const healthCounts = useMemo(() => {
    const counts = { low: 0, medium: 0, high: 0, critical: 0, unknown: 0 };
    for (const s of sessionsForMetrics) {
      if (s.overallRisk && counts[s.overallRisk] !== undefined) counts[s.overallRisk]++;
      else counts.unknown++;
    }
    return counts;
  }, [sessionsForMetrics]);

  const totalHealth = Object.values(healthCounts).reduce((a, b) => a + b, 0) || 1;

  // Alerts: site-filtered sessions with findings, excluding user-dismissed (when a site is selected, only that site's docs; "All Sites" = all)
  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const liveAlerts = useMemo(() => {
    const latestByDocument = new Map();
    for (const session of sessionsForMetrics) {
      if ((session.totalFindings || 0) <= 0) continue;
      const trackingId = session.trackingId || session.tracking_id || '';
      if (dismissedAlerts.has(trackingId)) continue;
      const docKey = sessionDocumentKey(session);
      const existing = latestByDocument.get(docKey);
      if (!existing || sessionTimestamp(session) > sessionTimestamp(existing)) {
        latestByDocument.set(docKey, session);
      }
    }

    return [...latestByDocument.values()]
      .sort((a, b) => {
        const ra = riskOrder[a.overallRisk] ?? 4;
        const rb = riskOrder[b.overallRisk] ?? 4;
        if (ra !== rb) return ra - rb;
        const timeDiff = sessionTimestamp(b) - sessionTimestamp(a);
        if (timeDiff !== 0) return timeDiff;
        return (b.totalFindings || 0) - (a.totalFindings || 0);
      })
      .slice(0, 10)
      .map(s => ({
        id:          s.trackingId,
        severity:    s.overallRisk || 'medium',
        doc:         s.title || s.documentId || 'Unnamed',
        documentId:  s.documentId,
        msg:         `${s.totalFindings} findings${s.overallRisk ? ` — risk: ${s.overallRisk}` : ''}`,
        action:      'View analysis',
        session:     s,
      }));
  }, [sessionsForMetrics, dismissedAlerts]);

  // ---- Navigation helpers ---------------------------------------------------

  function startReview(session) {
    setWorkflowMode('review');
    setConfig(c => ({
      ...c,
      requestType: 'single_document_review',
      documentId: session?.documentId || '',
      title: session?.title || '',
    }));
    // If we have a session with trackingId, go straight to results view
    if (session?.trackingId) {
      navigate(`/review/analyse?trackingId=${encodeURIComponent(session.trackingId)}`, {
        state: session?.result ? { storedResult: session.result, session } : undefined,
      });
    } else {
      navigate('/review/configure');
    }
  }

  function startCreate() {
    setWorkflowMode('create');
    setConfig(c => ({ ...c, requestType: 'new_document' }));
    navigate('/create/configure');
  }

  // ---------------------------------------------------------------------------

  return (
    <div className="dashboard">

      {sessionsError && (
        <div className="dash-error-banner">
          {sessionsError} — showing in-session data only. Check backend is running and API proxy is correct.
        </div>
      )}

      {docsError && (
        <div className="dash-error-banner" role="alert">
          {docsError} — could not refresh the Library. Session metrics are shown without library filtering until the list loads successfully.
        </div>
      )}

      {hiddenSessionCount > 0 && (
        <div className="dash-info-banner" role="status">
          <strong>{hiddenSessionCount}</strong> saved analysis session(s) refer to documents that are no longer in the Library
          (or have no document ID). Totals and Attention Required below only include sessions for documents currently in the Library.
          To remove old metrics from the database, use <strong>Settings → Clear all SOP data &amp; reset metrics</strong> (or the full library reset).
        </div>
      )}

      {/* Workflow hint — start here for new users */}
      <div className="workflow-hint" role="status">
        <span className="workflow-hint-label">Start here</span>
        <span className="workflow-hint-text">
          <strong>Review a Document</strong> — analyse and draft existing docs. <strong>Create a Document</strong> — build brand-new SOPs using ingested content, the policy layer, and project logic (principle layer in time). Then: Configure → Analyse → Draft for HITL → Submit to Library. Main actions are in the top-right on each step.
        </span>
      </div>

      {/* Page title */}
      <div className="dash-header">
        <div>
          <h1 className="dash-title">Dashboard</h1>
          <p className="dash-subtitle">
            Technical standards overview{selectedSite !== 'all' ? ` — ${selectedSite}` : ' — all sites'}
          </p>
        </div>
        <div className="dash-quick-actions">
          <button type="button" className="dash-action-btn secondary" title="Refresh document list and sessions" onClick={() => { fetchDocs(); fetchSessions(); }}>
            <RefreshCw size={14} style={(loadingDocs || loadingSessions) ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
          <button type="button" className="dash-action-btn secondary" onClick={() => navigate('/library')}>
            <FileText size={15} />
            Library
          </button>
          <button type="button" className="dash-action-btn secondary" onClick={startReview}>
            <FileSearch size={15} />
            Review Doc
          </button>
          <button type="button" className="dash-action-btn primary next-action" onClick={startCreate}>
            <FilePlus2 size={15} />
            New Doc
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="dash-kpi-row">
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-blue"><FileText size={18} /></span>
          <div>
            <span className="kpi-value">{kpi.totalDocs}</span>
            <span className="kpi-label">Docs in Store</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-red"><AlertTriangle size={18} /></span>
          <div>
            <span className="kpi-value">{kpi.criticalFmeaGaps}</span>
            <span className="kpi-label">Critical FMEA gaps</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-amber"><Clock size={18} /></span>
          <div>
            <span className="kpi-value">{kpi.reviewsDue}</span>
            <span className="kpi-label">Reviews Due</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-gold"><ShieldAlert size={18} /></span>
          <div>
            <span className="kpi-value">{kpi.openFindings}</span>
            <span className="kpi-label">Total Findings</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-green"><CheckCircle2 size={18} /></span>
          <div>
            <span className="kpi-value">
              {sessionsForMetrics.filter(s => !s.overallRisk || s.overallRisk === 'low').length}
            </span>
            <span className="kpi-label">Low-Risk Sessions</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-blue"><Activity size={18} /></span>
          <div>
            <span className="kpi-value">{kpi.totalSessions}</span>
            <span className="kpi-label">Sessions</span>
          </div>
        </div>
      </div>

      <div className="dash-grid">

        {/* Alerts — real-time from analysis sessions */}
        <section className="dash-card dash-alerts">
          <h2 className="dash-card-title">
            <AlertTriangle size={15} />
            Attention Required
            {selectedSite !== 'all' && (
              <span className="dash-card-title-context"> — {selectedSite}</span>
            )}
          </h2>
          {liveAlerts.length === 0 ? (
            <p className="dash-empty">No alerts. Run an analysis — sessions with medium, high, or critical risk will appear here.</p>
          ) : (
            <div className="alert-list">
              {liveAlerts.map(a => (
                <div key={a.id} className={`dash-alert ${SEVERITY_CLASS[a.severity] || 'alert-medium'}`}>
                  <div className="dash-alert-body">
                    <span className="dash-alert-doc">{a.doc}</span>
                    <span className="dash-alert-msg">{a.msg}</span>
                  </div>
                  <div className="dash-alert-actions">
                    <button type="button" className="dash-alert-action" onClick={() => startReview(a.session || null)}>
                      {a.action}
                    </button>
                    <button type="button" className="dash-alert-action dash-alert-delete" onClick={() => {
                      removeSessionFromLog(a.id);
                      setDismissedAlerts(prev => {
                        const next = new Set(prev);
                        next.add(a.id);
                        saveDismissedAlerts(next);
                        return next;
                      });
                      addInteractionLog({
                        user_name: '',
                        action_type: 'delete_alert',
                        route: '/dashboard',
                        workflow_mode: '',
                        document_id: a.documentId || '',
                        tracking_id: a.id || '',
                        doc_layer: a.session?.docLayer || '',
                        metadata: {
                          title: a.doc || '',
                          severity: a.severity || '',
                        },
                      }).catch(() => {});
                    }} title="Remove from Attention Required">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent activity — line graph */}
        <section className="dash-card dash-activity">
          <h2 className="dash-card-title">
            <Activity size={15} />
            Recent Analysis Sessions
          </h2>
          {sessionsChartData.every((d) => d.sessions === 0) ? (
            <p className="dash-empty">No analysis sessions in the last 7 days. Run an analysis to see the trend.</p>
          ) : (
            <div className="dash-sessions-chart">
              <SessionsLineChart data={sessionsChartData} />
              <ul className="activity-list activity-list-compact">
                {activity.slice(0, 4).map(item => (
                  <li key={item.id} className="activity-item">
                    <span className={`activity-type-dot type-${item.type}`} />
                    <span className="activity-doc">{item.doc}</span>
                    <span className="activity-meta">{item.time}</span>
                    {item.totalFindings > 0 && <span className="activity-findings">{item.totalFindings} findings</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Agent findings vs pipeline runs */}
        <section className="dash-card dash-agents">
          <h2 className="dash-card-title">
            <TrendingUp size={15} />
            Agents — findings &amp; runs
          </h2>
          <p className="dash-chart-hint">Findings = flags raised per agent. Runs = times that agent executed in a session.</p>
          {agentStats.length === 0 ? (
            <p className="dash-empty">Run an analysis to see per-agent activity.</p>
          ) : (
            <div className="agent-stat-list">
              <div className="agent-stat-row agent-stat-header">
                <span className="agent-stat-name">Agent</span>
                <span className="agent-stat-col-label">Findings</span>
                <span className="agent-stat-col-label agent-stat-col-runs">Runs</span>
              </div>
              {agentStats.map((a) => {
                const maxF = Math.max(1, ...agentStats.map((x) => x.findings));
                const maxR = Math.max(1, ...agentStats.map((x) => x.runs));
                const pctF = Math.round((a.findings / maxF) * 100);
                const pctR = Math.round((a.runs / maxR) * 100);
                return (
                  <div key={a.agent} className="agent-stat-row agent-stat-row-dual">
                    <span className="agent-stat-name" title={a.agent}>{a.agent}</span>
                    <div className="agent-stat-bar-cell">
                      <div className="agent-stat-bar-wrap" title={`${a.findings} findings`}>
                        <div className="agent-stat-bar agent-stat-bar-findings" style={{ width: `${pctF}%` }} />
                      </div>
                      <span className="agent-stat-count">{a.findings}</span>
                    </div>
                    <div className="agent-stat-bar-cell agent-stat-runs-cell">
                      <div className="agent-stat-bar-wrap agent-stat-bar-wrap-runs" title={`${a.runs} runs`}>
                        <div className="agent-stat-bar agent-stat-bar-runs" style={{ width: `${pctR}%` }} />
                      </div>
                      <span className="agent-stat-count">{a.runs}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Document health + gap-level FMEA */}
        <section className="dash-card dash-health">
          <h2 className="dash-card-title">
            <FileText size={15} />
            Risk profile &amp; FMEA gaps
          </h2>
          {sessionsForMetrics.length === 0 ? (
            <p className="dash-empty">
              {backendDocs.length === 0 && !loadingDocs
                ? 'No documents in the Library and no matching sessions. Ingest a document and run an analysis.'
                : 'No analysis sessions for documents currently in the Library. Run an analysis from Review a Document.'}
            </p>
          ) : (
            <>
              <h3 className="dash-health-subtitle">Sessions by overall document risk</h3>
              <p className="dash-chart-hint">One count per analysis session (document-level worst band).</p>
              <div className="health-legend">
                <span className="legend-dot legend-current" /> Low ({healthCounts.low})
                <span className="legend-dot legend-due" /> Medium ({healthCounts.medium})
                <span className="legend-dot legend-overdue" /> High ({healthCounts.high})
                <span className="legend-dot" style={{ background: '#7f0000' }} /> Critical ({healthCounts.critical})
              </div>
              <div className="health-bar-wrap">
                {healthCounts.low > 0 && (
                  <div className="health-bar health-current" style={{ width: `${(healthCounts.low / totalHealth) * 100}%` }} title={`${healthCounts.low} low-risk sessions`} />
                )}
                {healthCounts.medium > 0 && (
                  <div className="health-bar health-due" style={{ width: `${(healthCounts.medium / totalHealth) * 100}%` }} title={`${healthCounts.medium} medium-risk sessions`} />
                )}
                {healthCounts.high > 0 && (
                  <div className="health-bar health-overdue" style={{ width: `${(healthCounts.high / totalHealth) * 100}%` }} title={`${healthCounts.high} high-risk sessions`} />
                )}
                {healthCounts.critical > 0 && (
                  <div className="health-bar" style={{ width: `${(healthCounts.critical / totalHealth) * 100}%`, background: '#7f0000' }} title={`${healthCounts.critical} critical-risk sessions`} />
                )}
              </div>
              <div className="health-counts">
                <span>{healthCounts.low} low</span>
                <span>{healthCounts.medium} medium</span>
                <span>{healthCounts.high} high</span>
                <span>{healthCounts.critical} critical</span>
              </div>

              <h3 className="dash-health-subtitle dash-health-subtitle-spaced">Risk gaps by FMEA band</h3>
              {!fmeaGapTotals.hasData ? (
                <p className="dash-chart-hint dash-fmea-missing">
                  Gap-level FMEA counts appear after analyses that store risk metrics (new runs and re-saved sessions). Local browser sessions from this device include them immediately.
                </p>
              ) : (
                <>
                  <p className="dash-chart-hint">Each risk gap is counted once (aggregated across filtered sessions).</p>
                  <div className="health-legend">
                    <span className="legend-dot legend-current" /> Low ({fmeaGapTotals.counts.low})
                    <span className="legend-dot legend-due" /> Medium ({fmeaGapTotals.counts.medium})
                    <span className="legend-dot legend-overdue" /> High ({fmeaGapTotals.counts.high})
                    <span className="legend-dot" style={{ background: '#7f0000' }} /> Critical ({fmeaGapTotals.counts.critical})
                    {fmeaGapTotals.unknown > 0 && (
                      <>
                        <span className="legend-dot legend-draft" /> Unbanded ({fmeaGapTotals.unknown})
                      </>
                    )}
                  </div>
                  <div className="health-bar-wrap">
                    {fmeaGapTotals.counts.low > 0 && (
                      <div className="health-bar health-current" style={{ width: `${(fmeaGapTotals.counts.low / fmeaGapTotals.total) * 100}%` }} title={`${fmeaGapTotals.counts.low} low-band gaps`} />
                    )}
                    {fmeaGapTotals.counts.medium > 0 && (
                      <div className="health-bar health-due" style={{ width: `${(fmeaGapTotals.counts.medium / fmeaGapTotals.total) * 100}%` }} title={`${fmeaGapTotals.counts.medium} medium-band gaps`} />
                    )}
                    {fmeaGapTotals.counts.high > 0 && (
                      <div className="health-bar health-overdue" style={{ width: `${(fmeaGapTotals.counts.high / fmeaGapTotals.total) * 100}%` }} title={`${fmeaGapTotals.counts.high} high-band gaps`} />
                    )}
                    {fmeaGapTotals.counts.critical > 0 && (
                      <div className="health-bar" style={{ width: `${(fmeaGapTotals.counts.critical / fmeaGapTotals.total) * 100}%`, background: '#7f0000' }} title={`${fmeaGapTotals.counts.critical} critical-band gaps`} />
                    )}
                    {fmeaGapTotals.unknown > 0 && (
                      <div className="health-bar health-unknown-band" style={{ width: `${(fmeaGapTotals.unknown / fmeaGapTotals.total) * 100}%` }} title={`${fmeaGapTotals.unknown} gaps without band`} />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {/* Documents analysed more than once */}
        <section className="dash-card dash-repeat-docs">
          <h2 className="dash-card-title">
            <Activity size={15} />
            Repeat analyses
          </h2>
          {repeatDocAnalyses.length === 0 ? (
            <p className="dash-empty">No document has more than one analysis in the current filter. Re-run reviews to track iteration here.</p>
          ) : (
            <ul className="repeat-doc-list">
              {repeatDocAnalyses.map((row) => (
                <li key={row.documentId} className="repeat-doc-item">
                  <span className="repeat-doc-title" title={row.title}>{row.title}</span>
                  <span className="repeat-doc-count">{row.count}×</span>
                  <button
                    type="button"
                    className="repeat-doc-action"
                    onClick={() => {
                      setWorkflowMode('review');
                      setConfig((c) => ({
                        ...c,
                        requestType: 'single_document_review',
                        documentId: row.documentId,
                        title: row.title,
                      }));
                      navigate('/review/configure');
                    }}
                  >
                    Review
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>
    </div>
  );
}
