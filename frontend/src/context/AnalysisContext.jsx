import { createContext, useCallback, useContext, useState } from 'react';

const AnalysisContext = createContext(null);

const ALL_AGENTS_KEYS = [
  'cleansing',
  'risk',
  'conflict',
  'specifying',
  'sequencing',
  'terminology',
  'formatting',
  'validation',
];

const AGENT_LABELS = {
  cleansing: 'Cleansor',
  risk: 'Risk-Assessor',
  conflict: 'Conflictor',
  specifying: 'Specifier',
  sequencing: 'Sequencer',
  terminology: 'Terminator',
  formatting: 'Formatter',
  validation: 'Validator',
};

export function AnalysisProvider({ children }) {
  const [result, setResult] = useState(null);
  const [config, setConfig] = useState({
    mode: 'full',
    agents: [...ALL_AGENTS_KEYS],
    requestType: 'single_document_review',
    docLayer: 'sop',
    sites: [],
    policyRef: '',
    documentId: '',
  });
  const [workflowMode, setWorkflowMode] = useState('review'); // 'review' | 'create'

  // Append-only log of completed analysis sessions for Dashboard / Library.
  // Each entry: { trackingId, documentId, title, docLayer, sites, overallRisk,
  //               totalFindings, agentsRun, completedAt, workflowType, result? }
  const SESSION_LOG_KEY = 'tech-standards-session-log';
  const loadPersistedSessions = () => {
    try {
      const raw = localStorage.getItem(SESSION_LOG_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const [sessionLog, setSessionLog] = useState(loadPersistedSessions);

  const reloadSessionLog = useCallback(() => {
    setSessionLog(loadPersistedSessions());
  }, []);

  function recordSession(apiResult, sessionConfig, wfMode) {
    const totalFindings =
      (apiResult.risk_gaps?.length || 0) +
      (apiResult.specifying_flags?.length || 0) +
      (apiResult.structure_flags?.length || 0) +
      (apiResult.content_integrity_flags?.length || 0) +
      (apiResult.sequencing_flags?.length || 0) +
      (apiResult.formatting_flags?.length || 0) +
      (apiResult.compliance_flags?.length || 0) +
      (apiResult.terminology_flags?.length || 0) +
      (apiResult.conflicts?.length || 0);

    const agentFindings = {};
    if (apiResult.risk_gaps?.length) agentFindings.risk = apiResult.risk_gaps.length;
    if (apiResult.specifying_flags?.length) agentFindings.specifying = apiResult.specifying_flags.length;
    if (apiResult.structure_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + apiResult.structure_flags.length;
    if (apiResult.content_integrity_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + apiResult.content_integrity_flags.length;
    if (apiResult.sequencing_flags?.length) agentFindings.sequencing = apiResult.sequencing_flags.length;
    if (apiResult.formatting_flags?.length) agentFindings.formatting = apiResult.formatting_flags.length;
    if (apiResult.compliance_flags?.length) agentFindings.validation = apiResult.compliance_flags.length;
    if (apiResult.terminology_flags?.length) agentFindings.terminology = apiResult.terminology_flags.length;
    if (apiResult.conflicts?.length) agentFindings.conflict = apiResult.conflicts.length;

    const sitesDisplay = Array.isArray(sessionConfig.sites)
      ? (sessionConfig.sites.includes('all') ? 'All Sites' : sessionConfig.sites.join(', '))
      : (sessionConfig.sites || '');
    const entry = {
      trackingId:    apiResult.tracking_id,
      documentId:    sessionConfig.documentId || '',
      title:         sessionConfig.title || sessionConfig.documentId || 'Unnamed document',
      docLayer:      sessionConfig.docLayer || 'sop',
      sites:         sitesDisplay,
      overallRisk:   apiResult.overall_risk || null,
      totalFindings,
      agentsRun:     apiResult.agents_run || [],
      agentFindings,
      completedAt:   new Date().toISOString(),
      workflowType:  wfMode || 'review',
      draftReady:    apiResult.draft_ready || false,
      result:        apiResult,  // full result for View analysis (when not in DB)
    };
    setSessionLog(log => {
      const next = [entry, ...log];
      try {
        const toPersist = next.slice(0, 100).map(({ result: _r, ...rest }) => rest);
        localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(toPersist));
      } catch (_) { /* ignore quota */ }
      return next;
    });
  }

  return (
    <AnalysisContext.Provider
      value={{
        result,
        setResult,
        config,
        setConfig,
        workflowMode,
        setWorkflowMode,
        sessionLog,
        recordSession,
        reloadSessionLog,
        allAgentKeys: ALL_AGENTS_KEYS,
        agentLabels: AGENT_LABELS,
      }}
    >
      {children}
    </AnalysisContext.Provider>
  );
}

const DEFAULTS = {
  result: null,
  setResult: () => {},
  config: {
    mode: 'full',
    agents: [...ALL_AGENTS_KEYS],
    requestType: 'single_document_review',
    docLayer: 'sop',
    sites: [],
    policyRef: '',
    documentId: '',
  },
  setConfig: () => {},
  workflowMode: 'review',
  setWorkflowMode: () => {},
  allAgentKeys: ALL_AGENTS_KEYS,
  agentLabels: AGENT_LABELS,
};

export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  return ctx || DEFAULTS;
}
