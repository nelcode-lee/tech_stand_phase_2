import { useState } from 'react';
import {
  Cloud,
  Shield,
  MapPin,
  ExternalLink,
  Key,
  Building2,
  Lock,
} from 'lucide-react';
import { SITES_OPTIONS } from '../constants/sites';
import './SettingsPage.css';

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('sharepoint');

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
      </div>
    </div>
  );
}
