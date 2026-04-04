import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Cloud,
  Shield,
  MapPin,
  ExternalLink,
  Key,
  Building2,
  Lock,
  Trash2,
  ScrollText,
} from 'lucide-react';
import { useAnalysis } from '../context/AnalysisContext';
import { SITES_OPTIONS } from '../constants/sites';
import { addInteractionLog, clearSopsAndResetMetrics, resetMetricsAndPruneLibrary } from '../api';
import { GovernanceLogsPanel } from './LogsPage';
import './SettingsPage.css';

const SESSION_LOG_KEY = 'tech-standards-session-log';

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionFromUrl = searchParams.get('section');
  const [activeSection, setActiveSection] = useState(() =>
    sectionFromUrl === 'governance' ? 'governance' : 'sharepoint'
  );
  const { reloadSessionLog } = useAnalysis();
  const [sessionCleared, setSessionCleared] = useState(false);
  const [resetInProgress, setResetInProgress] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [resetError, setResetError] = useState(null);
  const [sopClearInProgress, setSopClearInProgress] = useState(false);
  const [sopClearResult, setSopClearResult] = useState(null);
  const [sopClearError, setSopClearError] = useState(null);

  const goToSection = useCallback(
    (sectionKey, elementId) => {
      setActiveSection(sectionKey);
      if (sectionKey === 'governance') {
        setSearchParams({ section: 'governance' });
      } else {
        setSearchParams({});
      }
      requestAnimationFrame(() => {
        document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (sectionFromUrl !== 'governance') return;
    const t = setTimeout(() => {
      document.getElementById('governance-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    return () => clearTimeout(t);
  }, [sectionFromUrl]);

  function clearSessionHistory() {
    try {
      localStorage.removeItem(SESSION_LOG_KEY);
      if (reloadSessionLog) reloadSessionLog();
      setSessionCleared(true);
      addInteractionLog({
        user_name: '',
        action_type: 'delete_session_history_local',
        route: '/settings',
        workflow_mode: '',
        metadata: {
          target: 'local_session_log',
        },
      }).catch(() => {});
      setTimeout(() => setSessionCleared(false), 3000);
    } catch {
      setSessionCleared(false);
    }
  }

  async function handleResetMetricsAndLibrary() {
    setResetError(null);
    setResetResult(null);
    setResetInProgress(true);
    try {
      const data = await resetMetricsAndPruneLibrary();
      localStorage.removeItem(SESSION_LOG_KEY);
      if (reloadSessionLog) reloadSessionLog();
      setResetResult(data);
      addInteractionLog({
        user_name: '',
        action_type: 'delete_metrics_and_prune_library',
        route: '/settings',
        workflow_mode: '',
        metadata: {
          sessions_deleted: data?.sessions_deleted ?? null,
          documents_removed: data?.documents_removed ?? null,
          documents_kept: data?.documents_kept || [],
        },
      }).catch(() => {});
      setSessionCleared(true);
      setTimeout(() => setSessionCleared(false), 2000);
    } catch (err) {
      setResetError(err.message || 'Reset failed');
    } finally {
      setResetInProgress(false);
    }
  }

  async function handleClearSopsAndResetMetrics() {
    setSopClearError(null);
    setSopClearResult(null);
    setSopClearInProgress(true);
    try {
      const data = await clearSopsAndResetMetrics();
      localStorage.removeItem(SESSION_LOG_KEY);
      if (reloadSessionLog) reloadSessionLog();
      setSopClearResult(data);
      addInteractionLog({
        user_name: '',
        action_type: 'clear_sops_and_reset_metrics',
        route: '/settings',
        workflow_mode: '',
        metadata: {
          sessions_deleted: data?.sessions_deleted ?? null,
          procedure_documents_removed: data?.procedure_documents_removed ?? null,
          finding_notes_deleted: data?.finding_notes_deleted ?? null,
        },
      }).catch(() => {});
    } catch (err) {
      setSopClearError(err.message || 'Clear failed');
    } finally {
      setSopClearInProgress(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-subtitle">
          Configure integrations, authentication, site-specific options, and governance logs.
        </p>
      </header>

      {/* Section nav — for future when sections get long */}
      <nav className="settings-nav" aria-label="Settings sections">
        <button
          type="button"
          className={`settings-nav-btn ${activeSection === 'sharepoint' ? 'active' : ''}`}
          onClick={() => goToSection('sharepoint', 'sharepoint')}
        >
          <Cloud size={16} />
          SharePoint
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeSection === 'sso' ? 'active' : ''}`}
          onClick={() => goToSection('sso', 'sso')}
        >
          <Shield size={16} />
          SSO & Authentication
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeSection === 'sites' ? 'active' : ''}`}
          onClick={() => goToSection('sites', 'sites')}
        >
          <MapPin size={16} />
          Site-specific
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeSection === 'governance' ? 'active' : ''}`}
          onClick={() => goToSection('governance', 'governance-logs')}
        >
          <ScrollText size={16} />
          Governance logs
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeSection === 'data' ? 'active' : ''}`}
          onClick={() => goToSection('data', 'data')}
        >
          <Trash2 size={16} />
          Data
        </button>
      </nav>

      <div className="settings-content">
        {/* SharePoint connection */}
        <section
          id="sharepoint"
          className="settings-section"
        >
          <div className="settings-section-header">
            <h2 className="settings-section-title">
              <Cloud size={20} />
              SharePoint Connection
            </h2>
            <span className="settings-badge coming-soon">Coming soon</span>
          </div>
          <p className="settings-section-desc">
            Connect to Microsoft SharePoint to sync documents, policies, and standards. Configure tenant URL, site collection, and app credentials.
          </p>
          <div className="settings-placeholder">
            <div className="placeholder-row">
              <Building2 size={18} />
              <span>Tenant URL</span>
              <code>https://yourtenant.sharepoint.com</code>
            </div>
            <div className="placeholder-row">
              <ExternalLink size={18} />
              <span>Site / Document library</span>
              <code>e.g. /sites/TechnicalStandards</code>
            </div>
            <div className="placeholder-row">
              <Key size={18} />
              <span>App registration (Client ID / Secret)</span>
              <code>Azure AD app registration</code>
            </div>
          </div>
        </section>

        {/* SSO & Authentication */}
        <section
          id="sso"
          className="settings-section"
        >
          <div className="settings-section-header">
            <h2 className="settings-section-title">
              <Shield size={20} />
              SSO & Authentication
            </h2>
            <span className="settings-badge coming-soon">Coming soon</span>
          </div>
          <p className="settings-section-desc">
            Configure Single Sign-On (SSO) or SAML/OIDC for enterprise authentication. Integrate with Azure AD or other identity providers.
          </p>
          <div className="settings-placeholder">
            <div className="placeholder-row">
              <Lock size={18} />
              <span>Identity provider</span>
              <code>Azure AD, Okta, etc.</code>
            </div>
            <div className="placeholder-row">
              <ExternalLink size={18} />
              <span>Metadata URL / Issuer</span>
              <code>SAML metadata or OIDC discovery URL</code>
            </div>
          </div>
        </section>

        {/* Site-specific settings */}
        <section
          id="sites"
          className="settings-section"
        >
          <div className="settings-section-header">
            <h2 className="settings-section-title">
              <MapPin size={20} />
              Site-specific Settings
            </h2>
            <span className="settings-badge coming-soon">Coming soon</span>
          </div>
          <p className="settings-section-desc">
            Configure options per Cranswick site. Override defaults for document libraries, naming conventions, or compliance requirements.
          </p>
          <div className="settings-placeholder">
            <div className="placeholder-sites">
              <span className="placeholder-label">{SITES_OPTIONS.filter(s => s.value !== 'all').length} sites available</span>
              <ul className="placeholder-sites-list">
                {SITES_OPTIONS.filter(s => s.value !== 'all').slice(0, 5).map((s, i) => (
                  <li key={i}>{s.label}</li>
                ))}
                <li className="placeholder-more">… and more</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Governance logs — interaction audit trail */}
        <section id="governance-logs" className="settings-section settings-section--governance">
          <div className="settings-section-header">
            <h2 className="settings-section-title">
              <ScrollText size={20} />
              Governance logs
            </h2>
          </div>
          <p className="settings-section-desc">
            Recent user and workflow interactions (same data as the former Governance Logs page). Use Refresh to reload from the server.
          </p>
          <GovernanceLogsPanel embedded />
        </section>

        {/* Data & session history */}
        <section
          id="data"
          className="settings-section"
        >
          <div className="settings-section-header">
            <h2 className="settings-section-title">
              <Trash2 size={20} />
              Data &amp; session history
            </h2>
          </div>
          <p className="settings-section-desc">
            <strong>Clear SOPs &amp; metrics:</strong> removes every ingested document with layer{' '}
            <em>sop</em> or <em>work_instruction</em> (vectors, registry, stored content/DOCX), deletes all
            analysis sessions (dashboard / Attention Required), all finding notes, and user-note embeddings.
            <strong> Policy and principle documents</strong> (e.g. BRCGS, Cranswick MS) are kept.
          </p>
          <button
            type="button"
            className="settings-clear-btn settings-reset-btn"
            onClick={handleClearSopsAndResetMetrics}
            disabled={sopClearInProgress || resetInProgress}
          >
            {sopClearInProgress ? 'Clearing…' : 'Clear all SOP data & reset metrics'}
          </button>
          {sopClearError && <p className="settings-error-msg">{sopClearError}</p>}
          {sopClearResult && (
            <p className="settings-cleared-msg">
              Done. {sopClearResult.sessions_deleted} session(s), {sopClearResult.procedure_documents_removed}{' '}
              procedure doc(s), {sopClearResult.finding_notes_deleted} finding note(s) cleared.
              {sopClearResult.user_note_vector_chunks_deleted != null &&
                ` ${sopClearResult.user_note_vector_chunks_deleted} user-note vector chunk(s) removed.`}
            </p>
          )}
          <p className="settings-section-desc" style={{ marginTop: '1.25rem' }}>
            <strong>Reset metrics &amp; prune library:</strong> deletes all analysis sessions and removes{' '}
            <em>every</em> library document except &quot;local-Cranswick Manufacturing Standard v2&quot; and
            &quot;BRCGS - Food Safety Standard - V9&quot; (by exact title). Use for a full library wipe
            while keeping the two named standards.
          </p>
          <button
            type="button"
            className="settings-clear-btn settings-reset-btn"
            onClick={handleResetMetricsAndLibrary}
            disabled={resetInProgress || sopClearInProgress}
          >
            {resetInProgress ? 'Resetting…' : 'Reset metrics and prune library'}
          </button>
          {resetError && <p className="settings-error-msg">{resetError}</p>}
          {resetResult && (
            <p className="settings-cleared-msg">
              Done. {resetResult.sessions_deleted} session(s) deleted, {resetResult.documents_removed} document(s) removed. Kept: {resetResult.documents_kept?.join(', ') || '—'}. Open Library or Dashboard to see updated data.
            </p>
          )}
          <p className="settings-section-desc" style={{ marginTop: '1rem' }}>
            Or clear only the local session log (no server change). Use if you already ran a reset and still see old sessions.
          </p>
          <button
            type="button"
            className="settings-clear-btn"
            onClick={clearSessionHistory}
          >
            {sessionCleared ? 'Cleared' : 'Clear session history only'}
          </button>
          {sessionCleared && !resetResult && <span className="settings-cleared-msg">Session history cleared. Refresh Library/Dashboard.</span>}
        </section>
      </div>
    </div>
  );
}
