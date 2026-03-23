import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  LayoutGrid,
  FileSearch,
  FilePlus2,
  Settings,
  CheckCircle2,
  Database,
  FlaskConical,
  Info,
  ScrollText,
} from 'lucide-react';
import { AnalysisProvider, useAnalysis } from '../context/AnalysisContext';
import { SITES_OPTIONS } from '../constants/sites';
import { addInteractionLog } from '../api';
import ChatBotWidget from './ChatBotWidget';
import './Layout.css';

function Sidebar() {
  const { workflowMode, setWorkflowMode, selectedSite, setSelectedSite } = useAnalysis();
  const location = useLocation();
  const path = location.pathname;
  const [createInfoOpen, setCreateInfoOpen] = useState(false);
  const [createInfoPos, setCreateInfoPos] = useState({ top: 0, left: 0 });
  const createInfoTriggerRef = useRef(null);

  function showCreateInfo() {
    const el = createInfoTriggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCreateInfoPos({
      top: rect.top + rect.height / 2,
      left: rect.right + 8,
    });
    setCreateInfoOpen(true);
  }

  function hideCreateInfo() {
    setCreateInfoOpen(false);
  }

  function inSession() {
    return ['/configure', '/analyse', '/finalize', '/review/configure', '/review/analyse', '/review/finalize', '/create/configure', '/create/analyse', '/create/finalize'].some(p => path.startsWith(p));
  }

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <img src="/cranswick.png" alt="Cranswick" className="sidebar-logo" />
        <span className="sidebar-brand-sub">Technical Standards Agent</span>
      </div>

      <div className="sidebar-site-select">
        <label htmlFor="sidebar-site" className="sidebar-site-label">Site</label>
        <select
          id="sidebar-site"
          className="sidebar-site-dropdown"
          value={selectedSite}
          onChange={(e) => setSelectedSite(e.target.value)}
        >
          {SITES_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
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
        <NavLink to="/logs" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <ScrollText size={16} />
          Governance Logs
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
        <div className="sidebar-link-with-info">
          <NavLink
            to="/create/configure"
            className={({ isActive }) => `sidebar-link ${isActive || path.startsWith('/create') ? 'active' : ''}`}
            onClick={() => setWorkflowMode('create')}
          >
            <FilePlus2 size={16} />
            Create a Document
          </NavLink>
          <span
            ref={createInfoTriggerRef}
            className="sidebar-info-trigger"
            title="For new docs only"
            onMouseEnter={showCreateInfo}
            onMouseLeave={hideCreateInfo}
          >
            <Info size={14} />
          </span>
          {createInfoOpen && createPortal(
            <div
              className="sidebar-info-popup sidebar-info-popup-portal"
              style={{
                position: 'fixed',
                top: createInfoPos.top,
                left: createInfoPos.left,
                transform: 'translateY(-50%)',
              }}
              onMouseEnter={showCreateInfo}
              onMouseLeave={hideCreateInfo}
            >
              For new documents only. Use to build brand-new SOPs from ingested policies and standards — not for reviewing existing documents.
            </div>,
            document.body
          )}
        </div>

        {inSession() && (
          <>
            <span className="sidebar-section-label">Current Session</span>
            <SessionSteps mode={workflowMode} path={path} />
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/settings" className={({ isActive }) => `sidebar-link sidebar-link-muted ${isActive ? 'active' : ''}`}>
          <Settings size={16} />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}

function SessionSteps({ mode, path }) {
  const base = mode === 'create' ? '/create' : '/review';
  // Core usability flow: locate/upload → analyse → review findings → draft for HITL → submit to Library
  const steps = mode === 'create'
    ? [
        { to: `${base}/configure`, label: 'Configure', icon: Database },
        { to: `${base}/analyse/overview`, label: 'Analyse', icon: FlaskConical },
        { to: `${base}/analyse/draft`, label: 'Draft for HITL', icon: FilePlus2 },
        { to: `${base}/finalize`, label: 'Submit to Library', icon: CheckCircle2 },
      ]
    : [
        { to: `${base}/configure`, label: 'Configure', icon: Database },
        { to: `${base}/analyse/overview`, label: 'Analyse', icon: FlaskConical },
        { to: `${base}/analyse/draft`, label: 'Draft for HITL', icon: FilePlus2 },
        { to: `${base}/finalize`, label: 'Submit to Library', icon: CheckCircle2 },
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
  const { config, workflowMode } = useAnalysis();
  const location = useLocation();
  const lastRouteRef = useRef('');

  useEffect(() => {
    const routeKey = `${location.pathname}${location.search}`;
    if (!routeKey || routeKey === lastRouteRef.current) return;
    lastRouteRef.current = routeKey;
    addInteractionLog({
      user_name: config?.requester || '',
      action_type: 'route_view',
      route: routeKey,
      workflow_mode: workflowMode || '',
      document_id: config?.documentId || '',
      tracking_id: '',
      doc_layer: config?.docLayer || '',
      metadata: {
        title: config?.title || '',
      },
    }).catch(() => {});
  }, [location.pathname, location.search, workflowMode, config?.requester, config?.documentId, config?.docLayer, config?.title]);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-content">
        <main className="app-main">
          <Outlet />
        </main>
      </div>
      <ChatBotWidget documentId={config?.documentId || undefined} docLayer={config?.docLayer || undefined} />
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
