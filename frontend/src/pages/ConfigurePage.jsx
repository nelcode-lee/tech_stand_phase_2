import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, MessageSquare } from 'lucide-react';
import { addInteractionLog, ingestFile, listDocuments, generateWorkInstruction } from '../api';
import PolicyRefSelect from '../components/PolicyRefSelect';
import { PhasePositioningBanner } from '../components/PhasePositioningBanner';
import { isDraftBeta } from '../config/productPhase';
import { useAnalysis } from '../context/AnalysisContext';
import { resolveSitesForApi, SITES_OPTIONS } from '../constants/sites';
import { filterPolicyDocumentsForRef } from '../utils/policyDocuments';
import './ConfigurePage.css';
import './IngestPage.css';

const CONFIG_STORAGE_KEY = 'tech-standards-review-config';
const ALLOWED_EXTENSIONS = ['.docx', '.pdf', '.doc'];
function isAllowedFileName(name) {
  if (!name || !name.includes('.')) return false;
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  return ALLOWED_EXTENSIONS.includes(ext);
}

const REQUEST_TYPES = {
  review: [
    { value: 'single_document_review',  label: 'Single Document Review',   desc: 'Full analysis using all agents' },
    { value: 'harmonisation_review',    label: 'Harmonisation Review',     desc: 'How the document aligns with existing policies' },
    { value: 'principle_layer_review', label: 'Principle Layer Review',   desc: 'Identify if we are capturing enough of the What' },
  ],
  create: [
    { value: 'new_document', label: 'New Document', desc: 'Build a new SOP or principle-layer doc from ingested policies and standards' },
  ],
};

/** Create mode: build new docs from ingested content and policy layer. Principle layer in time. */
const CREATE_DOC_LAYER_OPTIONS = [
  {
    value: 'principle',
    label: 'Principles / Standards',
    desc: 'Design rules that interpret policy (the &quot;What&quot;). Principle layer — being built out; applies to every site.',
  },
  {
    value: 'sop',
    label: 'SOP',
    desc: 'Standard Operating Procedure — built from ingested policies and standards. Full section template, procedural.',
  },
  {
    value: 'work_instruction',
    label: 'Work Instruction',
    desc: 'Step-by-step instructions. Built from ingested content and project logic. Procedural.',
  },
];

