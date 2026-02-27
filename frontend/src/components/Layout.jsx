import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  LayoutGrid,
  FileSearch,
  FilePlus2,
  Settings,
  CheckCircle2,
  Upload,
  FlaskConical,
} from 'lucide-react';
import { AnalysisProvider, useAnalysis } from '../context/AnalysisContext';
import './Layout.css';

function Sidebar() {
  const { workflowMode, setWorkflowMode } = useAnalysis();
  const location = useLocation();
  const path = location.pathname;

  function inSession() {
    return ['/configure', '/ingest', '/analyse', '/finalize', '/review/configure', '/review/ingest', '/review/analyse', '/review/finalize', '/create/configure', '/create/ingest', '/create/analyse', '/create/finalize'].some(p => path.startsWith(p));
  }

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <img src="/cranswick.png" alt="Cranswick" className="sidebar-logo" />
        <span className="sidebar-brand-sub">Technical Standards Agent</span>
      </div>

      <nav className="sidebar-nav">
        <span className="sidebar-section-label">Overview</span>
        <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link ${isActive || path === '/' ? 'active' : ''}`}>
          <LayoutDashboard size={16} />
          Dashboard
        </NavLink>
        <NavLink to="/library" className={({ isActive }) => `sidebar-link ${isActive || path.startsWith('/library') ? 'active' : ''}`}>
          <LayoutGrid size={16} />
          Document Library
        </NavLink>

        <span className="sidebar-section-label">Workflows</span>
        <NavLink
          to="/review/configure"
          className={({ isActive }) => `sidebar-link ${isActive || path.startsWith('/review') ? 'active' : ''}`}
          onClick={() => setWorkflowMode('review')}
        >
          <FileSearch size={16} />
          Review a Document
        </NavLink>
        <NavLink
          to="/create/configure"
          className={({ isActive }) => `sidebar-link ${isActive || path.startsWith('/create') ? 'active' : ''}`}
          onClick={() => setWorkflowMode('create')}
        >
          <FilePlus2 size={16} />
          Create a Document
        </NavLink>

        {inSession() && (
          <>
            <span className="sidebar-section-label">Current Session</span>
            <SessionSteps mode={workflowMode} path={path} />
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/settings" className="sidebar-link sidebar-link-muted">
          <Settings size={16} />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}

function SessionSteps({ mode, path }) {
  const base = mode === 'create' ? '/create' : '/review';
  const steps = mode === 'create'
    ? [
        { to: `${base}/configure`, label: 'Configure', icon: Settings },
        { to: `${base}/ingest`, label: 'Upload', icon: Upload },
        { to: `${base}/analyse`, label: 'Analyse', icon: FlaskConical },
        { to: `${base}/finalize`, label: 'Finalise', icon: CheckCircle2 },
      ]
    : [
        { to: `${base}/configure`, label: 'Configure', icon: Settings },
        { to: `${base}/ingest`, label: 'Upload', icon: Upload },
        { to: `${base}/analyse`, label: 'Review Findings', icon: FileSearch },
        { to: `${base}/finalize`, label: 'Resolve & Close', icon: CheckCircle2 },
      ];

  return (
    <ol className="session-steps">
      {steps.map(({ to, label, icon: Icon }, i) => {
        const isActive = path === to || path.startsWith(to);
        const isDone = steps.findIndex(s => path === s.to || path.startsWith(s.to)) > i;
        return (
          <li key={to} className={`session-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
            <span className="session-step-num">{isDone ? '✓' : i + 1}</span>
            <NavLink to={to} className="session-step-label">
              <Icon size={14} />
              {label}
            </NavLink>
          </li>
        );
      })}
    </ol>
  );
}

function LayoutInner() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-content">
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function Layout() {
  return (
    <AnalysisProvider>
      <LayoutInner />
    </AnalysisProvider>
  );
}
