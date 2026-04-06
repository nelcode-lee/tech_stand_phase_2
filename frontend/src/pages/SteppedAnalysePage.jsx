import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { analyseSteppedStart, analyseSteppedNext, docLayerForApi } from '../api';
import { useAnalysis } from '../context/AnalysisContext';
import { resolveSitesForApi } from '../constants/sites';
import { PhasePositioningBanner } from '../components/PhasePositioningBanner';
import './SteppedAnalysePage.css';

const AGENT_LABELS = {
  cleansing: 'Cleanser',
  draft_layout: 'Draft layout',
  terminology: 'Terminology',
  conflict: 'Conflict',
  specifying: 'Specifier',
  sequencing: 'Sequencer',
  formatting: 'Formatter',
  risk: 'Risk assessor',
  validation: 'Validator',
};

function countFindingsForStep(agentName, res) {
  if (!res) return 0;
  const pick = (...keys) => keys.reduce((sum, k) => sum + (Array.isArray(res[k]) ? res[k].length : 0), 0);
  switch (agentName) {
    case 'cleansing':
      return pick('cleanser_flags', 'structure_flags', 'content_integrity_flags');
    case 'draft_layout':
      return 0;
    case 'terminology':
      return pick('terminology_flags');
    case 'conflict':
      return pick('conflicts');
    case 'specifying':
      return pick('specifying_flags');
    case 'sequencing':
      return pick('sequencing_flags');
    case 'formatting':
      return pick('formatting_flags');
    case 'risk':
      return pick('risk_gaps', 'risk_scores');
    case 'validation':
      return pick('compliance_flags');
    default:
      return 0;
  }
}