export default function ConfigurePage({ mode = 'review' }) {
  const navigate = useNavigate();
  const { config, setConfig, pendingFiles, setPendingFiles, selectedSite } = useAnalysis();
  const base = `/${mode}`;

  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [allDocs, setAllDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const fileInputRef = useRef(null);

  // Work Instruction create-from-scratch flow
  const [wiDraft, setWiDraft] = useState(null);
  const [wiSuggestedId, setWiSuggestedId] = useState(null);
  const [wiLoading, setWiLoading] = useState(false);
  const [wiRefineInput, setWiRefineInput] = useState('');
  const [wiStep, setWiStep] = useState('questionnaire'); // 'questionnaire' | 'draft'
  const [wiForm, setWiForm] = useState({
    taskName: '',
    parentSop: '',
    site: '',
    processType: '',
    hasMeasurements: false,
    measurementsDetail: '',
    hasSafety: false,
    safetyDetail: '',
    needsVisuals: false,
    needsChecklist: true,
  });

  // Fetch document list for review (document picker) and policy-ref dropdown (review + create)
  useEffect(() => {
    if (mode !== 'review' && mode !== 'create') return;
    setLoadingDocs(true);
    listDocuments()
      .then(data => setAllDocs(data || []))
      .catch(() => setAllDocs([]))
      .finally(() => setLoadingDocs(false));
  }, [mode]);

  // Filter docs by current level site (sidebar selector) for review mode
  const filteredDocs = useMemo(() => {
    if (mode !== 'review' || !allDocs.length) return [];
    if (selectedSite === 'all') return [...allDocs];
    return allDocs.filter(d => {
      if (d.doc_layer === 'policy') return true;
      const sites = Array.isArray(d.sites) ? d.sites : (d.sites ? String(d.sites).split(/[,\s]+/).filter(Boolean) : []);
      return sites.includes(selectedSite);
    });
  }, [mode, allDocs, selectedSite]);

  const policyDocsForRef = useMemo(() => filterPolicyDocumentsForRef(allDocs), [allDocs]);

  const isCreate = mode === 'create';
  const isSupportingDocs = mode === 'review';

  const requestTypes = REQUEST_TYPES[mode] || REQUEST_TYPES.review;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${CONFIG_STORAGE_KEY}-${mode}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        setConfig(c => ({
          ...parsed,
          ...c,
          // Do not let saved config overwrite a document just selected from Library/Dashboard.
          documentId: c.documentId || parsed.documentId || '',
          title: c.title || parsed.title || '',
          policyRef: mode === 'review' ? '' : (c.policyRef || parsed.policyRef || ''),
          additionalDocIds:
            Array.isArray(c.additionalDocIds) && c.additionalDocIds.length > 0
              ? c.additionalDocIds
              : (Array.isArray(parsed.additionalDocIds) ? parsed.additionalDocIds : []),
          agentInstructions: c.agentInstructions || parsed.agentInstructions || '',
        }));
      }
    } catch {
      // Ignore parse errors
    }
  }, [mode, setConfig]);

  useEffect(() => {
    if (mode === 'create' && config.requestType !== 'new_document') {
      setConfig(c => ({ ...c, requestType: 'new_document' }));
    }
    if (mode === 'create' && config.docLayer === 'policy') {
      setConfig(c => ({ ...c, docLayer: 'principle' }));
    }
    if (mode === 'review' && !['single_document_review', 'harmonisation_review', 'principle_layer_review'].includes(config.requestType)) {
      setConfig(c => ({ ...c, requestType: 'single_document_review' }));
    }
  }, [mode, config.requestType, config.docLayer, setConfig]);

  function setField(field, value) {
    setConfig(c => ({ ...c, [field]: value }));
  }

  function handleDocumentSelect(value) {
    if (!value) {
      setField('documentId', '');
      setField('title', '');
      return;
    }
    const doc = allDocs.find(d => d.document_id === value);
    if (doc) {
      const sites = Array.isArray(doc.sites) ? doc.sites : [];
      setConfig(c => ({
        ...c,
        documentId: doc.document_id,
        title: doc.title || doc.document_id,
        docLayer: doc.doc_layer || c.docLayer,
        sites: sites.length ? sites : c.sites,
      }));
      setPendingFiles([]);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = e.dataTransfer?.files;
    if (!dropped?.length) return;
    setPendingFiles(prev => [...prev, ...Array.from(dropped)]);
  }

  function handleFileSelect(e) {
    const selected = e.target?.files;
    if (selected?.length) {
      setPendingFiles(prev => [...prev, ...Array.from(selected)]);
    }
    e.target.value = '';
  }

  function removeFile(index) {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }

  function logInteraction(actionType, metadata = {}) {
    addInteractionLog({
      user_name: config?.requester || '',
      action_type: actionType,
      route: `${base}/configure`,
      workflow_mode: mode,
      document_id: config?.documentId || '',
      doc_layer: config?.docLayer || '',
      metadata,
    }).catch(() => {});
  }

  async function handleIngest(e) {
    e.preventDefault();
    setStatus(null);
    try {
      const toStore = {
        requestType: config.requestType,
        documentId: config.documentId,
        docLayer: config.docLayer,
        sites: config.sites,
        policyRef: mode === 'review' ? '' : config.policyRef,
        requester: config.requester,
        mode: config.mode,
        agents: config.agents,
        additionalDocIds: config.additionalDocIds,
        agentInstructions: config.agentInstructions,
      };
      localStorage.setItem(`${CONFIG_STORAGE_KEY}-${mode}`, JSON.stringify(toStore));
    } catch { /* ignore */ }

    const hasUpload = pendingFiles?.length > 0;
    const hasDocId = !!config?.documentId?.trim();
    if (isSupportingDocs && !hasDocId && !hasUpload) {
      setStatus({ ok: false, message: 'Upload the document to review, or enter a document ID if it\'s already in the Library.' });
      return;
    }

    let docIdForNav = config?.documentId?.trim() || '';
    let docTitleForNav = config?.title || docIdForNav;
    let ingestSummary = null;
    if (hasUpload) {
      const bad = pendingFiles.find(f => !isAllowedFileName(f.name));
      if (bad) {
        setStatus({ ok: false, message: `"${bad.name}" is not an allowed type. Use ${ALLOWED_EXTENSIONS.join(', ')}.` });
        return;
      }
      setLoading(true);
      try {
        const sitesArr = Array.isArray(config?.sites) ? config.sites : (config?.sites ? String(config.sites).split(/[,\s]+/).filter(Boolean) : []);
        const sitesForApi = resolveSitesForApi(sitesArr);
        const existingAdditional = Array.isArray(config?.additionalDocIds) ? config.additionalDocIds : [];
        const ingestedIds = [];
        const ingestStats = [];

        for (const f of pendingFiles) {
          const docIdForIngest = f.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-');
          const res = await ingestFile(f, {
            document_id: docIdForIngest,
            doc_layer: config?.docLayer || 'sop',
            sites: sitesForApi,
            policy_ref: mode === 'create' ? (config?.policyRef || undefined) : undefined,
            title: f.name.replace(/\.[^.]+$/, '') || docIdForIngest,
          });
          const finalDocId = res.document_id || docIdForIngest;
          ingestedIds.push(finalDocId);
          ingestStats.push({
            documentId: finalDocId,
            title: res.title || f.name.replace(/\.[^.]+$/, '') || finalDocId,
            chunksIngested: Number(res.chunks_ingested) || 0,
          });
        }

        setPendingFiles([]);

        if (isSupportingDocs) {
          docIdForNav = ingestedIds[0];
          docTitleForNav = pendingFiles[0].name.replace(/\.[^.]+$/, '') || docIdForNav;
          const restAsAdditional = ingestedIds.slice(1);
          const mergedAdditional = [...new Set([...existingAdditional, ...restAsAdditional])];
          setConfig(c => ({ ...c, documentId: docIdForNav, title: docTitleForNav, docLayer: c.docLayer || 'sop', additionalDocIds: mergedAdditional }));
          const stored = JSON.parse(localStorage.getItem(`${CONFIG_STORAGE_KEY}-${mode}`) || '{}');
          localStorage.setItem(`${CONFIG_STORAGE_KEY}-${mode}`, JSON.stringify({ ...stored, documentId: docIdForNav, title: docTitleForNav, docLayer: config?.docLayer || 'sop', additionalDocIds: mergedAdditional }));
        } else {
          docIdForNav = ingestedIds[0];
          docTitleForNav = pendingFiles[0].name.replace(/\.[^.]+$/, '') || docIdForNav;
          setConfig(c => ({ ...c, documentId: docIdForNav, title: docTitleForNav, docLayer: c.docLayer || 'sop' }));
          const stored = JSON.parse(localStorage.getItem(`${CONFIG_STORAGE_KEY}-${mode}`) || '{}');
          localStorage.setItem(`${CONFIG_STORAGE_KEY}-${mode}`, JSON.stringify({ ...stored, documentId: docIdForNav, title: docTitleForNav, docLayer: config?.docLayer || 'sop' }));
        }

        setStatus({ ok: true, message: `Ingested ${ingestedIds.length} document(s).` });
        ingestSummary = {
          fileCount: pendingFiles.length,
          documentCount: ingestedIds.length,
          totalChunks: ingestStats.reduce((sum, item) => sum + (item.chunksIngested || 0), 0),
          primaryDocumentId: ingestedIds[0] || '',
          primaryTitle: pendingFiles[0]?.name?.replace(/\.[^.]+$/, '') || ingestedIds[0] || '',
          items: ingestStats,
        };
        logInteraction('ingest_success', {
          file_count: pendingFiles.length,
          files: pendingFiles.map(f => f.name),
          ingested_ids: ingestedIds,
        });
      } catch (err) {
        setStatus({ ok: false, message: err.message || 'Ingest failed' });
        logInteraction('ingest_failed', {
          file_count: pendingFiles.length,
          files: pendingFiles.map(f => f.name),
          error: err.message || 'Ingest failed',
        });
        setLoading(false);
        return;
      } finally {
        setLoading(false);
      }
    }

    const docId = docIdForNav;
    const analyseUrl = docId ? `${base}/analyse/overview?documentId=${encodeURIComponent(docId)}` : `${base}/analyse/overview`;
    navigate(analyseUrl, {
      state: {
        fromIngest: true,
        documentId: docId,
        title: docTitleForNav,
        docLayer: config?.docLayer || 'sop',
        ingestSummary,
      },
      replace: true,
    });
  }

  function goToAnalyse() {
    const docId = config?.documentId?.trim() || '';
    const url = docId ? `${base}/analyse/overview?documentId=${encodeURIComponent(docId)}` : `${base}/analyse/overview`;
    navigate(url, { state: docId ? { fromIngest: false, documentId: docId, title: config?.title || docId, docLayer: config?.docLayer || 'sop' } : undefined });
  }

  const isWiCreate = isCreate && config?.docLayer === 'work_instruction';

  async function handleWiGenerate() {
    const taskName = (wiForm.taskName || '').trim();
    if (!taskName) {
      setStatus({ ok: false, message: 'Task name is required.' });
      return;
    }
    setWiLoading(true);
    setStatus(null);
    try {
      const res = await generateWorkInstruction({
        task_name: taskName,
        parent_sop: wiForm.parentSop || undefined,
        site: wiForm.site || (Array.isArray(config.sites) ? config.sites[0] : config.sites) || undefined,
        process_type: wiForm.processType || undefined,
        has_measurements: wiForm.hasMeasurements,
        measurements_detail: wiForm.measurementsDetail || undefined,
        has_safety: wiForm.hasSafety,
        safety_detail: wiForm.safetyDetail || undefined,
        needs_visuals: wiForm.needsVisuals,
        needs_checklist: wiForm.needsChecklist,
        reference_doc_ids: (config.additionalDocIds || []).length > 0 ? config.additionalDocIds : undefined,
      });
      setWiDraft(res.draft || '');
      setWiSuggestedId(res.suggested_document_id || `WI-${taskName.replace(/\s+/g, '-')}`);
      setWiStep('draft');
      setConfig(c => ({ ...c, documentId: res.suggested_document_id || c.documentId, title: taskName }));
      setStatus({ ok: true, message: 'Work Instruction generated. Review below and refine if needed.' });
    } catch (err) {
      setStatus({ ok: false, message: err.message || 'Generation failed' });
    } finally {
      setWiLoading(false);
    }
  }

  async function handleWiRefine() {
    const msg = (wiRefineInput || '').trim();
    if (!msg || !wiDraft) return;
    setWiLoading(true);
    setStatus(null);
    try {
      const res = await generateWorkInstruction({
        task_name: wiForm.taskName,
        follow_up_message: msg,
        previous_draft: wiDraft,
        reference_doc_ids: (config.additionalDocIds || []).length > 0 ? config.additionalDocIds : undefined,
      });
      setWiDraft(res.draft || wiDraft);
      setWiRefineInput('');
      setStatus({ ok: true, message: 'Draft updated with your refinements.' });
    } catch (err) {
      setStatus({ ok: false, message: err.message || 'Refinement failed' });
    } finally {
      setWiLoading(false);
    }
  }

  function handleWiProceedToAnalyse() {
    if (!wiDraft) return;
    const docId = wiSuggestedId || config?.documentId || `WI-${Date.now()}`;
    const title = wiForm.taskName || config?.title || docId;
    const sites = wiForm.site ? [wiForm.site] : (config?.sites || []);
    setConfig(c => ({ ...c, documentId: docId, title, sites }));
    const url = `${base}/analyse/overview${docId ? `?documentId=${encodeURIComponent(docId)}` : ''}`;
    navigate(url, {
      state: { generatedContent: wiDraft, documentId: docId, title, docLayer: 'work_instruction', sites },
      replace: true,
    });
  }

  return (
    <div className="configure-page">
      <div className="configure-top-bar">
        <h1 className="configure-title">
          {mode === 'create' ? 'Create a Document' : 'Review a Document'}
        </h1>
        <div className="configure-top-actions">
          <button type="button" className="configure-top-btn" onClick={() => navigate('/dashboard')}>
            ← Back
          </button>
          {!isWiCreate && (
          <button type="button" className="configure-top-btn primary next-action" onClick={goToAnalyse}>
            Go to Analyse
          </button>
          )}
        </div>
      </div>
      {mode === 'create' ? (
        <PhasePositioningBanner variant="banner" className="configure-phase-banner" />
      ) : (
        <PhasePositioningBanner variant="compact" className="configure-phase-banner" />
      )}
      <div className="configure-header">
        <div className="workflow-hint workflow-hint-inline" role="status">
          <span className="workflow-hint-label">Workflow</span>
          <span className="workflow-hint-text">
            {mode === 'create'
              ? <>You are here: <strong>Configure</strong>. Next: <strong>Analyse</strong> → <strong>Governance &amp; sign-off</strong> → optional <strong>Draft for HITL</strong> (assistive text only) → <strong>Submit to Library</strong> as a staging step. {isDraftBeta && <em> Create flow is labelled beta.</em>}</>
              : <>You are here: <strong>Configure</strong>. Primary path: <strong>Analyse</strong> for findings, then <strong>Governance &amp; sign-off</strong> for dispositions and formal review. Draft and submit remain optional assistive steps — not a controlled document release.</>}
          </span>
        </div>
        <p className="configure-subtitle">
          {mode === 'create'
            ? 'Experimental assistive authoring: proposed structure and text from ingested standards and policies — not an approved template and not for publication without local governance.'
            : '1. Pick a document from Library (or upload to add it). 2. Set options below. 3. Run analysis. Documents come from your ingested store until SharePoint is connected.'}
        </p>
      </div>

      <form onSubmit={e => { e.preventDefault(); if (isWiCreate) return; handleIngest(e); }} className="configure-form">

        {/* Request type — create only; review always uses single_document_review (Review SOP) */}
        {mode === 'create' && (
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
        )}

        {/* Document details */}
        <section className="config-section">
          <h3 className="config-section-title">
            {mode === 'create' ? 'Document Type & Format' : 'Document Details'}
          </h3>
          {mode === 'create' && !isWiCreate && (
            <p className="config-section-hint">
              Build new SOPs or principle-layer docs using ingested content and project logic. The <strong>policy layer</strong> underpins all documents; we adhere to it. The <strong>principle layer</strong> (design rules — the &quot;What&quot;) is being built out; procedures and work instructions are the procedural &quot;How&quot;.
            </p>
          )}
          {isWiCreate && (
            <p className="config-section-hint">
              Work Instructions are step-by-step guides for one specific task — like a YouTube tutorial. Answer the questions below; the agent will generate a first draft from policy context. You can refine it via chat before running full analysis.
            </p>
          )}
          {mode === 'review' && (
            <p className="config-section-hint">
              Choose a document already in Library, or select &quot;Add new document (upload)&quot; and upload a file below. This is your ingested document store (SharePoint not yet connected).
            </p>
          )}
          <div className="config-fields">
            {mode === 'create' ? (
              <div className="form-row">
                <label>Document Type</label>
                <div className="doc-type-grid">
                  {CREATE_DOC_LAYER_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`doc-type-btn ${config.docLayer === opt.value ? 'active' : ''}`}
                      onClick={() => { setField('docLayer', opt.value); if (opt.value !== 'work_instruction') setWiStep('questionnaire'); }}
                    >
                      <span className="doc-type-label">{opt.label}</span>
                      <span className="doc-type-desc">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Work Instruction questionnaire — create from scratch */}
            {isWiCreate && wiStep === 'questionnaire' && (
              <div className="wi-questionnaire">
                <div className="form-row">
                  <label>Task name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Prepare béchamel sauce, Torque settings for assembly"
                    value={wiForm.taskName}
                    onChange={e => setWiForm(f => ({ ...f, taskName: e.target.value }))}
                  />
                </div>
                <div className="form-row">
                  <label>Parent SOP (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. GEN-OP-17-Vehicle-Loading"
                    value={wiForm.parentSop}
                    onChange={e => setWiForm(f => ({ ...f, parentSop: e.target.value }))}
                  />
                </div>
                <div className="form-row">
                  <label>Site / area</label>
                  <input
                    type="text"
                    placeholder="e.g. Yorkshire Baker, Production Hall A"
                    value={wiForm.site}
                    onChange={e => setWiForm(f => ({ ...f, site: e.target.value }))}
                  />
                </div>
                <div className="form-row">
                  <label>Process type</label>
                  <select value={wiForm.processType} onChange={e => setWiForm(f => ({ ...f, processType: e.target.value }))}>
                    <option value="">— Select —</option>
                    <option value="manufacturing">Manufacturing</option>
                    <option value="quality">Quality</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="hygiene">Hygiene</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-row wi-check-row">
                  <label>
                    <input type="checkbox" checked={wiForm.hasMeasurements} onChange={e => setWiForm(f => ({ ...f, hasMeasurements: e.target.checked }))} />
                    Measurements / tolerances / timing required
                  </label>
                  {wiForm.hasMeasurements && (
                    <input
                      type="text"
                      placeholder="e.g. Torque 12 Nm, temperature 2–5 °C"
                      value={wiForm.measurementsDetail}
                      onChange={e => setWiForm(f => ({ ...f, measurementsDetail: e.target.value }))}
                      className="wi-detail-input"
                    />
                  )}
                </div>
                <div className="form-row wi-check-row">
                  <label>
                    <input type="checkbox" checked={wiForm.hasSafety} onChange={e => setWiForm(f => ({ ...f, hasSafety: e.target.checked }))} />
                    Safety / PPE required
                  </label>
                  {wiForm.hasSafety && (
                    <input
                      type="text"
                      placeholder="e.g. Gloves, safety glasses"
                      value={wiForm.safetyDetail}
                      onChange={e => setWiForm(f => ({ ...f, safetyDetail: e.target.value }))}
                      className="wi-detail-input"
                    />
                  )}
                </div>
                <div className="form-row wi-check-row">
                  <label>
                    <input type="checkbox" checked={wiForm.needsVisuals} onChange={e => setWiForm(f => ({ ...f, needsVisuals: e.target.checked }))} />
                    Include placeholders for diagrams / photos
                  </label>
                </div>
                <div className="form-row wi-check-row">
                  <label>
                    <input type="checkbox" checked={wiForm.needsChecklist} onChange={e => setWiForm(f => ({ ...f, needsChecklist: e.target.checked }))} />
                    Include verification checklist
                  </label>
                </div>
                <div className="form-row">
                  <label>Reference documents (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. P-001, GEN-OP-02 (comma-separated document IDs from Library)"
                    value={(config.additionalDocIds || []).join(', ')}
                    onChange={e => {
                      const ids = e.target.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
                      setField('additionalDocIds', ids);
                    }}
                  />
                  <span className="form-hint">Ingested policies or SOPs to use as source material.</span>
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
                <div className="wi-generate-actions">
                  <button type="button" className="configure-next-btn primary" onClick={handleWiGenerate} disabled={wiLoading}>
                    {wiLoading ? 'Generating…' : 'Generate Work Instruction'}
                  </button>
                </div>
              </div>
            )}

            {/* Work Instruction draft + refine */}
            {isWiCreate && wiStep === 'draft' && (
              <div className="wi-draft-panel">
                <div className="wi-draft-preview">
                  <h4>Generated draft</h4>
                  <pre className="wi-draft-text">{wiDraft}</pre>
                </div>
                <div className="wi-refine-block">
                  <label><MessageSquare size={16} /> Anything else? Add refinements below</label>
                  <div className="wi-refine-row">
                    <input
                      type="text"
                      placeholder="e.g. Add a note about stirring to avoid lumps"
                      value={wiRefineInput}
                      onChange={e => setWiRefineInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleWiRefine(); }}
                    />
                    <button type="button" className="wi-refine-btn" onClick={handleWiRefine} disabled={wiLoading || !wiRefineInput.trim()}>
                      {wiLoading ? '…' : 'Refine'}
                    </button>
                  </div>
                </div>
                <div className="wi-proceed-row">
                  <button type="button" className="configure-next-btn primary" onClick={handleWiProceedToAnalyse}>
                    Proceed to Analyse
                  </button>
                  <button type="button" className="configure-top-btn" onClick={() => setWiStep('questionnaire')}>
                    Start over
                  </button>
                </div>
              </div>
            )}

            {!isWiCreate && (
            <>
            <div className="form-row">
              <label>Document</label>
              {mode === 'review' ? (
                <>
                  <select
                    value={config.documentId || ''}
                    onChange={e => handleDocumentSelect(e.target.value)}
                    disabled={loadingDocs}
                  >
                    <option value="">Add new document (upload)</option>
                    {filteredDocs.map(d => (
                      <option key={d.document_id} value={d.document_id}>
                        {d.title || d.document_id}
                        {d.document_id !== (d.title || d.document_id) ? ` — ${d.document_id}` : ''}
                      </option>
                    ))}
                  </select>
                  {loadingDocs ? (
                    <span className="form-hint">Loading documents…</span>
                  ) : selectedSite !== 'all' ? (
                    <span className="form-hint">Documents for {selectedSite}</span>
                  ) : null}
                </>
              ) : (
                <input
                  type="text"
                  placeholder="e.g. GEN-OP-01-Goods-In, CMS-v2"
                  value={config.documentId || ''}
                  onChange={e => setField('documentId', e.target.value)}
                />
              )}
            </div>
            {mode !== 'create' && (
              <div className="form-row">
                <label>Document Layer</label>
                <select value={config.docLayer || 'sop'} onChange={e => setField('docLayer', e.target.value)}>
                  <option value="policy">Policy</option>
                  <option value="policy_brcgs">BRCGS</option>
                  <option value="policy_cranswick">Cranswick Standards</option>
                  <option value="principle">Principle</option>
                  <option value="sop">SOP</option>
                  <option value="work_instruction">Work Instruction</option>
                </select>
              </div>
            )}
            {mode === 'review' && (
              <div className="form-row">
                <label>Site</label>
                <select
                  value={Array.isArray(config.sites) && config.sites.length === 1 ? config.sites[0] : (config.sites?.[0] || 'all')}
                  onChange={e => setField('sites', [e.target.value])}
                >
                  {SITES_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <span className="form-hint">Site this document belongs to. Used for ingest and dashboard filtering.</span>
              </div>
            )}
            {mode === 'review' ? (
              <div className="form-row">
                <label>Policies applied</label>
                <p className="form-hint policy-auto-hint">
                  Reviews always use <strong>all applicable ingested standards</strong>:{' '}
                  <strong>Cranswick Manufacturing Standard</strong> and <strong>BRCGS Food Safety</strong>{' '}
                  (relevant clauses from your library). No policy selection needed.
                </p>
              </div>
            ) : (
              <div className="form-row">
                <label htmlFor="config-policy-ref">Policy Reference</label>
                <PolicyRefSelect
                  id="config-policy-ref"
                  value={config.policyRef || ''}
                  onChange={(v) => setField('policyRef', v)}
                  policyDocs={policyDocsForRef}
                  hint="Same picker for BRCGS and Cranswick MS: choose a policy from the library or type its document ID."
                />
              </div>
            )}
            <div className="form-row">
              <label>Requester</label>
              <input
                type="text"
                placeholder="Your name (logged with findings)"
                value={config.requester || ''}
                onChange={e => setField('requester', e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>{mode === 'create' ? 'Relevant documents' : 'Additional relevant documents'}</label>
              <input
                type="text"
                placeholder="e.g. P-001, GEN-OP-02 (comma-separated document IDs from Library)"
                value={(config.additionalDocIds || []).join(', ')}
                onChange={e => {
                  const ids = e.target.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
                  setField('additionalDocIds', ids);
                }}
              />
              <span className="form-hint">
                {mode === 'create'
                  ? 'Ingested policies or standards from the Library to use as source material for this new document. Comma-separated document IDs.'
                  : 'Reference documents to tighten guardrails and find anomalies. Document IDs from the Library.'}
              </span>
            </div>
            <div className="form-row">
              <label>Agent instructions</label>
              <textarea
                placeholder="e.g. Site-specific context, known constraints, or knowledge the agents may find useful. Never supersedes policy."
                value={config.agentInstructions || ''}
                onChange={e => setField('agentInstructions', e.target.value)}
                rows={3}
                className="config-textarea"
              />
              <span className="form-hint">Additional knowledge for agents (site context, constraints, etc.). Policy and standards always take precedence.</span>
            </div>
            </>
            )}
          </div>
        </section>

        {/* Supporting docs / reference materials upload — hide for WI create-from-scratch */}
        {!isWiCreate && (
        <section className="config-section">
          <h3 className="config-section-title">
            {isCreate ? 'Reference Materials' : 'Document to Review'}
          </h3>
          <p className="config-section-hint">
            {isCreate
              ? 'Add policies, standards, or example documents to inform the draft.'
              : 'Upload the document to review. First file is the main document; additional files are reference docs for guardrails.'}
          </p>
          <label
            className={`upload-zone ${dragOver ? 'drag-over' : ''} ${pendingFiles?.length ? 'has-file' : ''}`}
            htmlFor="config-upload-input"
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            tabIndex={-1}
          >
            <Upload className="upload-icon" size={36} />
            <p>Drag and drop, or click to browse</p>
            <span className="upload-formats">PDF, DOCX, DOC, TXT</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.pdf,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain"
              multiple
              onChange={handleFileSelect}
              className="upload-input"
              id="config-upload-input"
            />
            {pendingFiles?.length > 0 && (
              <div className="upload-file-list" onClick={e => e.stopPropagation()}>
                {pendingFiles.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="upload-filename">
                    {f.name}
                    <button type="button" className="upload-remove" onClick={() => removeFile(i)} aria-label="Remove"><X size={14} /></button>
                  </span>
                ))}
              </div>
            )}
          </label>
        </section>
        )}

        {loading && (
          <div className="ingest-progress-wrap">
            <div className="ingest-progress-bar" />
            <p className="ingest-progress-text">Processing documents — chunking and embedding…</p>
          </div>
        )}

        {status && (
          <div className={`upload-status ${status.ok ? 'success' : 'error'}`}>
            {status.message}
          </div>
        )}

        {!isWiCreate && (
        <div className="configure-footer">
          <button type="submit" className="configure-next-btn next-action" disabled={loading}>
            {loading
              ? (isCreate ? 'Creating…' : 'Ingesting…')
              : isCreate
                ? 'Create'
                : (config.documentId && !pendingFiles?.length) ? 'Continue to Analyse' : 'Ingest'}
          </button>
        </div>
        )}
      </form>
    </div>
  );
}
