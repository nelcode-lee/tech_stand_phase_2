import { createContext, useContext, useState } from 'react';

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
    requestType: 'review_request',
    docLayer: 'sop',
    sites: '',
    policyRef: '',
    documentId: '',
  });
  const [workflowMode, setWorkflowMode] = useState('review'); // 'review' | 'create'

  // Append-only log of completed analysis sessions for Dashboard / Library.
  // Each entry: { trackingId, documentId, title, docLayer, sites, overallRisk,
  //               totalFindings, agentsRun, completedAt, workflowType }
  const [sessionLog, setSessionLog] = useState([]);

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

    setSessionLog(log => [
      {
        trackingId:    apiResult.tracking_id,
        documentId:    sessionConfig.documentId || '',
        title:         sessionConfig.documentId || 'Unnamed document',
        docLayer:      sessionConfig.docLayer || 'sop',
        sites:         sessionConfig.sites || '',
        overallRisk:   apiResult.overall_risk || null,
        totalFindings,
        agentsRun:     apiResult.agents_run || [],
        completedAt:   new Date().toISOString(),
        workflowType:  wfMode || 'review',
        draftReady:    apiResult.draft_ready || false,
      },
      ...log,   // newest first
    ]);
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
    requestType: 'review_request',
    docLayer: 'sop',
    sites: '',
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