export default function SteppedAnalysePage({ mode = 'review' }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { config, recordSession } = useAnalysis();
  const base = `/${mode}`;

  const effectiveDocId = useMemo(
    () =>
      (config?.documentId || searchParams.get('documentId') || '').trim(),
    [config?.documentId, searchParams],
  );
  const effectiveTitle = (config?.title || effectiveDocId || '').trim();

  const [runId, setRunId] = useState(null);
  const [agentSequence, setAgentSequence] = useState([]);
  const [nextStepIndex, setNextStepIndex] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [lastStepAgent, setLastStepAgent] = useState(null);
  const [lastStepIndex, setLastStepIndex] = useState(null);
  const [complete, setComplete] = useState(false);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [editedText, setEditedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const buildBody = useCallback(() => {
    const sitesArr = Array.isArray(config.sites)
      ? config.sites
      : config.sites
        ? String(config.sites).split(/[,\s]+/).filter(Boolean)
        : [];
    return {
      request_type: config.requestType || 'single_document_review',
      doc_layer: docLayerForApi(config.docLayer),
      sites: resolveSitesForApi(sitesArr),
      policy_ref: (config.policyRef || '').trim() || null,
      document_id: effectiveDocId || null,
      title: effectiveTitle || null,
      requester: config.requester || null,
      agents: config?.mode && config.mode !== 'full' ? config.agents : undefined,
      additional_doc_ids: (config.additionalDocIds || []).length > 0 ? config.additionalDocIds : undefined,
      agent_instructions: (config.agentInstructions || '').trim() || undefined,
    };
  }, [config, effectiveDocId, effectiveTitle]);

  const syncEditedFromResult = useCallback((res) => {
    if (res && typeof res.draft_content === 'string') {
      setEditedText(res.draft_content);
    }
  }, []);

  async function handleStart() {
    if (!effectiveDocId) {
      setError('Choose a document on Configure first (document id required).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rid =
        globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const body = { ...buildBody(), tracking_id: `stepped-${rid}` };
      const res = await analyseSteppedStart(body);
      setRunId(res.run_id);
      setAgentSequence(res.agent_sequence || []);
      setTotalSteps(res.total_steps || 0);
      setNextStepIndex(res.next_step_index ?? 0);
      setLastStepAgent(res.step_agent);
      setLastStepIndex(res.step_index);
      setComplete(!!res.complete);
      setStatus(res.status);
      setResult(res.result);
      syncEditedFromResult(res.result);
      if (res.result?.tracking_id && res.complete) {
        recordSession(res.result, { ...config, documentId: effectiveDocId, title: effectiveTitle }, 'review');
      }
    } catch (e) {
      setError(e.message || 'Start failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleNext() {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await analyseSteppedNext({
        run_id: runId,
        edited_document_text: editedText.trim() ? editedText : null,
      });
      setNextStepIndex(res.next_step_index ?? 0);
      setLastStepAgent(res.step_agent);
      setLastStepIndex(res.step_index);
      setComplete(!!res.complete);
      setStatus(res.status);
      setResult(res.result);
      syncEditedFromResult(res.result);
      if (res.result?.tracking_id && res.complete) {
        recordSession(res.result, { ...config, documentId: effectiveDocId, title: effectiveTitle }, 'review');
      }
    } catch (e) {
      setError(e.message || 'Next step failed');
    } finally {
      setLoading(false);
    }
  }

  const stepFindingCount = lastStepAgent ? countFindingsForStep(lastStepAgent, result) : 0;

  return (
    <div className="stepped-analyse-page">
      <div className="stepped-analyse-bar">
        <h1 className="stepped-analyse-title">Stepped analysis</h1>
        <div className="stepped-analyse-actions">
          <button type="button" className="doc-btn" onClick={() => navigate(`${base}/configure`)}>
            ← Configure
          </button>
          <button type="button" className="doc-btn" onClick={() => navigate(`${base}/analyse/overview`)}>
            Classic Analyse
          </button>
        </div>
      </div>
      <PhasePositioningBanner variant="compact" className="stepped-phase-banner" />

      <div className="stepped-analyse-card">
        <p className="stepped-lead">
          Run <strong>one agent at a time</strong>, review findings, edit the working text if needed, then continue.
          State is stored on the server (Supabase when configured, otherwise local files under <code>data/stepped_runs/</code>).
        </p>

        {!effectiveDocId && (
          <p className="stepped-warning" role="alert">
            No document selected. Open <strong>Configure</strong> and pick a document, then return here.
          </p>
        )}

        {error && (
          <p className="stepped-error" role="alert">
            {error}
          </p>
        )}

        <div className="stepped-meta">
          <span>
            <strong>Document:</strong> {effectiveDocId || '—'}
          </span>
          {runId && (
            <span className="stepped-run-id" title="Stepped run id">
              Run: {runId.slice(0, 8)}…
            </span>
          )}
        </div>

        {!runId && (
          <button type="button" className="doc-btn primary" disabled={loading || !effectiveDocId} onClick={handleStart}>
            {loading ? 'Starting…' : 'Run first agent'}
          </button>
        )}

        {runId && (
          <>
            <div className="stepped-progress">
              <strong>
                Step {typeof lastStepIndex === 'number' ? lastStepIndex + 1 : '—'} of {totalSteps || '—'}
              </strong>
              {lastStepAgent && (
                <span className="stepped-agent-pill">
                  {AGENT_LABELS[lastStepAgent] || lastStepAgent}
                  {stepFindingCount > 0 ? ` · ${stepFindingCount} finding groups` : ''}
                </span>
              )}
              {status && <span className={`stepped-status stepped-status-${status}`}>{status}</span>}
            </div>

            {complete ? (
              <p className="stepped-done">Pipeline complete. You can open <strong>Classic Analyse</strong> overview with the same document or return to Configure.</p>
            ) : (
              <button type="button" className="doc-btn primary" disabled={loading} onClick={handleNext}>
                {loading ? 'Running next agent…' : 'Run next agent'}
              </button>
            )}

            <section className="stepped-findings-preview">
              <h2 className="stepped-h2">Cumulative result (latest)</h2>
              <FindingSummary result={result} />
            </section>

            {!complete && (
              <section className="stepped-edit">
                <h2 className="stepped-h2">Working text before next agent</h2>
                <p className="stepped-hint">
                  Optional: edit the document text below; your changes are sent as the body for subsequent agents.
                </p>
                <textarea
                  className="stepped-textarea"
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  rows={16}
                  spellCheck
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FindingSummary({ result }) {
  if (!result) return <p className="stepped-muted">No result yet.</p>;
  const rows = [
    ['Cleanser', ['cleanser_flags', 'structure_flags', 'content_integrity_flags']],
    ['Conflicts', ['conflicts']],
    ['Terminology', ['terminology_flags']],
    ['Specifier', ['specifying_flags']],
    ['Sequencer', ['sequencing_flags']],
    ['Formatter', ['formatting_flags']],
    ['Risk gaps', ['risk_gaps']],
    ['Validation', ['compliance_flags']],
  ];
  const parts = [];
  for (const [label, keys] of rows) {
    let n = 0;
    for (const k of keys) {
      n += Array.isArray(result[k]) ? result[k].length : 0;
    }
    if (n) parts.push(`${label}: ${n}`);
  }
  if (!parts.length) return <p className="stepped-muted">No structured flags yet for this step.</p>;
  return <ul className="stepped-summary-list">{parts.map((p) => <li key={p}>{p}</li>)}</ul>;
}
