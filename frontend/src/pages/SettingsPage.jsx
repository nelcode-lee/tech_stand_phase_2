import { useState } from 'react';
import {
  Cloud,
  Shield,
  MapPin,
  ExternalLink,
  Key,
  Building2,
  Lock,
  Trash2,
} from 'lucide-react';
import { useAnalysis } from '../context/AnalysisContext';
import { SITES_OPTIONS } from '../constants/sites';
import { resetMetricsAndPruneLibrary } from '../api';
import './SettingsPage.css';

const SESSION_LOG_KEY = 'tech-standards-session-log';

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('sharepoint');
  const { reloadSessionLog } = useAnalysis();
  const [sessionCleared, setSessionCleared] = useState(false);
  const [resetInProgress, setResetInProgress] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [resetError, setResetError] = useState(null);

  function clearSessionHistory() {
    try {
      localStorage.removeItem(SESSION_LOG_KEY);
      if (reloadSessionLog) reloadSessionLog();
      setSessionCleared(true);
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
      setSessionCleared(true);
      setTimeout(() => setSessionCleared(false), 2000);
    } catch (err) {
      setResetError(err.message || 'Reset failed');
    } finally {
      setResetInProgress(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-subtitle">
          Configure integrations, authentication, and site-specific options.
        </p>
      </header>

      {/* Section nav — for future when sections get long */}
      <nav className="settings-nav" aria-label="Settings sections">
        <button
          type="button"
          className={`settings-nav-btn ${activeSection === 'sharepoint' ? 'active' : ''}`}
          onClick={() => {
            setActiveSection('sharepoint');
            document.getElementById('sharepoint')?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          <Cloud size={16} />
          SharePoint
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeSection === 'sso' ? 'active' : ''}`}
          onClick={() => {
            setActiveSection('sso');
            document.getElementById('sso')?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          <Shield size={16} />
          SSO & Authentication
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeSection === 'sites' ? 'active' : ''}`}
          onClick={() => {
            setActiveSection('sites');
            document.getElementById('sites')?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          <MapPin size={16} />
          Site-specific
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeSection === 'data' ? 'active' : ''}`}
          onClick={() => {
            setActiveSection('data');
            document.getElementById('data')?.scrollIntoView({ behavior: 'smooth' });
          }}
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
            Reset dashboard metrics and library in one go: all analysis sessions are deleted (Attention Required cleared) and all documents are removed except &quot;local-Cranswick Manufacturing Standard v2&quot; and &quot;BRCGS - Food Safety Standard - V9&quot;. Your browser session log is cleared so the UI shows the new state immediately.
          </p>
          <button
            type="button"
            className="settings-clear-btn settings-reset-btn"
            onClick={handleResetMetricsAndLibrary}
            disabled={resetInProgress}
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
