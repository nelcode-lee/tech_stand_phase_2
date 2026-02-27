import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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

// ---------------------------------------------------------------------------
// Static fallback data — shown only when no real data is available yet.
// ---------------------------------------------------------------------------
const STATIC_ALERTS = [
  { id: 'sa1', severity: 'critical', doc: 'FSP011 HACCP Plan',              msg: 'Overdue for review by 11 months',          action: 'Review now' },
  { id: 'sa2', severity: 'high',     doc: 'FSP048 Foreign Body Prevention', msg: '4 unresolved high-risk findings',           action: 'View findings' },
  { id: 'sa3', severity: 'medium',   doc: 'FSP003 Vehicle Loading',         msg: 'Review cycle due in 14 days',              action: 'Schedule review' },
];

const SEVERITY_CLASS = { critical: 'alert-critical', high: 'alert-high', medium: 'alert-medium' };

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
  const { setWorkflowMode, setConfig, sessionLog } = useAnalysis();

  const [backendDocs, setBackendDocs] = useState([]);
  const [backendSessions, setBackendSessions] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);

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
    try {
      const data = await listAnalysisSessions(50);
      setBackendSessions(data || []);
    } catch {
      // Silently ignore; use sessionLog as fallback
    } finally {
      setLoadingSessions(false);
    }
  }

  useEffect(() => {
    fetchDocs();
    fetchSessions();
  }, []);

  // Merge sessionLog (in-memory, current session) with backend sessions
  const allSessions = useMemo(() => {
    const byId = {};
    for (const s of backendSessions) byId[s.trackingId] = s;
    for (const s of sessionLog) byId[s.trackingId] = s; // sessionLog overwrites (newer)
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
  }, [backendDocs, sessionLog]);

  // Agent breakdown from session log
  const agentStats = useMemo(() => {
    const totals = {};
    for (const s of sessionLog) {
      // We don't have per-agent counts in sessionLog directly (only totalFindings),
      // so accumulate using agentsRun as keys and totalFindings distributed evenly
      // for a proportional bar — a future enhancement can pass per-agent counts.
      for (const agent of (s.agentsRun || [])) {
        const key = AGENT_DISPLAY[agent] || agent;
        totals[key] = (totals[key] || 0);
      }
    }

    // If no sessions, return empty array so the card shows a message
    if (sessionLog.length === 0) return [];

    // Sum session findings per tracking_id with per-agent breakdown if available
    // For now we just show sessions count per agent
    return Object.entries(AGENT_DISPLAY)
      .map(([, label]) => {
        const count = sessionLog.filter(s => (s.agentsRun || []).includes(
          Object.keys(AGENT_DISPLAY).find(k => AGENT_DISPLAY[k] === label) || ''
        )).length;
        return { agent: label, sessions: count };
      })
      .filter(a => a.sessions > 0);
  }, [sessionLog]);

  // Activity feed from session log (most recent first, max 8)
  const activity = useMemo(() =>
    allSessions.slice(0, 8).map((s, i) => ({
      id:     s.trackingId || i,
      type:   s.workflowType || 'review',
      doc:    s.title || s.documentId || 'Unnamed',
      time:   timeAgo(s.completedAt),
      status: 'complete',
      risk:   s.overallRisk || null,
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

  // Alerts from session log: flag sessions with high/critical risk
  const liveAlerts = useMemo(() =>
    allSessions
      .filter(s => s.overallRisk === 'critical' || s.overallRisk === 'high')
      .slice(0, 5)
      .map(s => ({
        id:       s.trackingId,
        severity: s.overallRisk,
        doc:      s.title || s.documentId,
        msg:      `${s.totalFindings} findings — overall risk: ${s.overallRisk}`,
        action:   'View analysis',
      })),
  [allSessions]);

  const alerts = liveAlerts.length > 0 ? liveAlerts : STATIC_ALERTS;

  // ---- Navigation helpers ---------------------------------------------------

  function startReview() {
    setWorkflowMode('review');
    setConfig(c => ({ ...c, requestType: 'review_request' }));
    navigate('/review/configure');
  }

  function startCreate() {
    setWorkflowMode('create');
    setConfig(c => ({ ...c, requestType: 'new_document' }));
    navigate('/create/configure');
  }

  // ---------------------------------------------------------------------------

  return (
    <div className="dashboard">

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
            <span className="kpi-value">{kpi.totalDocs || '—'}</span>
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
            <span className="kpi-value">{kpi.openFindings > 0 ? kpi.openFindings : '—'}</span>
            <span className="kpi-label">Total Findings</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-green"><CheckCircle2 size={18} /></span>
          <div>
            <span className="kpi-value">
              {allSessions.filter(s => !s.overallRisk || s.overallRisk === 'low').length || '—'}
            </span>
            <span className="kpi-label">Low-Risk Sessions</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-blue"><Activity size={18} /></span>
          <div>
            <span className="kpi-value">{kpi.totalSessions || '—'}</span>
            <span className="kpi-label">Sessions</span>
          </div>
        </div>
      </div>

      <div className="dash-grid">

        {/* Alerts */}
        <section className="dash-card dash-alerts">
          <h2 className="dash-card-title">
            <AlertTriangle size={15} />
            {liveAlerts.length > 0 ? 'Live Alerts from Analysis' : 'Attention Required'}
            {liveAlerts.length === 0 && <span className="dash-static-tag">sample data</span>}
          </h2>
          <div className="alert-list">
            {alerts.map(a => (
              <div key={a.id} className={`dash-alert ${SEVERITY_CLASS[a.severity] || 'alert-medium'}`}>
                <div className="dash-alert-body">
                  <span className="dash-alert-doc">{a.doc}</span>
                  <span className="dash-alert-msg">{a.msg}</span>
                </div>
                <button type="button" className="dash-alert-action" onClick={startReview}>
                  {a.action}
                </button>
              </div>
            ))}
          </div>
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
            <p className="dash-empty">Run an analysis to see per-agent activity.</p>
          ) : (
            <div className="agent-stat-list">
              {agentStats.map(a => {
                const maxCount = Math.max(...agentStats.map(x => x.count), 1);
                const pct = Math.round((a.count / maxCount) * 100);
                return (
                  <div key={a.agent} className="agent-stat-row">
                    <span className="agent-stat-name">{a.agent}</span>
                    <div className="agent-stat-bar-wrap">
                      <div className="agent-stat-bar" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="agent-stat-count">{a.count}</span>
                    <span className="agent-stat-trend trend-flat">—</span>
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
          {sessionLog.length === 0 ? (
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
