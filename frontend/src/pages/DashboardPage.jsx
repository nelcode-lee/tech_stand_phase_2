import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  FileSearch,
  FilePlus2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
  FileText,
  Activity,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { useAnalysis } from '../context/AnalysisContext';
import { listDocuments, listAnalysisSessions } from '../api';
import './DashboardPage.css';

const SEVERITY_CLASS = { critical: 'alert-critical', high: 'alert-high', medium: 'alert-medium', low: 'alert-low' };

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

// Map API result keys → agent names
const FINDING_KEYS = {
  risk_gaps:              'risk',
  content_integrity_flags:'cleansing',
  structure_flags:        'cleansing',
  conflicts:              'conflict',
  specifying_flags:       'specifying',
  terminology_flags:      'terminology',
  compliance_flags:       'validation',
  formatting_flags:       'formatting',
  sequencing_flags:       'sequencing',
};

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

// Line chart: sessions per day (last 7 days)
function SessionsLineChart({ data }) {
  const padding = { top: 8, right: 8, bottom: 28, left: 28 };
  const width = 280;
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
  return (
    <div className="sessions-line-chart-wrap">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="sessions-line-chart">
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
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="var(--yb-blue)" className="chart-dot" />
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
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);

  async function fetchDocs() {
    setLoadingDocs(true);
    try {
      const data = await listDocuments();
      setBackendDocs(data || []);
    } catch {
      // Silently ignore; dashboard should still render with session data
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

  // ---- Derived KPIs ---------------------------------------------------

  const kpi = useMemo(() => {
    const totalDocs    = siteFilteredDocIds ? siteFilteredDocIds.size : backendDocs.length;
    const totalSessions= siteFilteredSessions.length;
    const openFindings = siteFilteredSessions.reduce((sum, s) => sum + (s.totalFindings || 0), 0);
    const correctionsImplemented = siteFilteredSessions.reduce((sum, s) => sum + (s.correctionsImplemented ?? 0), 0);

    // Per-agent finding totals across site-filtered sessions
    const agentTotals = {};

    // Risk severity breakdown from session log (use latest per tracking_id)
    const riskCounts = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const s of siteFilteredSessions) {
      if (s.overallRisk && riskCounts[s.overallRisk] !== undefined) {
        riskCounts[s.overallRisk] += 1;
      }
    }

    return {
      totalDocs,
      totalSessions,
      openFindings,
      correctionsImplemented,
      agentTotals,
      riskCounts,
      overdueReviews: 0,   // Without a review DB, leave at 0
      reviewsDue:     0,
    };
  }, [backendDocs.length, siteFilteredDocIds, siteFilteredSessions]);

  // Agent breakdown: per-agent finding totals from site-filtered sessions
  const agentStats = useMemo(() => {
    const totals = {};
    for (const s of siteFilteredSessions) {
      const findings = s.agentFindings || {};
      for (const [agent, count] of Object.entries(findings)) {
        const key = AGENT_DISPLAY[agent] || agent;
        totals[key] = (totals[key] || 0) + (typeof count === 'number' ? count : 0);
      }
    }
    if (Object.keys(totals).length === 0) return [];
    return Object.entries(totals)
      .map(([agent, findings]) => ({ agent, findings }))
      .filter(a => a.findings > 0)
      .sort((a, b) => b.findings - a.findings);
  }, [siteFilteredSessions]);

  // Activity feed from session log (most recent first, max 8)
  const activity = useMemo(() =>
    allSessions.slice(0, 8).map((s, i) => ({
      id:           s.trackingId || i,
      type:         s.workflowType || 'review',
      doc:          s.title || s.documentId || 'Unnamed',
      time:         timeAgo(s.completedAt),
      status:       'complete',
      risk:         s.overallRisk || null,
      totalFindings: s.totalFindings || 0,
    })),
  [allSessions]);

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
    for (const s of siteFilteredSessions) {
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
  }, [siteFilteredSessions]);

  // Health bar: count analysed docs by risk band
  const healthCounts = useMemo(() => {
    const counts = { low: 0, medium: 0, high: 0, critical: 0, unknown: 0 };
    for (const s of siteFilteredSessions) {
      if (s.overallRisk && counts[s.overallRisk] !== undefined) counts[s.overallRisk]++;
      else counts.unknown++;
    }
    return counts;
  }, [siteFilteredSessions]);

  const totalHealth = Object.values(healthCounts).reduce((a, b) => a + b, 0) || 1;

  // Alerts: site-filtered sessions with findings (when a site is selected, only that site's docs; "All Sites" = all)
  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const liveAlerts = useMemo(() =>
    siteFilteredSessions
      .filter(s => (s.totalFindings || 0) > 0)
      .sort((a, b) => {
        const ra = riskOrder[a.overallRisk] ?? 4;
        const rb = riskOrder[b.overallRisk] ?? 4;
        if (ra !== rb) return ra - rb;
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
      })),
  [siteFilteredSessions]);

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
          <span className="kpi-icon kpi-icon-red"><XCircle size={18} /></span>
          <div>
            <span className="kpi-value">{kpi.overdueReviews}</span>
            <span className="kpi-label">Overdue Reviews</span>
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
              {siteFilteredSessions.filter(s => !s.overallRisk || s.overallRisk === 'low').length}
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
                    <button type="button" className="dash-alert-action" onClick={() => startReview(a.session ? { documentId: a.documentId || a.doc, title: a.doc, trackingId: a.session.trackingId } : null)}>
                      {a.action}
                    </button>
                    <button type="button" className="dash-alert-action dash-alert-delete" onClick={() => removeSessionFromLog(a.id)} title="Remove from Attention Required">
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

        {/* Agent sessions breakdown */}
        <section className="dash-card dash-agents">
          <h2 className="dash-card-title">
            <TrendingUp size={15} />
            Agents — Sessions Run
          </h2>
          {agentStats.length === 0 ? (
            <p className="dash-empty">Run an analysis to see per-agent findings.</p>
          ) : (
            <div className="agent-stat-list">
              {agentStats.map(a => {
                const maxCount = Math.max(...agentStats.map(x => x.findings), 1);
                const pct = Math.round((a.findings / maxCount) * 100);
                return (
                  <div key={a.agent} className="agent-stat-row">
                    <span className="agent-stat-name">{a.agent}</span>
                    <div className="agent-stat-bar-wrap">
                      <div className="agent-stat-bar" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="agent-stat-count">{a.findings}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Corrections Implemented — separate metric below Agents */}
        <section className="dash-card dash-corrections">
          <h2 className="dash-card-title">
            <CheckCircle2 size={15} />
            Corrections Implemented
          </h2>
          <div className="dash-corrections-value">{kpi.correctionsImplemented}</div>
          <p className="dash-corrections-desc">Findings accepted and applied to the draft across all sessions.</p>
        </section>

        {/* Document health */}
        <section className="dash-card dash-health">
          <h2 className="dash-card-title">
            <FileText size={15} />
            Analysed Document Risk Profile
          </h2>
          {allSessions.length === 0 ? (
            <p className="dash-empty">No sessions yet. Run an analysis to populate this chart.</p>
          ) : (
            <>
              <div className="health-legend">
                <span className="legend-dot legend-current" /> Low ({healthCounts.low})
                <span className="legend-dot legend-due" /> Medium ({healthCounts.medium})
                <span className="legend-dot legend-overdue" /> High ({healthCounts.high})
                <span className="legend-dot" style={{ background: '#7f0000' }} /> Critical ({healthCounts.critical})
              </div>
              <div className="health-bar-wrap">
                {healthCounts.low > 0 && (
                  <div className="health-bar health-current" style={{ width: `${(healthCounts.low / totalHealth) * 100}%` }} title={`${healthCounts.low} low`} />
                )}
                {healthCounts.medium > 0 && (
                  <div className="health-bar health-due" style={{ width: `${(healthCounts.medium / totalHealth) * 100}%` }} title={`${healthCounts.medium} medium`} />
                )}
                {healthCounts.high > 0 && (
                  <div className="health-bar health-overdue" style={{ width: `${(healthCounts.high / totalHealth) * 100}%` }} title={`${healthCounts.high} high`} />
                )}
                {healthCounts.critical > 0 && (
                  <div className="health-bar" style={{ width: `${(healthCounts.critical / totalHealth) * 100}%`, background: '#7f0000' }} title={`${healthCounts.critical} critical`} />
                )}
              </div>
              <div className="health-counts">
                <span>{healthCounts.low} low</span>
                <span>{healthCounts.medium} medium</span>
                <span>{healthCounts.high} high</span>
                <span>{healthCounts.critical} critical</span>
              </div>
            </>
          )}
        </section>

      </div>
    </div>
  );
}
