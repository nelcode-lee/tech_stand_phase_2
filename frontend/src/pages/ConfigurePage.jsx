import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Crosshair, Zap, Eye, Shield, Swords, Target, Link2, Square, LayoutGrid, Scale, Save } from 'lucide-react';
import { useAnalysis } from '../context/AnalysisContext';
import SitesSelect from '../components/SitesSelect';
import './ConfigurePage.css';

const CONFIG_STORAGE_KEY = 'tech-standards-review-config';

const AGENT_ICONS = {
  cleansing: Eye,
  risk: Shield,
  conflict: Swords,
  specifying: Target,
  sequencing: Link2,
  terminology: Square,
  formatting: LayoutGrid,
  validation: Scale,
};

const REQUEST_TYPES = {
  review: [
    { value: 'single_document_review',  label: 'Single Document Review',   desc: 'Full analysis using all agents' },
    { value: 'harmonisation_review',    label: 'Harmonisation Review',     desc: 'How the document aligns with existing policies' },
    { value: 'principle_layer_review', label: 'Principle Layer Review',   desc: 'Identify if we are capturing enough of the What' },
  ],
  create: [
    { value: 'new_document', label: 'New Document', desc: 'Draft a new SOP, Principle, or Policy from scratch' },
  ],
};

const DOC_LAYER_OPTIONS = [
  { value: 'policy', label: 'Policy', desc: 'High-level governance and intent' },
  { value: 'principle', label: 'Principle / Standard', desc: 'Standards and principles' },
  { value: 'sop', label: 'SOP', desc: 'Standard Operating Procedure — full section template' },
  { value: 'work_instruction', label: 'Work Instruction', desc: 'Step-by-step instructions' },
];

