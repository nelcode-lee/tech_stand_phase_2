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

// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setWorkflowMode, setConfig, sessionLog, reloadSessionLog } = useAnalysis();

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

  // ---- Derived KPIs ---------------------------------------------------

  const kpi = useMemo(() => {
    const totalDocs    = backendDocs.length;
    const totalSessions= allSessions.length;
    const openFindings = allSessions.reduce((sum, s) => sum + (s.totalFindings || 0), 0);

    // Per-agent finding totals across all sessions
    const agentTotals = {};

    // Risk severity breakdown from session log (use latest per tracking_id)
    const riskCounts = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const s of allSessions) {
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
    };
  }, [backendDocs, allSessions]);

  // Agent breakdown: per-agent finding totals from all sessions
  const agentStats = useMemo(() => {
    const totals = {};
    for (const s of allSessions) {
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
  }, [allSessions]);

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

  // Health bar: count analysed docs by risk band
  const healthCounts = useMemo(() => {
    const counts = { low: 0, medium: 0, high: 0, critical: 0, unknown: 0 };
    for (const s of allSessions) {
      if (s.overallRisk && counts[s.overallRisk] !== undefined) counts[s.overallRisk]++;
      else counts.unknown++;
    }
    return counts;
  }, [allSessions]);

  const totalHealth = Object.values(healthCounts).reduce((a, b) => a + b, 0) || 1;

  // Alerts: any session with findings pending action (prioritise by risk, then findings count)
  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const liveAlerts = useMemo(() =>
    allSessions
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
  [allSessions]);

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

      {/* Page title */}
      <div className="dash-header">
        <div>
          <h1 className="dash-title">Dashboard</h1>
          <p className="dash-subtitle">Technical standards overview — all sites</p>
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
          <button type="button" className="dash-action-btn primary" onClick={startCreate}>
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
              {allSessions.filter(s => !s.overallRisk || s.overallRisk === 'low').length}
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
                  <button type="button" className="dash-alert-action" onClick={() => startReview(a.session ? { documentId: a.documentId || a.doc, title: a.doc, trackingId: a.session.trackingId } : null)}>
                    {a.action}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent activity */}
        <section className="dash-card dash-activity">
          <h2 className="dash-card-title">
            <Activity size={15} />
            Recent Analysis Sessions
          </h2>
          {activity.length === 0 ? (
            <p className="dash-empty">No analysis sessions yet this session. Run an analysis to see activity here.</p>
          ) : (
            <ul className="activity-list">
              {activity.map(item => (
                <li key={item.id} className="activity-item">
                  <span className={`activity-type-dot type-${item.type}`} />
                  <div className="activity-body">
                    <span className="activity-doc">{item.doc}</span>
                    <span className="activity-meta">
                      {item.type === 'review' ? 'Review' : 'Create'} · {item.time}
                    </span>
                  </div>
                  <div className="activity-right">
                    {item.totalFindings > 0 && (
                      <span className="activity-findings">{item.totalFindings} findings</span>
                    )}
                    <span className="activity-status status-complete">complete</span>
                    {item.risk && (
                      <span className={`risk-pill risk-${item.risk}`}>{item.risk}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
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
