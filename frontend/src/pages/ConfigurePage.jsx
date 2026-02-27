import { useNavigate } from 'react-router-dom';
import { Search, Crosshair, Zap, Eye, Shield, Swords, Target, Link2, Square, LayoutGrid, Scale } from 'lucide-react';
import { useAnalysis } from '../context/AnalysisContext';
import './ConfigurePage.css';

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
    { value: 'review_request',     label: 'Review Existing',    desc: 'Check a current document against standards' },
    { value: 'contradiction_flag', label: 'Contradiction Check', desc: 'Flag conflicts between this doc and others' },
    { value: 'update_existing',    label: 'Update Document',     desc: 'Analyse and revise an existing document' },
  ],
  create: [
    { value: 'new_document', label: 'New Document', desc: 'Draft a new SOP, Principle, or Policy from scratch' },
  ],
};

export default function ConfigurePage({ mode = 'review' }) {
  const navigate = useNavigate();
  const { config, setConfig, allAgentKeys, agentLabels } = useAnalysis();
  const base = `/${mode}`;

  const requestTypes = REQUEST_TYPES[mode] || REQUEST_TYPES.review;
  const selectedAgents = config.agents?.length ? config.agents : [...allAgentKeys];
  const analysisMode = config.mode || 'full';

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

  return (
    <div className="configure-page">
      <div className="configure-header">
        <h1 className="configure-title">
          {mode === 'create' ? 'Create a Document' : 'Review a Document'}
        </h1>
        <p className="configure-subtitle">
          {mode === 'create'
            ? 'Configure the document type, layer, and which agents will draft it.'
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
          <h3 className="config-section-title">Document Details</h3>
          <div className="config-fields">
            <div className="form-row">
              <label>Document ID</label>
              <input
                type="text"
                placeholder="e.g. CMS-v2, BRCGS-FS-v9-meat, GEN-OP-01"
                value={config.documentId || ''}
                onChange={e => setField('documentId', e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Document Layer</label>
              <select value={config.docLayer || 'sop'} onChange={e => setField('docLayer', e.target.value)}>
                <option value="policy">Policy</option>
                <option value="principle">Principle</option>
                <option value="sop">SOP</option>
                <option value="work_instruction">Work Instruction</option>
              </select>
            </div>
            <div className="form-row">
              <label>Sites</label>
              <input
                type="text"
                placeholder="e.g. barnsley, hull (comma-separated)"
                value={config.sites || ''}
                onChange={e => setField('sites', e.target.value)}
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
          </div>
        </section>

        {/* Analysis mode */}
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

        {/* Agent selection (targeted only) */}
        {analysisMode === 'targeted' && (
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
          <button type="submit" className="configure-next-btn">
            Continue to Upload →
          </button>
        </div>
      </form>
    </div>
  );
}