export default function ConfigurePage({ mode = 'review' }) {
  const navigate = useNavigate();
  const { config, setConfig, allAgentKeys, agentLabels } = useAnalysis();
  const base = `/${mode}`;
  const [saveStatus, setSaveStatus] = useState(null);

  const requestTypes = REQUEST_TYPES[mode] || REQUEST_TYPES.review;
  const selectedAgents = config.agents?.length ? config.agents : [...allAgentKeys];
  const analysisMode = config.mode || 'full';

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${CONFIG_STORAGE_KEY}-${mode}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        setConfig(c => {
          if (c.documentId) return c;
          return { ...c, ...parsed };
        });
      }
    } catch {
      // Ignore parse errors
    }
  }, [mode, setConfig]);

  useEffect(() => {
    if (mode === 'create' && config.requestType !== 'new_document') {
      setConfig(c => ({ ...c, requestType: 'new_document' }));
    }
    if (mode === 'review' && !['single_document_review', 'harmonisation_review', 'principle_layer_review'].includes(config.requestType)) {
      setConfig(c => ({ ...c, requestType: 'single_document_review' }));
    }
  }, [mode, config.requestType, setConfig]);

  function handleSave(e) {
    e.preventDefault();
    try {
      const toStore = {
        requestType: config.requestType,
        documentId: config.documentId,
        docLayer: config.docLayer,
        sites: config.sites,
        policyRef: config.policyRef,
        requester: config.requester,
        mode: config.mode,
        agents: config.agents,
      };
      localStorage.setItem(`${CONFIG_STORAGE_KEY}-${mode}`, JSON.stringify(toStore));
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 2500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 2500);
    }
  }

  function setAnalysisMode(m) {
    setConfig(c => ({
      ...c,
      mode: m,
      agents: m === 'targeted' ? [...allAgentKeys] : m === 'quick' ? ['cleansing', 'risk', 'formatting'] : [...allAgentKeys],
    }));
  }

  function toggleAgent(key) {
    if (analysisMode !== 'targeted') return;
    setConfig(c => ({
      ...c,
      agents: c.agents.includes(key) ? c.agents.filter(a => a !== key) : [...c.agents, key],
    }));
  }

  function setField(field, value) {
    setConfig(c => ({ ...c, [field]: value }));
  }

  function handleContinue(e) {
    e.preventDefault();
    navigate(`${base}/ingest`);
  }

  function handleSkipToAnalyse(e) {
    e.preventDefault();
    // Put documentId in URL so Analyse page uses the correct document (never stale config)
    const docId = config?.documentId || '';
    const url = docId ? `${base}/analyse?documentId=${encodeURIComponent(docId)}` : `${base}/analyse`;
    navigate(url);
  }

  return (
    <div className="configure-page">
      <div className="configure-header">
        <h1 className="configure-title">
          {mode === 'create' ? 'Create a Document' : 'Review a Document'}
        </h1>
        <p className="configure-subtitle">
          {mode === 'create'
            ? 'Choose the document type and upload reference materials. The pipeline will draft from your standards and policies.'
            : 'Set the document context and choose your analysis mode.'}
        </p>
      </div>

      <form onSubmit={handleContinue} className="configure-form">

        {/* Request type */}
        <section className="config-section">
          <h3 className="config-section-title">Request Type</h3>
          <div className="request-type-grid">
            {requestTypes.map(rt => (
              <button
                key={rt.value}
                type="button"
                className={`request-type-btn ${config.requestType === rt.value ? 'active' : ''}`}
                onClick={() => setField('requestType', rt.value)}
              >
                <span className="rt-label">{rt.label}</span>
                <span className="rt-desc">{rt.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Document details */}
        <section className="config-section">
          <h3 className="config-section-title">
            {mode === 'create' ? 'Document Type & Format' : 'Document Details'}
          </h3>
          {mode === 'create' && (
            <p className="config-section-hint">
              The document type determines the structure and which sections are required (Purpose, Scope, Procedure, etc.).
            </p>
          )}
          <div className="config-fields">
            {mode === 'create' ? (
              <div className="form-row">
                <label>Document Type</label>
                <div className="doc-type-grid">
                  {DOC_LAYER_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`doc-type-btn ${config.docLayer === opt.value ? 'active' : ''}`}
                      onClick={() => setField('docLayer', opt.value)}
                    >
                      <span className="doc-type-label">{opt.label}</span>
                      <span className="doc-type-desc">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="form-row">
              <label>Document ID</label>
              <input
                type="text"
                placeholder={mode === 'create' ? 'e.g. GEN-OP-01-Goods-In, CMS-v2' : 'e.g. CMS-v2, BRCGS-FS-v9-meat, GEN-OP-01'}
                value={config.documentId || ''}
                onChange={e => setField('documentId', e.target.value)}
              />
            </div>
            {mode !== 'create' && (
              <div className="form-row">
                <label>Document Layer</label>
                <select value={config.docLayer || 'sop'} onChange={e => setField('docLayer', e.target.value)}>
                  <option value="policy">Policy</option>
                  <option value="principle">Principle</option>
                  <option value="sop">SOP</option>
                  <option value="work_instruction">Work Instruction</option>
                </select>
              </div>
            )}
            <div className="form-row">
              <label>Sites</label>
              <SitesSelect
                id="config-sites"
                value={config.sites}
                onChange={v => setField('sites', v)}
              />
            </div>
            <div className="form-row">
              <label>Policy Reference</label>
              <input
                type="text"
                placeholder="e.g. P-001"
                value={config.policyRef || ''}
                onChange={e => setField('policyRef', e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Requester</label>
              <input
                type="text"
                placeholder="Your name (logged with findings)"
                value={config.requester || ''}
                onChange={e => setField('requester', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Analysis mode — only for review */}
        {mode === 'review' && (
        <section className="config-section">
          <h3 className="config-section-title">Analysis Mode</h3>
          <div className="mode-buttons">
            <button type="button" className={`mode-btn ${analysisMode === 'full' ? 'active' : ''}`} onClick={() => setAnalysisMode('full')}>
              <Search size={20} />
              <span>Full Analysis</span>
              <span className="mode-desc">All 8 agents</span>
            </button>
            <button type="button" className={`mode-btn ${analysisMode === 'targeted' ? 'active' : ''}`} onClick={() => setAnalysisMode('targeted')}>
              <Crosshair size={20} />
              <span>Targeted</span>
              <span className="mode-desc">Choose agents</span>
            </button>
            <button type="button" className={`mode-btn ${analysisMode === 'quick' ? 'active' : ''}`} onClick={() => setAnalysisMode('quick')}>
              <Zap size={20} />
              <span>Quick Check</span>
              <span className="mode-desc">3 agents</span>
            </button>
          </div>
        </section>
        )}

        {/* Agent selection (targeted only) — review only */}
        {mode === 'review' && analysisMode === 'targeted' && (
          <section className="config-section">
            <h3 className="config-section-title">Select Agents</h3>
            <div className="agent-grid">
              {allAgentKeys.map(key => {
                const Icon = AGENT_ICONS[key] || Target;
                const selected = selectedAgents.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`agent-btn ${selected ? 'selected' : ''}`}
                    onClick={() => toggleAgent(key)}
                  >
                    <Icon size={16} />
                    {agentLabels[key] || key}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="configure-footer">
          <button
            type="button"
            className={`configure-save-btn ${saveStatus === 'saved' ? 'saved' : ''} ${saveStatus === 'error' ? 'error' : ''}`}
            onClick={handleSave}
            title="Save amendments"
          >
            <Save size={16} />
            {saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed' : 'Save'}
          </button>
          {mode === 'review' && config.documentId ? (
            <button type="button" className="configure-skip-btn" onClick={handleSkipToAnalyse} title="Document is already in Library — skip upload">
              Skip to Analysis →
            </button>
          ) : null}
          <button type="submit" className="configure-next-btn">
            {mode === 'create'
              ? 'Upload Reference Materials →'
              : config.documentId ? 'Upload new version' : 'Continue to Upload'} →
          </button>
        </div>
      </form>
    </div>
  );
}
