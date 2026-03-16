import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { analyse, saveAnalysisSession, getAnalysisSession, getDocumentContent, getDocumentFile, addFindingNote, validateSolution, docLayerForApi } from '../api';
import mammoth from 'mammoth';
import { useAnalysis } from '../context/AnalysisContext';
import { resolveSitesForApi } from '../constants/sites';
import { Save } from 'lucide-react';
import './AnalysePage.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FMEA_BAND_CLASS = {
  critical: 'fmea-critical',
  high:     'fmea-high',
  medium:   'fmea-medium',
  low:      'fmea-low',
};

const SEV_CLASS = {
  high:   'sev-high',
  medium: 'sev-medium',
  low:    'sev-low',
};

const INTEGRITY_TYPE_LABELS = {
  non_text_element:    'Non-text element',
  truncated_step:      'Truncated step',
  fragmented_sentence: 'Fragment',
  incomplete_list:     'Incomplete list',
  us_spelling:         'US spelling',
  encoding_anomaly:    'Encoding anomaly',
};

// Group an array of objects by a key value
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'other';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

// Flag count key -> section id for scroll target (metric tiles)
const FLAG_KEY_TO_SECTION_ID = {
  'risk gaps': 'agent-card-risk',
  'specifying': 'agent-card-specifying',
  'structure': 'agent-card-structure',
  'content integrity': 'agent-card-content-integrity',
  'sequencing': 'agent-card-sequencing',
  'formatting': 'agent-card-formatting',
  'compliance': 'agent-card-compliance',
  'terminology': 'agent-card-terminology',
  'conflicts': 'agent-card-conflict',
};

// Agent key (from findingId) -> flag count key (for tracking applied by metric)
const AGENT_KEY_TO_FLAG = {
  'risk': 'risk gaps',
  'structure': 'structure',
  'content-integrity': 'content integrity',
  'specifying': 'specifying',
  'sequencing': 'sequencing',
  'formatting': 'formatting',
  'compliance': 'compliance',
  'terminology': 'terminology',
  'conflict': 'conflicts',
};

// Flag count key -> agent display name (for Proposed Solutions filter)
const FLAG_KEY_TO_AGENT = {
  'risk gaps': 'Risk',
  'structure': 'Structure',
  'content integrity': 'Content Integrity',
  'specifying': 'Specifying',
  'sequencing': 'Sequencing',
  'formatting': 'Formatting',
  'compliance': 'Compliance',
  'terminology': 'Terminology',
  'conflicts': 'Conflict',
};

// Agent display name -> section id for scroll target (Proposed Solutions table)
const AGENT_SECTION_IDS = {
  'Risk': 'agent-card-risk',
  'Structure': 'agent-card-structure',
  'Content Integrity': 'agent-card-content-integrity',
  'Specifying': 'agent-card-specifying',
  'Sequencing': 'agent-card-sequencing',
  'Formatting': 'agent-card-formatting',
  'Compliance': 'agent-card-compliance',
  'Terminology': 'agent-card-terminology',
  'Conflict': 'agent-card-conflict',
};

function scrollToSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('proposed-solutions-highlight');
    setTimeout(() => el.classList.remove('proposed-solutions-highlight'), 1500);
  }
}

// Find a finding by id from result (for apply-to-draft)
function findFindingById(result, id, findingIdFn) {
  const agents = [
    { key: 'risk', items: result.risk_gaps },
    { key: 'structure', items: result.structure_flags },
    { key: 'specifying', items: result.specifying_flags },
    { key: 'sequencing', items: result.sequencing_flags },
    { key: 'formatting', items: result.formatting_flags },
    { key: 'compliance', items: result.compliance_flags },
    { key: 'terminology', items: result.terminology_flags },
    { key: 'conflict', items: result.conflicts },
  ];
  for (const { key, items } of agents) {
    if (!items) continue;
    for (const item of items) {
      if (findingIdFn(key, item) === id) return { agentKey: key, item };
    }
  }
  // Content integrity uses agentKey:ftype (IntegrityGroup passes "content-integrity:ftype")
  for (const flag of result.content_integrity_flags || []) {
    for (const ftype of ['non_text_element', 'truncated_step', 'fragmented_sentence', 'incomplete_list', 'us_spelling', 'encoding_anomaly']) {
      const compositeKey = `content-integrity:${ftype}`;
      if (findingIdFn(compositeKey, flag) === id) return { agentKey: 'content-integrity', item: flag };
    }
  }
  return null;
}

// Get excerpt text for validate-solution API (original context for the finding).
function getExcerptForValidation(agentKey, item) {
  if (agentKey === 'risk') return item.excerpt || item.location || '';
  if (agentKey === 'structure') return item.section || item.detail || '';
  if (agentKey === 'content-integrity') return item.excerpt || item.location || item.detail || '';
  if (agentKey === 'specifying') return item.current_text || item.location || '';
  if (agentKey === 'sequencing') return item.excerpt || item.location || '';
  if (agentKey === 'formatting') return item.excerpt || item.location || item.issue || '';
  if (agentKey === 'compliance') return item.excerpt || item.location || item.issue || '';
  if (agentKey === 'terminology') return item.location || item.term || '';
  if (agentKey === 'conflict') return item.description || '';
  return item.excerpt || item.current_text || item.location || item.detail || '';
}

// Get search text and replacement for a finding (for apply-to-draft). replacementOverride = custom solution when provided.
function getSearchAndReplacement(agentKey, item, replacementOverride = undefined) {
  const rec = (replacementOverride != null && String(replacementOverride).trim() !== '')
    ? String(replacementOverride).trim()
    : (item.recommendation || '');
  if (!rec) return null;
  let search = '';
  if (agentKey === 'risk') search = item.excerpt || item.location || '';
  else if (agentKey === 'structure') search = item.section || item.detail || '';
  else if (agentKey === 'content-integrity') search = item.excerpt || item.location || item.detail || '';
  else if (agentKey === 'specifying') search = item.current_text || item.location || '';
  else if (agentKey === 'sequencing') search = item.excerpt || item.location || '';
  else if (agentKey === 'formatting') search = item.excerpt || item.location || item.issue || '';
  else if (agentKey === 'compliance') search = item.excerpt || item.location || item.issue || '';
  else if (agentKey === 'terminology') search = item.location || item.term || '';
  else if (agentKey === 'conflict') search = item.description || '';
  search = (search || '').trim();
  if (!search || search.length < 2) return null;
  return { search, replacement: rec };
}

// Apply a single finding to draft content (first occurrence, case-sensitive)
function applyFindingToDraft(draft, search, replacement) {
  if (!draft || !search) return draft;
  const idx = draft.indexOf(search);
  if (idx === -1) return draft;
  return draft.slice(0, idx) + replacement + draft.slice(idx + search.length);
}

// Flatten all findings into a unified Proposed Solutions list
// searchText: best string to search for in original doc (excerpt > current_text > location)
function buildProposedSolutions(result) {
  const solutions = [];
  const push = (agent, current, proposal, searchText) => {
    if (proposal) solutions.push({
      agent,
      current: current || '—',
      proposal,
      sectionId: AGENT_SECTION_IDS[agent],
      searchText: searchText || current || '',
    });
  };

  (result.risk_gaps || []).forEach(g => push('Risk', [g.location, g.issue].filter(Boolean).join(' · '), g.recommendation, g.excerpt || g.location));
  (result.structure_flags || []).forEach(f => push('Structure', [f.section, f.detail].filter(Boolean).join(' — '), f.recommendation, f.section));
  (result.content_integrity_flags || []).forEach(f => push('Content Integrity', [f.location, f.detail].filter(Boolean).join(' · ') || f.excerpt, f.recommendation, f.excerpt || f.location));
  (result.specifying_flags || []).forEach(f => push('Specifying', [f.location, f.current_text, f.issue].filter(Boolean).join(' · '), f.recommendation, f.current_text || f.location));
  (result.sequencing_flags || []).forEach(f => push('Sequencing', [f.location, f.issue, f.impact].filter(Boolean).join(' · '), f.recommendation, f.excerpt || f.location));
  (result.formatting_flags || []).forEach(f => push('Formatting', [f.location, f.issue].filter(Boolean).join(' · '), f.recommendation, f.excerpt || f.location));
  (result.compliance_flags || []).forEach(f => push('Compliance', [f.location, f.issue].filter(Boolean).join(' · '), f.recommendation, f.excerpt || f.location));
  (result.terminology_flags || []).forEach(f => push('Terminology', [f.term, f.location, f.issue].filter(Boolean).join(' · '), f.recommendation, f.location || f.term));
  (result.conflicts || []).forEach(c => push('Conflict', [c.conflict_type, c.description].filter(Boolean).join(' — '), c.recommendation, c.description));

  return solutions;
}

// Render a single FMEA score bar (score 0–125, displayed as 20-segment bar)
function FmeaBar({ score, band }) {
  if (!score || !band) return null;
  const filled = Math.min(20, Math.round(score / 6.25));
  const empty = 20 - filled;
  return (
    <span className={`fmea-bar ${FMEA_BAND_CLASS[band] || ''}`} title={`FMEA ${band} — score ${score}`}>
      {'█'.repeat(filled)}{'░'.repeat(empty)}
      <span className="fmea-band-label">{band.toUpperCase()} {score}</span>
    </span>
  );
}

// Severity pill used by structure flags and content integrity flags
function SevPill({ severity }) {
  if (!severity) return null;
  return (
    <span className={`sev-pill ${SEV_CLASS[severity] || ''}`}>
      {severity.toUpperCase()}
    </span>
  );
}

// Apply / Add note buttons for findings — used when building updated procedure doc
function FindingActions({ id, agentKey, item, onApplyChange, onAddNote, isApplied, customSolution, onCustomSolutionChange, onCheckWithAgent, validateFeedback, isChecking }) {
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteAttachments, setNoteAttachments] = useState([]); // [{ name, contentType, dataBase64 }]
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [modalPos, setModalPos] = useState(null); // { left, top } or null = centered
  const fileInputRef = useRef(null);
  const modalRef = useRef(null);
  const dragRef = useRef(null);

  if (!onApplyChange || !onAddNote) return null;
  const handleOpenNote = () => {
    setNoteText('');
    setNoteAttachments([]);
    setModalPos(null);
    setNoteModalOpen(true);
  };
  const handleHeaderMouseDown = (e) => {
    if (e.button !== 0 || !modalRef.current) return;
    const rect = modalRef.current.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: rect.left, startTop: rect.top };
    const onMove = (ev) => {
      if (!dragRef.current) return;
      setModalPos({
        left: dragRef.current.startLeft + (ev.clientX - dragRef.current.startX),
        top: dragRef.current.startTop + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  const handleFileChange = async (e) => {
    const files = Array.from(e.target?.files || []);
    if (!files.length) return;
    const newAttachments = [];
    for (const f of files) {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const b = r.result;
          resolve(typeof b === 'string' && b.startsWith('data:') ? b.split(',')[1] : null);
        };
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      if (base64) newAttachments.push({ name: f.name, contentType: f.type || 'application/octet-stream', dataBase64: base64 });
    }
    setNoteAttachments(prev => [...prev, ...newAttachments]);
    e.target.value = '';
  };
  const removeAttachment = (idx) => setNoteAttachments(prev => prev.filter((_, i) => i !== idx));
  const handleSaveNote = async () => {
    const trimmed = (noteText || '').trim();
    if (!trimmed && noteAttachments.length === 0) return;
    setNoteSubmitting(true);
    try {
      await onAddNote(id, agentKey, item, trimmed || '(attachment only)', noteAttachments);
      setNoteModalOpen(false);
      setNoteText('');
      setNoteAttachments([]);
    } catch (e) {
      console.error('Failed to save finding note:', e);
    } finally {
      setNoteSubmitting(false);
    }
  };

  const solutionValue = (customSolution != null && customSolution !== '') ? customSolution : (item.recommendation || '');
  const displayValue = customSolution ?? '';

  return (
    <div className="finding-actions" onClick={e => e.stopPropagation()}>
      {onCustomSolutionChange && (
        <div className="finding-solution-edit">
          <label className="finding-solution-label">Solution (editable)</label>
          <textarea
            className="finding-solution-textarea"
            value={displayValue}
            onChange={e => onCustomSolutionChange(id, e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            placeholder={item.recommendation || 'Type or edit the solution to apply…'}
            rows={2}
          />
          {validateFeedback != null && (
            <div className="finding-validate-feedback">{validateFeedback}</div>
          )}
        </div>
      )}
      <div className="finding-action-buttons-row">
        {onCheckWithAgent && (
          <button
            type="button"
            className="finding-action-btn check-agent"
            onClick={() => onCheckWithAgent(id, agentKey, item, solutionValue)}
            disabled={isChecking}
            title="Re-validate this solution with the agent"
          >
            {isChecking ? 'Checking…' : 'Check with agent'}
          </button>
        )}
        <button
          type="button"
          className={`finding-action-btn apply ${isApplied ? 'applied' : ''}`}
          onClick={() => onApplyChange(id)}
          title="Add this change to the updated procedure"
        >
          {isApplied ? 'Update Applied ✓' : 'Apply Update'}
        </button>
        <button
          type="button"
          className="finding-action-btn add-note"
          onClick={handleOpenNote}
title="Log feedback for agents (used in future runs)"
      >
        Agent Feedback
        </button>
      </div>
      {noteModalOpen && (
        <div className="finding-note-modal-overlay" onClick={() => setNoteModalOpen(false)}>
          <div
            ref={modalRef}
            className="finding-note-modal finding-note-modal-draggable"
            style={modalPos ? { left: modalPos.left, top: modalPos.top } : undefined}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
          >
            <h4 className="finding-note-modal-header" onMouseDown={handleHeaderMouseDown} role="button" tabIndex={0} title="Drag to move">
              Agent Feedback
            </h4>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Enter your note…"
              rows={4}
              autoFocus
            />
            <div className="finding-note-attachments">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx,.txt"
                multiple
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <button type="button" className="doc-btn finding-note-add-file" onClick={() => fileInputRef?.current?.click()}>
                Add image or file
              </button>
              {noteAttachments.length > 0 && (
                <ul className="finding-note-attachment-list">
                  {noteAttachments.map((a, i) => (
                    <li key={i}>
                      <span className="finding-note-attachment-name">{a.name}</span>
                      <button type="button" className="finding-note-remove-attachment" onClick={() => removeAttachment(i)} aria-label="Remove">×</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="finding-note-modal-actions">
              <button type="button" className="doc-btn" onClick={() => setNoteModalOpen(false)}>Cancel</button>
              <button type="button" className="doc-btn primary" onClick={handleSaveNote} disabled={(!noteText.trim() && noteAttachments.length === 0) || noteSubmitting}>
                {noteSubmitting ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalysePage({ mode = 'review', step = 'overview' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const documentIdFromUrl = searchParams.get('documentId');
  const titleFromUrl = searchParams.get('title');
  const trackingIdFromUrl = searchParams.get('trackingId');
  const storedResultFromState = location.state?.storedResult;
  const sessionFromState = location.state?.session;
  const ctx = useAnalysis();
  const result = ctx?.result ?? null;
  const setResult = ctx?.setResult ?? (() => {});
  const setConfig = ctx?.setConfig ?? (() => {});
  const config = ctx?.config ?? { mode: 'full' };
  const recordSession = ctx?.recordSession ?? (() => {});
  const workflowMode = ctx?.workflowMode ?? mode;
  const base = `/${mode}`;

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStored, setLoadingStored] = useState(!!trackingIdFromUrl);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [error, setError] = useState(null);
  const [sessionNotPersisted, setSessionNotPersisted] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftEditMode, setDraftEditMode] = useState(false);
  const [hitlSubmitStatus, setHitlSubmitStatus] = useState(null); // 'submitted' | 'error' | null
  const [documentContent, setDocumentContent] = useState(null);
  const [documentSections, setDocumentSections] = useState([]);
  const [documentHtml, setDocumentHtml] = useState(null);
  const [documentSourceType, setDocumentSourceType] = useState(null); // 'html' | 'text'
  const [loadingContent, setLoadingContent] = useState(false);
  const [highlightSearch, setHighlightSearch] = useState('');
  const originalDocRef = useRef(null);
  const [appliedFindings, setAppliedFindings] = useState(new Set());
  const [customSolutionByFindingId, setCustomSolutionByFindingId] = useState({}); // { [findingId]: "user typed solution" }
  const [notesAddedByFlag, setNotesAddedByFlag] = useState({}); // { 'risk gaps': 2, ... } — session count
  const [lastAppliedRange, setLastAppliedRange] = useState(null); // { start, end } for highlighting in draft
  const [selectedMetricFilter, setSelectedMetricFilter] = useState(null); // null = show placeholder, else e.g. 'risk gaps'
  const [validateSolutionResult, setValidateSolutionResult] = useState(null); // { findingId, feedback } or null
  const [validatingFindingId, setValidatingFindingId] = useState(null); // id while request in flight

  function findingId(agentKey, item) {
    const str = JSON.stringify(item);
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
    return `${agentKey}:${h}`;
  }

  function handleApplyFinding(id) {
    setAppliedFindings(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleProcessChanges() {
    if (!result || appliedFindings.size === 0) return;
    let currentDraft = draftContent || result?.draft_content || '';
    if (!currentDraft) return;
    const agentOrder = ['risk', 'structure', 'specifying', 'sequencing', 'formatting', 'compliance', 'terminology', 'conflict', 'content-integrity'];
    const collected = [];
    for (const id of appliedFindings) {
      const found = findFindingById(result, id, findingId);
      if (found) collected.push({ id, ...found });
    }
    collected.sort((a, b) => agentOrder.indexOf(a.agentKey) - agentOrder.indexOf(b.agentKey));
    let lastRange = null;
    for (const { id, agentKey, item } of collected) {
      const replacementOverride = customSolutionByFindingId[id];
      const { search, replacement } = getSearchAndReplacement(agentKey, item, replacementOverride);
      if (!search || !replacement) continue;
      const idx = currentDraft.indexOf(search);
      if (idx === -1) continue;
      currentDraft = applyFindingToDraft(currentDraft, search, replacement);
      lastRange = { start: idx, end: idx + replacement.length };
    }
    if (currentDraft !== (draftContent || result?.draft_content || '')) {
      setDraftContent(currentDraft);
      setLastAppliedRange(lastRange);
      navigate(`${base}/analyse/draft`);
    }
  }

  async function handleCheckWithAgent(id, agentKey, item, solutionValue) {
    const excerpt = getExcerptForValidation(agentKey, item);
    setValidatingFindingId(id);
    setValidateSolutionResult(null);
    try {
      const data = await validateSolution(excerpt, solutionValue || item.recommendation || '');
      setValidateSolutionResult({ findingId: id, feedback: data.feedback || '' });
    } catch (e) {
      console.error('Validate solution failed:', e);
      setValidateSolutionResult({ findingId: id, feedback: `Error: ${e.message}` });
    } finally {
      setValidatingFindingId(null);
    }
  }

  async function handleAddNote(findingIdArg, agentKey, item, note, attachments = []) {
    await addFindingNote({
      user_name: config.requester || 'Unknown',
      document_id: effectiveDocId || '',
      tracking_id: result?.tracking_id || '',
      finding_id: findingIdArg,
      finding_summary: typeof item === 'object' ? item : { raw: String(item) },
      agent_key: agentKey,
      note,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    const baseKey = (agentKey || '').split(':')[0];
    const flagKey = AGENT_KEY_TO_FLAG[baseKey] || AGENT_KEY_TO_FLAG[agentKey];
    if (flagKey) {
      setNotesAddedByFlag(prev => ({ ...prev, [flagKey]: (prev[flagKey] || 0) + 1 }));
    }
  }

  // Reset applied, custom solutions, notes count, and highlight when analysis result changes (new run)
  useEffect(() => {
    setAppliedFindings(new Set());
    setCustomSolutionByFindingId({});
    setNotesAddedByFlag({});
    setLastAppliedRange(null);
    setSelectedMetricFilter(null);
    setValidateSolutionResult(null);
    setValidatingFindingId(null);
  }, [result?.tracking_id]);

  const fromIngestState = location.state?.fromIngest && location.state?.documentId;
  // Effective document: URL (from fresh ingest) overrides everything — cannot be overwritten by config/session
  const effectiveDocId = documentIdFromUrl || (location.state?.fromIngest && location.state?.documentId) || config.documentId || '';
  const effectiveTitle = titleFromUrl || (location.state?.fromIngest && location.state?.title) || config.title || config.documentId || '';

  // When arriving from Ingest (state or URL), sync config so it matches the document we're analysing
  useEffect(() => {
    const docId = documentIdFromUrl || (location.state?.fromIngest && location.state?.documentId) || '';
    const docTitle = titleFromUrl || (location.state?.fromIngest && location.state?.title) || docId;
    if (!docId) return;
    setConfig(c => ({ ...c, documentId: docId, title: docTitle }));
  }, [documentIdFromUrl, titleFromUrl, fromIngestState, location.state?.documentId, location.state?.title, setConfig]);

  // When trackingId in URL, use passed result or fetch stored session
  // Do NOT overwrite documentId when documentIdFromUrl is set (fresh ingest takes precedence)
  useEffect(() => {
    if (!trackingIdFromUrl) return;
    // Use result passed from Dashboard (sessionLog) if available — avoids 404 when not in DB
    if (storedResultFromState) {
      setResult(storedResultFromState);
      setDraftContent(storedResultFromState.draft_content || '');
      if (sessionFromState && !documentIdFromUrl) {
        const sitesArr = sessionFromState.sites
          ? (Array.isArray(sessionFromState.sites) ? sessionFromState.sites : String(sessionFromState.sites).split(',').map(s => s.trim()).filter(Boolean))
          : [];
        setConfig(c => ({
          ...c,
          documentId: sessionFromState.documentId || '',
          title: sessionFromState.title || '',
          requester: sessionFromState.requester || '',
          docLayer: sessionFromState.docLayer || 'sop',
          sites: sitesArr,
        }));
      }
      setLoadingStored(false);
      return;
    }
    setLoadingStored(true);
    getAnalysisSession(trackingIdFromUrl)
      .then(session => {
        const res = session?.result;
        if (res) {
          setResult(res);
          setDraftContent(res.draft_content || '');
        } else if (session) {
          setError('Results not stored for this session. Run a new analysis to see findings.');
        }
        if (session && !documentIdFromUrl) {
          const sitesArr = session.sites ? String(session.sites).split(',').map(s => s.trim()).filter(Boolean) : [];
          setConfig(c => ({
            ...c,
            documentId: session.documentId || '',
            title: session.title || '',
            requester: session.requester || '',
            docLayer: session.docLayer || 'sop',
            sites: sitesArr,
          }));
        }
      })
      .catch(() => setError('Could not load analysis results. The session may not be in the database — run a new analysis to see results.'))
      .finally(() => setLoadingStored(false));
  }, [trackingIdFromUrl, documentIdFromUrl, storedResultFromState, sessionFromState, setResult, setConfig]);

  // Fetch original document for split view — DOCX→HTML for procedures, else plain text
  useEffect(() => {
    if (!result || !effectiveDocId) {
      setDocumentContent(null);
      setDocumentSections([]);
      setDocumentHtml(null);
      setDocumentSourceType(null);
      return;
    }
    const docLayer = (config.docLayer || 'sop').toLowerCase();
    const isProcedure = docLayer === 'sop' || docLayer === 'work_instruction';

    setLoadingContent(true);
    setDocumentContent(null);
    setDocumentSections([]);
    setDocumentHtml(null);
    setDocumentSourceType(null);

    async function load() {
      try {
        if (isProcedure) {
          const blob = await getDocumentFile(effectiveDocId);
          if (blob) {
            const arrayBuffer = await blob.arrayBuffer();
            const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
            setDocumentHtml(html || null);
            setDocumentSourceType('html');
            setLoadingContent(false);
            return;
          }
        }
        const data = await getDocumentContent(effectiveDocId);
        setDocumentContent(data?.content || null);
        setDocumentSections(Array.isArray(data?.sections) ? data.sections : []);
        setDocumentSourceType('text');
      } catch {
        setDocumentContent(null);
        setDocumentSections([]);
        setDocumentHtml(null);
        setDocumentSourceType(null);
      } finally {
        setLoadingContent(false);
      }
    }
    load();
  }, [result, effectiveDocId, config.docLayer]);

  // Scroll to specific section or highlight when user clicks a finding
  useEffect(() => {
    if (!highlightSearch || !originalDocRef.current) return;
    const container = originalDocRef.current;
    const search = highlightSearch.trim();
    if (search.length < 2) return;
    const searchLower = search.toLowerCase();

    const doScroll = () => {
      // 1. Try section-based scroll: find section matching the finding
      if (documentSections.length > 0) {
        const findSection = (needle) => documentSections.findIndex(s => {
          const heading = (s.heading || '').toLowerCase();
          const content = (s.content || '').toLowerCase();
          return heading === needle || heading.includes(needle) || content.includes(needle);
        });
        let idx = findSection(searchLower);
        // "Step 3" / "Section 4" — extract number and match "3. X" or "4. X"
        if (idx < 0) {
          const numMatch = searchLower.match(/(?:step|section)\s*(\d+)/);
          if (numMatch) {
            const num = numMatch[1];
            idx = documentSections.findIndex(s => {
              const h = (s.heading || '').toLowerCase();
              return h.startsWith(num + '.') || h.startsWith(num + ' ');
            });
          }
        }
        if (idx < 0 && searchLower.length > 20) {
          const short = searchLower.slice(0, 50).trim();
          if (short.length >= 5) idx = findSection(short);
        }
        if (idx < 0 && searchLower.length > 10) {
          const firstWords = searchLower.split(/\s+/).slice(0, 3).join(' ');
          if (firstWords.length >= 3) idx = findSection(firstWords);
        }
        if (idx >= 0) {
          const target = container.querySelector(`[data-doc-section="${idx}"]`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
      }
      // 2. Fallback: scroll to first highlight in document (after DOM has rendered)
      const highlightEl = container.querySelector('.original-doc-highlight');
      if (highlightEl) highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    // Defer scroll until after React has rendered the highlights
    const t = requestAnimationFrame(() => requestAnimationFrame(doScroll));
    return () => cancelAnimationFrame(t);
  }, [highlightSearch, documentSections]);

  // Scroll to section when navigating from Overview (clicked a metric)
  useEffect(() => {
    const sectionId = location.state?.scrollToSection;
    if (sectionId && (step === 'overview' || step === 'review')) {
      const t = setTimeout(() => scrollToSection(sectionId), 300);
      return () => clearTimeout(t);
    }
  }, [step, location.state?.scrollToSection]);

  async function handleRun(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setSessionNotPersisted(false);
    try {
      const sitesArr = Array.isArray(config.sites) ? config.sites : (config.sites ? String(config.sites).split(/[,\s]+/).filter(Boolean) : []);
      const body = {
        tracking_id: `ui-${Date.now()}`,
        request_type: config.requestType || 'single_document_review',
        doc_layer: docLayerForApi(config.docLayer),
        sites: resolveSitesForApi(sitesArr),
        policy_ref: config.policyRef || null,
        document_id: effectiveDocId || null,
        title: effectiveTitle || effectiveDocId || null,
        requester: config.requester || null,
        query: query || undefined,
        agents: config?.mode && config.mode !== 'full' ? config.agents : undefined,
        additional_doc_ids: (config.additionalDocIds || []).length > 0 ? config.additionalDocIds : undefined,
        agent_instructions: (config.agentInstructions || '').trim() || undefined,
      };
      const res = await analyse(body);
      setResult(res);
      setDraftContent(res.draft_content || '');
      recordSession(res, { ...config, documentId: effectiveDocId, title: effectiveTitle }, workflowMode);
      if (res.session_saved === false) {
        setSessionNotPersisted(true);
      }
      // Auto-save to backend so dashboard reflects metrics
      const totalFindings =
        (res.risk_gaps?.length || 0) + (res.specifying_flags?.length || 0) + (res.structure_flags?.length || 0) +
        (res.content_integrity_flags?.length || 0) + (res.sequencing_flags?.length || 0) + (res.formatting_flags?.length || 0) +
        (res.compliance_flags?.length || 0) + (res.terminology_flags?.length || 0) + (res.conflicts?.length || 0);
      const agentFindings = {};
      if (res.risk_gaps?.length) agentFindings.risk = res.risk_gaps.length;
      if (res.specifying_flags?.length) agentFindings.specifying = res.specifying_flags.length;
      if (res.structure_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + res.structure_flags.length;
      if (res.content_integrity_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + res.content_integrity_flags.length;
      if (res.sequencing_flags?.length) agentFindings.sequencing = res.sequencing_flags.length;
      if (res.formatting_flags?.length) agentFindings.formatting = res.formatting_flags.length;
      if (res.compliance_flags?.length) agentFindings.validation = res.compliance_flags.length;
      if (res.terminology_flags?.length) agentFindings.terminology = res.terminology_flags.length;
      if (res.conflicts?.length) agentFindings.conflict = res.conflicts.length;
      try {
        await saveAnalysisSession({
          tracking_id: res.tracking_id,
          document_id: effectiveDocId || '',
          title: effectiveTitle || effectiveDocId || 'Unnamed',
          doc_layer: docLayerForApi(config.docLayer),
          sites: Array.isArray(config.sites) ? (config.sites.includes('all') ? 'All Sites' : config.sites.join(',')) : (config.sites || ''),
          overall_risk: res.overall_risk || null,
          total_findings: totalFindings,
          agents_run: res.agents_run || [],
          agent_findings: agentFindings,
        });
      } catch (_) { /* non-blocking */ }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const flagCounts = result ? {
    'risk gaps':         result.risk_gaps?.length || 0,
    'specifying':        result.specifying_flags?.length || 0,
    'structure':         result.structure_flags?.length || 0,
    'content integrity': result.content_integrity_flags?.length || 0,
    'sequencing':        result.sequencing_flags?.length || 0,
    'formatting':        result.formatting_flags?.length || 0,
    'compliance':        result.compliance_flags?.length || 0,
    'terminology':       result.terminology_flags?.length || 0,
    'conflicts':         result.conflicts?.length || 0,
  } : null;

  // Applied count per flag key (from finding IDs like "risk:123" or "content-integrity:ftype:456")
  const appliedCountByFlag = (() => {
    const byFlag = {};
    if (!flagCounts) return byFlag;
    for (const key of Object.keys(flagCounts)) byFlag[key] = 0;
    for (const id of appliedFindings) {
      const firstSegment = (id || '').split(':')[0];
      const flagKey = AGENT_KEY_TO_FLAG[firstSegment];
      if (flagKey && byFlag[flagKey] !== undefined) byFlag[flagKey]++;
    }
    return byFlag;
  })();

  const totalFindings = flagCounts ? Object.values(flagCounts).reduce((a, b) => a + b, 0) : 0;
  const totalApplied = Object.values(appliedCountByFlag).reduce((a, b) => a + b, 0);

  const isCreate = mode === 'create';
  const hasDraft = !!result; // Show draft in both modes when analysis has run — apply changes update it
  const displayDraft = draftContent || result?.draft_content || '';

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const sitesDisplay = Array.isArray(config.sites)
        ? (config.sites.includes('all') ? 'All Sites' : config.sites.join(','))
        : (config.sites || '');
      const agentFindings = {};
      if (result.risk_gaps?.length) agentFindings.risk = result.risk_gaps.length;
      if (result.specifying_flags?.length) agentFindings.specifying = (agentFindings.specifying || 0) + result.specifying_flags.length;
      if (result.structure_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + result.structure_flags.length;
      if (result.content_integrity_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + result.content_integrity_flags.length;
      if (result.sequencing_flags?.length) agentFindings.sequencing = result.sequencing_flags.length;
      if (result.formatting_flags?.length) agentFindings.formatting = result.formatting_flags.length;
      if (result.compliance_flags?.length) agentFindings.validation = result.compliance_flags.length;
      if (result.terminology_flags?.length) agentFindings.terminology = result.terminology_flags.length;
      if (result.conflicts?.length) agentFindings.conflict = result.conflicts.length;

      const res = await saveAnalysisSession({
        tracking_id: result.tracking_id,
        document_id: config.documentId || '',
        title: config.title || config.documentId || 'Unnamed',
        requester: config.requester || '',
        doc_layer: docLayerForApi(config.docLayer),
        sites: sitesDisplay,
        overall_risk: result.overall_risk || null,
        total_findings: totalFindings,
        agents_run: result.agents_run || [],
        agent_findings: agentFindings,
        corrections_implemented: totalApplied,
      });
      setSaveStatus(res?.ok !== false ? 'saved' : 'error');
      if (res?.ok !== false) setTimeout(() => setSaveStatus(null), 2500);
    } catch (err) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitForHITL() {
    if (!result) return;
    setHitlSubmitStatus(null);
    try {
      const sitesDisplay = Array.isArray(config.sites)
        ? (config.sites.includes('all') ? 'All Sites' : config.sites.join(','))
        : (config.sites || '');
      const agentFindings = {};
      if (result.risk_gaps?.length) agentFindings.risk = result.risk_gaps.length;
      if (result.specifying_flags?.length) agentFindings.specifying = (agentFindings.specifying || 0) + result.specifying_flags.length;
      if (result.structure_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + result.structure_flags.length;
      if (result.content_integrity_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + result.content_integrity_flags.length;
      if (result.sequencing_flags?.length) agentFindings.sequencing = result.sequencing_flags.length;
      if (result.formatting_flags?.length) agentFindings.formatting = result.formatting_flags.length;
      if (result.compliance_flags?.length) agentFindings.validation = result.compliance_flags.length;
      if (result.terminology_flags?.length) agentFindings.terminology = result.terminology_flags.length;
      if (result.conflicts?.length) agentFindings.conflict = result.conflicts.length;

      await saveAnalysisSession({
        tracking_id: result.tracking_id,
        document_id: config.documentId || '',
        title: config.title || config.documentId || 'Unnamed',
        requester: config.requester || '',
        doc_layer: docLayerForApi(config.docLayer),
        sites: sitesDisplay,
        overall_risk: result.overall_risk || null,
        total_findings: totalFindings,
        agents_run: result.agents_run || [],
        agent_findings: agentFindings,
        corrections_implemented: totalApplied,
      });
      setHitlSubmitStatus('submitted');
      setTimeout(() => setHitlSubmitStatus(null), 3000);
    } catch {
      setHitlSubmitStatus('error');
      setTimeout(() => setHitlSubmitStatus(null), 3000);
    }
  }

  const stepTitles = { overview: 'Analyse', review: 'Analyse', draft: 'Draft for HITL' };
  const stepTitle = stepTitles[step] || step;

  return (
    <div className="analyse-page-layout">
      <div className="doc-header doc-header-outside">
        <div>
          <h2>{stepTitle}</h2>
          <p className="doc-subtitle">
            {(effectiveDocId || effectiveTitle) ? `${[effectiveDocId, effectiveTitle].filter(Boolean).join(' — ')} · ` : ''}
            Agent pipeline · {config.docLayer || 'sop'}
            {config.sites?.length ? ` · ${Array.isArray(config.sites) && config.sites.includes('all') ? 'All Sites' : (Array.isArray(config.sites) ? config.sites.join(', ') : config.sites)}` : ''}
            {config.requester ? ` · Requester: ${config.requester}` : ''}
          </p>
        </div>
        <div className="doc-actions">
          <button type="button" className="doc-btn" onClick={() => navigate(`${base}/configure`)}>← Back</button>
          {step === 'overview' && (
            <button type="submit" form="analyse-form" disabled={loading} className="doc-btn primary next-action">
              {loading ? 'Analysing…' : 'Run Analysis'}
            </button>
          )}
          {step === 'draft' && (
            <>
              <button
                type="button"
                className="doc-btn"
                onClick={() => setDraftEditMode((v) => !v)}
              >
                {draftEditMode ? 'Done editing' : 'Edit draft'}
              </button>
              <button
                type="button"
                className="doc-btn primary next-action"
                onClick={handleSubmitForHITL}
                disabled={!result}
              >
                {hitlSubmitStatus === 'submitted' ? 'Submitted for HITL' : hitlSubmitStatus === 'error' ? 'Error' : 'Submit for HITL'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="analyse-page meatspec-main-content">
      <form id="analyse-form" onSubmit={handleRun} className="analyse-form" style={{ display: step === 'overview' ? 'flex' : 'none' }}>
        {!effectiveDocId && (
          <div className="analyse-no-doc-warning">
            No document selected — analysis will use unfiltered chunks from all documents. Go to Ingest and upload a document, or use Configure to set a document ID.
          </div>
        )}
        <div className="form-row">
          <label>Search query (optional — used for vector retrieval)</label>
          <input
            type="text"
            placeholder="e.g. vehicle loading procedure"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </form>

      {loadingStored && (
        <div className="analyse-loading-overlay">
          <div className="analyse-loading-spinner" />
          <p>Loading analysis results…</p>
        </div>
      )}

      {loading && (
        <div className="analyse-loading-overlay">
          <div className="analyse-loading-spinner" />
          <p>Running analysis — this may take 1–2 minutes…</p>
        </div>
      )}

      {error && <div className="analyse-error">{error}</div>}

      {sessionNotPersisted && (
        <div className="analyse-warning">
          Findings were not saved to the dashboard database. The session will appear in the dashboard for now, but full results may not load when viewing later. Set SUPABASE_DB_URL in the backend to persist sessions.
        </div>
      )}

      {/* Analyse + Review findings (combined): flag counts, summary, and findings */}
      {(step === 'overview' || step === 'review') && result && (
        <div className="analyse-results-wrapper">
          {flagCounts && (
            <div className="flag-metrics-top">
              <div className="metrics-grid">
                {Object.entries(flagCounts)
                  .filter(([key]) => key !== 'content integrity')
                  .map(([key, count]) => {
                  const sectionId = FLAG_KEY_TO_SECTION_ID[key];
                  const applied = appliedCountByFlag[key] || 0;
                  const remaining = Math.max(0, count - applied);
                  const isClickable = count > 0 && sectionId;
                  return (
                    <div
                      key={key}
                      className={`metric${count === 0 ? ' metric-zero' : ''}${isClickable ? ' metric-clickable' : ''}${selectedMetricFilter === key ? ' metric-selected' : ''}`}
                      onClick={isClickable ? () => {
                        const next = selectedMetricFilter === key ? null : key;
                        setSelectedMetricFilter(next);
                        if (next) setTimeout(() => scrollToSection(sectionId), 0);
                      } : undefined}
                      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const next = selectedMetricFilter === key ? null : key; setSelectedMetricFilter(next); if (next) scrollToSection(sectionId); } } : undefined}
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      title={isClickable ? (selectedMetricFilter === key ? 'Show all (click again)' : `Show only ${key}`) : undefined}
                    >
                      <div className="metric-value-row">
                        <span className="metric-value">{remaining}</span>
                        {(applied > 0 || (notesAddedByFlag[key] || 0) > 0) && (
                          <span className="metric-badges">
                            {applied > 0 && (
                              <span className="metric-badge metric-badge-applied" title={`${applied} change(s) accepted`}>+{applied}</span>
                            )}
                            {(notesAddedByFlag[key] || 0) > 0 && (
                              <span className="metric-badge metric-badge-notes" title={`${notesAddedByFlag[key]} note${(notesAddedByFlag[key] || 0) !== 1 ? 's' : ''} added`} aria-label={`${notesAddedByFlag[key]} notes added`}>{notesAddedByFlag[key]}</span>
                            )}
                          </span>
                        )}
                      </div>
                      <span className="metric-label">{key}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flag-metrics-total">
                {selectedMetricFilter ? (
                  <>
                    Showing {(flagCounts[selectedMetricFilter] ?? 0) - (appliedCountByFlag[selectedMetricFilter] || 0)} remaining
                    {appliedCountByFlag[selectedMetricFilter] > 0 && (
                      <span className="flag-metrics-pending"> ({appliedCountByFlag[selectedMetricFilter]} accepted)</span>
                    )}
                    <button type="button" className="metric-show-all" onClick={() => setSelectedMetricFilter(null)}>Show all</button>
                    {totalApplied > 0 && (
                      <button type="button" className="metric-process-btn" onClick={handleProcessChanges}>
                        Process {totalApplied} change{totalApplied !== 1 ? 's' : ''} →
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {totalFindings - totalApplied} remaining
                    {totalApplied > 0 && (
                      <>
                        <span className="flag-metrics-pending"> ({totalApplied} accepted)</span>
                        <button type="button" className="metric-process-btn" onClick={handleProcessChanges}>
                          Process {totalApplied} change{totalApplied !== 1 ? 's' : ''} →
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          <div className="results-summary" style={{ marginTop: 'var(--space-xl)' }}>
            <div className={`risk-badge risk-${result.overall_risk || 'unknown'}`}>
              {result.overall_risk || '—'}
            </div>
            <div className="summary-item">
              <span className="label">Draft ready</span>
              <span className="value">{result.draft_ready ? 'Yes' : 'No'}</span>
            </div>
            <div className="summary-item">
              <span className="label">Agents run</span>
              <span className="value">{result.agents_run?.join(', ') || '—'}</span>
            </div>
          </div>
          {result.glossary_candidates?.length > 0 && (
            <div className="glossary-candidates-banner" style={{ marginTop: 'var(--space-lg)' }}>
              <h4>Add to glossary</h4>
              <p className="glossary-candidates-desc">Vague terminology detected — route to HITL. Consider adding these terms to the standard glossary:</p>
              <ul className="glossary-candidates-list">
                {result.glossary_candidates.map((c, i) => (
                  <li key={i}>
                    <strong>{c.term}</strong>
                    {c.recommendation && <span> — {c.recommendation}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={effectiveDocId ? 'analyse-split-view' : 'analyse-single-column'} style={{ marginTop: 'var(--space-xl)' }}>
            {effectiveDocId && (
              <div className="analyse-split-left" ref={originalDocRef}>
                <h3 className="split-panel-title">Original Document</h3>
                {loadingContent && <p className="split-loading">Loading document…</p>}
                {!loadingContent && !documentHtml && !documentContent && <p className="split-unavailable">Document content not available. Re-ingest to enable cross-reference.</p>}
                {!loadingContent && (documentHtml || documentContent) && (
                  <OriginalDocumentPanel
                    htmlContent={documentHtml}
                    content={documentContent}
                    sections={documentSections}
                    sourceType={documentSourceType}
                    highlightSearch={highlightSearch}
                  />
                )}
              </div>
            )}
            <div className={effectiveDocId ? 'analyse-split-right' : ''}>
        <section className="analyse-results docuguard-review">
          <div className="review-header">
            <h3>Findings</h3>
            <div className="resolved-counter">0 of {totalFindings} resolved</div>
            <div className="review-header-actions">
              <button
                type="button"
                className={`save-btn ${saveStatus === 'saved' ? 'saved' : ''} ${saveStatus === 'error' ? 'error' : ''}`}
                onClick={handleSave}
                disabled={saving}
                title="Save changes"
              >
                <Save size={14} />
                {saving ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed' : 'Save'}
              </button>
              <button type="button" className="doc-btn" onClick={() => navigate(`${base}/analyse/draft`)}>
                Go to Draft →
              </button>
              <button type="button" className="resolve-btn" onClick={() => navigate(`${base}/finalize`)}>
                {isCreate ? 'Continue to Draft →' : 'Submit to Library →'}
              </button>
            </div>
          </div>

          <div className="agent-cards">
            {!selectedMetricFilter && (
              <p className="agent-cards-placeholder">Click a metric above to view findings for that category.</p>
            )}
            {result.risk_gaps?.length > 0 && selectedMetricFilter === 'risk gaps' && (
              <div id="agent-card-risk"><RiskGapCard items={result.risk_gaps} agentKey="risk"
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.structure_flags?.length > 0 && selectedMetricFilter === 'structure' && (
              <div id="agent-card-structure"><StructureCard items={result.structure_flags} agentKey="structure"
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.content_integrity_flags?.length > 0 && selectedMetricFilter === 'content integrity' && (
              <div id="agent-card-content-integrity"><ContentIntegrityCard items={result.content_integrity_flags} agentKey="content-integrity"
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.specifying_flags?.length > 0 && selectedMetricFilter === 'specifying' && (
              <div id="agent-card-specifying"><AgentCard title="Specifying" items={result.specifying_flags} agentKey="specifying"
                keys={['location', 'current_text', 'issue', 'citations', 'recommendation']} searchTextKeys={['current_text', 'location']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.sequencing_flags?.length > 0 && selectedMetricFilter === 'sequencing' && (
              <div id="agent-card-sequencing"><AgentCard title="Sequencing" items={result.sequencing_flags} agentKey="sequencing"
                keys={['location', 'excerpt', 'issue', 'impact', 'citations', 'recommendation']} searchTextKeys={['excerpt', 'location']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.formatting_flags?.length > 0 && selectedMetricFilter === 'formatting' && (
              <div id="agent-card-formatting"><AgentCard title="Formatting" items={result.formatting_flags} agentKey="formatting"
                keys={['location', 'excerpt', 'issue', 'citations', 'recommendation']} searchTextKeys={['excerpt', 'location']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.compliance_flags?.length > 0 && selectedMetricFilter === 'compliance' && (
              <div id="agent-card-compliance"><AgentCard title="Compliance" items={result.compliance_flags} agentKey="compliance"
                keys={['location', 'excerpt', 'issue', 'requirement_reference', 'citations', 'recommendation']} searchTextKeys={['excerpt', 'location']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.terminology_flags?.length > 0 && selectedMetricFilter === 'terminology' && (
              <div id="agent-card-terminology"><AgentCard title="Terminology" items={result.terminology_flags} agentKey="terminology"
                keys={['term', 'location', 'issue', 'citations', 'recommendation']} searchTextKeys={['location', 'term']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.conflicts?.length > 0 && selectedMetricFilter === 'conflicts' && (
              <div id="agent-card-conflict"><AgentCard title="Conflicts" items={result.conflicts} agentKey="conflict"
                keys={['conflict_type', 'severity', 'description', 'citations', 'recommendation']} searchTextKeys={['description']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
          </div>

          {/* Proposed Solutions — under findings, only when a metric is selected */}
          {totalFindings > 0 && selectedMetricFilter && (() => {
            const allSolutions = buildProposedSolutions(result);
            const solutions = FLAG_KEY_TO_AGENT[selectedMetricFilter]
              ? allSolutions.filter(s => s.agent === FLAG_KEY_TO_AGENT[selectedMetricFilter])
              : [];
            if (solutions.length === 0) return null;
            return (
              <ProposedSolutionsSummary
                solutions={solutions}
                onFindingClick={effectiveDocId ? (searchText) => setHighlightSearch(searchText || '') : undefined}
              />
            );
          })()}
        </section>
            </div>
          </div>
        </div>
      )}

      {/* Draft with no result: prompt to run analysis */}
      {step === 'draft' && !result && !loading && !loadingStored && (
        <div className="analyse-no-result">
          <p>No analysis results yet. Run analysis first.</p>
          <button type="button" className="doc-btn primary" onClick={() => navigate(`${base}/analyse/overview`)}>
            Go to Analyse
          </button>
        </div>
      )}

      {/* Draft step: structured view (FSP003-style) or edit mode */}
      {step === 'draft' && result && (
        <div className="analyse-results-wrapper">
          <section className="draft-section">
            <div className="draft-header">
              <h3>Draft Content</h3>
              {lastAppliedRange && !draftEditMode && (
                <span className="draft-highlight-hint">Highlighted: your last applied change — check it fits well</span>
              )}
              {hitlSubmitStatus === 'submitted' && (
                <p className="draft-hitl-status draft-hitl-status--success">Draft submitted for HITL review. Session saved.</p>
              )}
              {hitlSubmitStatus === 'error' && (
                <p className="draft-hitl-status draft-hitl-status--error">Could not submit. Try again or use Save on the Analyse step.</p>
              )}
              <p className="draft-disclaimer">
                Draft for internal review only. Does not replace technical specialists (HITL). SharePoint remains the source of truth.
              </p>
            </div>
            {draftEditMode ? (
              <DraftEditor
                value={displayDraft}
                onChange={setDraftContent}
                lastAppliedRange={lastAppliedRange}
                onEdit={() => setLastAppliedRange(null)}
                placeholder="Draft content will appear here after analysis…"
              />
            ) : (
              <DraftStructuredView value={displayDraft} lastAppliedRange={lastAppliedRange} />
            )}
          </section>
        </div>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parse plain draft text into sections, numbered lists, bullet lists, paragraphs
// (so we can render FSP003-style layout: section headings, numbered steps, bullets)
// ---------------------------------------------------------------------------
const STANDARD_SECTION_NAMES = [
  'Responsibility', 'Responsibilities', 'Frequency', 'Procedure', 'Procedures',
  'Method', 'Methods', 'Scope', 'References', 'Record Keeping', 'Corrective Actions',
  'Picking orders', 'Loading Procedure', 'Trailer information', 'Definitions',
  'Overview', 'Introduction', 'Related documents', 'Revision history'
];

function parseDraftStructure(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let i = 0;

  function flushParagraph(paraLines) {
    const joined = paraLines.map((l) => l.trim()).join(' ').trim();
    if (joined) blocks.push({ type: 'paragraph', content: joined });
  }

  function isSectionHeading(line) {
    const t = line.trim();
    if (!t) return false;
    if (t.length > 70) return false;
    if (/^\s*\d+[a-zA-Z]?[.)]\s+/.test(t) || /^\s*[-*•]\s+/.test(t)) return false;
    const lower = t.toLowerCase();
    if (STANDARD_SECTION_NAMES.some((name) => lower === name.toLowerCase() || lower.startsWith(name.toLowerCase() + ':'))) return true;
    if (t === t.toUpperCase() && t.length > 2) return true;
    if (/:$/.test(t) && t.length < 60) return true;
    return false;
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (isSectionHeading(line)) {
      blocks.push({ type: 'section', content: trimmed.replace(/:$/, '') });
      i++;
      continue;
    }

    if (/^\s*\d+[a-zA-Z]?[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[a-zA-Z]?[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[a-zA-Z]?[.)]\s+/, '').trim());
        i++;
      }
      if (items.length) blocks.push({ type: 'numbered', items });
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, '').trim());
        i++;
      }
      if (items.length) blocks.push({ type: 'bullet', items });
      continue;
    }

    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !isSectionHeading(lines[i]) && !/^\s*\d+[a-zA-Z]?[.)]\s+/.test(lines[i]) && !/^\s*[-*•]\s+/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    flushParagraph(paraLines);
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Structured draft view — FSP003-style layout (section headings, lists)
// ---------------------------------------------------------------------------
function DraftStructuredView({ value, lastAppliedRange }) {
  const blocks = parseDraftStructure(value || '');
  if (blocks.length === 0) {
    return (
      <div className="draft-structured-view draft-structured-view--empty">
        <p className="draft-structured-empty">No draft content to display.</p>
      </div>
    );
  }
  return (
    <div className="draft-structured-view">
      {blocks.map((b, idx) => {
        if (b.type === 'section') {
          return <h3 key={idx} className="draft-structured-section">{b.content}</h3>;
        }
        if (b.type === 'numbered') {
          return (
            <ol key={idx} className="draft-structured-list draft-structured-list--numbered">
              {b.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ol>
          );
        }
        if (b.type === 'bullet') {
          return (
            <ul key={idx} className="draft-structured-list draft-structured-list--bullet">
              {b.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={idx} className="draft-structured-para">{b.content}</p>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft editor — contenteditable with highlight for last applied change
// ---------------------------------------------------------------------------
function DraftEditor({ value, onChange, lastAppliedRange, onEdit, placeholder }) {
  const editorRef = useRef(null);

  const handleInput = (e) => {
    const text = e.currentTarget.innerText || '';
    onChange(text);
    onEdit?.();
  };

  // Scroll applied change into view when highlight appears
  useEffect(() => {
    if (lastAppliedRange && editorRef.current) {
      const mark = editorRef.current.querySelector('.draft-applied-highlight');
      if (mark) {
        const t = requestAnimationFrame(() => {
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return () => cancelAnimationFrame(t);
      }
    }
  }, [lastAppliedRange]);

  if (!value && !lastAppliedRange) {
    return (
      <div
        ref={editorRef}
        className="draft-textarea draft-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
      />
    );
  }

  const { start, end } = lastAppliedRange || {};
  const hasValidRange = typeof start === 'number' && typeof end === 'number' && start < end && end <= (value?.length || 0);
  const before = hasValidRange ? value.slice(0, start) : value;
  const applied = hasValidRange ? value.slice(start, end) : '';
  const after = hasValidRange ? value.slice(end) : '';

  return (
    <div
      ref={editorRef}
      className="draft-textarea draft-editor"
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      data-placeholder={!value ? placeholder : undefined}
    >
      {before}
      {hasValidRange && <mark className="draft-applied-highlight">{applied}</mark>}
      {after}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Original document panel — HTML (mammoth) or plain text, highlights selected finding
// ---------------------------------------------------------------------------
function OriginalDocumentPanel({ htmlContent, content, sections = [], sourceType, highlightSearch }) {
  const htmlContainerRef = useRef(null);

  // Apply highlights in HTML DOM when highlightSearch changes
  useEffect(() => {
    if (sourceType !== 'html' || !htmlContainerRef.current || !htmlContent) return;
    const container = htmlContainerRef.current;
    container.innerHTML = htmlContent;

    const search = highlightSearch?.trim();
    if (!search || search.length < 2) return;

    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escapeRegex(search)})`, 'gi');

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((node) => {
      const text = node.textContent;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      const parts = [];
      let lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        parts.push({ type: 'text', value: text.slice(lastIndex, m.index) });
        parts.push({ type: 'mark', value: m[1] });
        lastIndex = m.index + m[1].length;
      }
      parts.push({ type: 'text', value: text.slice(lastIndex) });
      if (parts.length <= 1) return;

      const frag = document.createDocumentFragment();
      parts.forEach((p) => {
        if (p.type === 'text' && p.value) frag.appendChild(document.createTextNode(p.value));
        if (p.type === 'mark') {
          const mark = document.createElement('mark');
          mark.className = 'original-doc-highlight';
          mark.textContent = p.value;
          frag.appendChild(mark);
        }
      });
      node.parentNode.replaceChild(frag, node);
    });
  }, [htmlContent, highlightSearch, sourceType]);

  // HTML mode (mammoth output)
  if (sourceType === 'html' && htmlContent) {
    return (
      <div className="original-document-panel original-document-panel-html">
        <div ref={htmlContainerRef} className="mammoth-output" />
      </div>
    );
  }

  // Plain text mode
  if (!content) return null;
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function highlightInText(text) {
    if (!highlightSearch || highlightSearch.trim().length < 2) return text;
    const search = highlightSearch.trim();
    try {
      const re = new RegExp(`(${escapeRegex(search)})`, 'gi');
      const parts = text.split(re);
      if (parts.length <= 1) return text;
      return parts.map((part, j) =>
        j % 2 === 1 ? (
          <mark key={j} className="original-doc-highlight" data-highlight>{part}</mark>
        ) : part
      );
    } catch (_) {
      return text;
    }
  }

  if (sections.length > 0) {
    return (
      <div className="original-document-panel">
        {sections.map((sec, i) => (
          <section key={i} className="original-doc-section" data-doc-section={i}>
            <h4 className="original-doc-section-heading">{sec.heading}</h4>
            <div className="original-doc-section-body">
              {sec.content ? (
                sec.content.split(/\n\n+/).filter(Boolean).map((para, j) => (
                  <p key={j} className="original-doc-para">{highlightInText(para)}</p>
                ))
              ) : null}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const paragraphs = content.split(/\n\n+/).filter(Boolean);
  return (
    <div className="original-document-panel">
      {paragraphs.map((para, i) => (
        <p key={i} className="original-doc-para">{highlightInText(para)}</p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposed Solutions summary — consolidated view of all recommendations
// ---------------------------------------------------------------------------
function ProposedSolutionsSummary({ solutions, onFindingClick }) {
  const [expanded, setExpanded] = useState(true);
  if (!solutions?.length) return null;

  function handleRowClick(row) {
    if (row.sectionId) scrollToSection(row.sectionId);
    if (onFindingClick && row.searchText) onFindingClick(row.searchText);
  }

  return (
    <div className="proposed-solutions-summary">
      <button type="button" className="proposed-solutions-header" onClick={() => setExpanded(!expanded)}>
        <h4>Proposed Solutions</h4>
        <span className="proposed-solutions-count">{solutions.length} recommendation{solutions.length !== 1 ? 's' : ''}</span>
        <span className="proposed-solutions-toggle">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="proposed-solutions-table-wrap">
          <table className="proposed-solutions-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Current / Issue</th>
                <th>Proposed solution</th>
              </tr>
            </thead>
            <tbody>
              {solutions.map((row, i) => (
                <tr
                  key={i}
                  className="proposed-solutions-row-clickable"
                  onClick={() => handleRowClick(row)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(row); } }}
                  title={onFindingClick ? 'Click to jump to finding and highlight in original' : 'Click to jump to this finding'}
                >
                  <td className="proposed-agent">{row.agent}</td>
                  <td className="proposed-current">{row.current}</td>
                  <td className="proposed-proposal">{row.proposal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk Gap card — sorted by FMEA score, shows score bar inline
// ---------------------------------------------------------------------------
function RiskGapCard({ items, agentKey, onFindingClick, onApplyChange, onAddNote, appliedFindings, findingId, customSolutionByFindingId, onCustomSolutionChange, onCheckWithAgent, validateSolutionResult, validatingFindingId }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...items].sort((a, b) => (b.fmea_score || 0) - (a.fmea_score || 0));
  const display = expanded ? sorted : sorted.slice(0, 3);

  return (
    <div className="agent-card">
      <button type="button" className="agent-card-header" onClick={() => setExpanded(!expanded)}>
        <h4>Risk Gaps</h4>
        <span className="count">{items.length}</span>
      </button>
      <ul className="agent-list">
        {display.map((gap, i) => {
          const id = findingId(agentKey, gap);
          const isApplied = appliedFindings?.has(id);
          return (
          <li
            key={i}
            className={`agent-item ${onFindingClick && (gap.excerpt || gap.location) ? 'agent-item-clickable' : ''}`}
            onClick={onFindingClick && (gap.excerpt || gap.location) ? () => onFindingClick(gap.excerpt || gap.location) : undefined}
            onKeyDown={onFindingClick && (gap.excerpt || gap.location) ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFindingClick(gap.excerpt || gap.location); } } : undefined}
            role={onFindingClick && (gap.excerpt || gap.location) ? 'button' : undefined}
            tabIndex={onFindingClick && (gap.excerpt || gap.location) ? 0 : undefined}
            title={onFindingClick && (gap.excerpt || gap.location) ? 'Click to highlight in original document' : undefined}
          >
            {gap.excerpt && (
              <div className="finding-excerpt" title="Click to highlight in original document">
                {gap.excerpt.slice(0, 400)}{gap.excerpt.length > 400 ? '…' : ''}
              </div>
            )}
            <div className="risk-gap-top">
              <span className="agent-field-label">{gap.location || '—'}</span>
              <FmeaBar score={gap.fmea_score} band={gap.fmea_band} />
            </div>
            {gap.fmea_score > 0 && (
              <div className="fmea-dimensions">
                S={gap.severity} · Sc={gap.scope} · D={gap.detectability}
              </div>
            )}
            <div className="agent-field">
              <span className="agent-field-label">issue:</span>{' '}
              <span className="agent-field-value">{gap.issue}</span>
            </div>
            <div className="agent-field">
              <span className="agent-field-label">risk:</span>{' '}
              <span className="agent-field-value">{gap.risk}</span>
            </div>
            {gap.citations?.length > 0 && (
              <div className="agent-field">
                <span className="agent-field-label">citations:</span>{' '}
                <span className="agent-field-value">{gap.citations.join(', ')}</span>
              </div>
            )}
            <div className="agent-field">
              <span className="agent-field-label">recommendation:</span>{' '}
              <span className="agent-field-value">{gap.recommendation}</span>
            </div>
            <FindingActions id={id} agentKey={agentKey} item={gap} onApplyChange={onApplyChange} onAddNote={onAddNote} isApplied={isApplied}
              customSolution={customSolutionByFindingId?.[id]} onCustomSolutionChange={onCustomSolutionChange}
              onCheckWithAgent={onCheckWithAgent} validateFeedback={validateSolutionResult?.findingId === id ? validateSolutionResult.feedback : null} isChecking={validatingFindingId === id} />
          </li>
          );
        })}
      </ul>
      {items.length > 3 && !expanded && (
        <button type="button" className="show-more" onClick={() => setExpanded(true)}>
          Show {items.length - 3} more
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structure flag card — omission/ordering, shows severity pill
// ---------------------------------------------------------------------------
function StructureCard({ items, agentKey, onFindingClick, onApplyChange, onAddNote, appliedFindings, findingId, customSolutionByFindingId, onCustomSolutionChange, onCheckWithAgent, validateSolutionResult, validatingFindingId }) {
  const [expanded, setExpanded] = useState(false);
  // Required-section omissions first, then ordering, then optional omissions
  const sorted = [...items].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.severity] ?? 1) - (order[b.severity] ?? 1);
  });
  const display = expanded ? sorted : sorted.slice(0, 5);

  return (
    <div className="agent-card">
      <button type="button" className="agent-card-header" onClick={() => setExpanded(!expanded)}>
        <h4>Structure — Template Compliance</h4>
        <span className="count">{items.length}</span>
      </button>
      <ul className="agent-list">
        {display.map((flag, i) => {
          const id = findingId(agentKey, flag);
          const isApplied = appliedFindings?.has(id);
          return (
          <li
            key={i}
            className={`agent-item structure-item ${onFindingClick && flag.section ? 'agent-item-clickable' : ''}`}
            onClick={onFindingClick && flag.section ? () => onFindingClick(flag.section) : undefined}
            onKeyDown={onFindingClick && flag.section ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFindingClick(flag.section); } } : undefined}
            role={onFindingClick && flag.section ? 'button' : undefined}
            tabIndex={onFindingClick && flag.section ? 0 : undefined}
            title={onFindingClick && flag.section ? 'Click to highlight in original document' : undefined}
          >
            <div className="structure-top">
              <SevPill severity={flag.severity} />
              <span className="structure-type">{flag.flag_type}</span>
              <strong className="structure-section">{flag.section}</strong>
            </div>
            <div className="agent-field">
              <span className="agent-field-value">{flag.detail}</span>
            </div>
            <div className="agent-field">
              <span className="agent-field-label">recommendation:</span>{' '}
              <span className="agent-field-value">{flag.recommendation}</span>
            </div>
            <FindingActions id={id} agentKey={agentKey} item={flag} onApplyChange={onApplyChange} onAddNote={onAddNote} isApplied={isApplied}
              customSolution={customSolutionByFindingId?.[id]} onCustomSolutionChange={onCustomSolutionChange}
              onCheckWithAgent={onCheckWithAgent} validateFeedback={validateSolutionResult?.findingId === id ? validateSolutionResult.feedback : null} isChecking={validatingFindingId === id} />
          </li>
          );
        })}
      </ul>
      {items.length > 5 && !expanded && (
        <button type="button" className="show-more" onClick={() => setExpanded(true)}>
          Show {items.length - 5} more
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content integrity card — grouped by flag_type sub-section
// ---------------------------------------------------------------------------
function ContentIntegrityCard({ items, agentKey, onFindingClick, onApplyChange, onAddNote, appliedFindings, findingId, customSolutionByFindingId, onCustomSolutionChange, onCheckWithAgent, validateSolutionResult, validatingFindingId }) {
  const [expanded, setExpanded] = useState(false);
  const grouped = groupBy(items, 'flag_type');

  // Priority order for sub-sections: non-text and truncation first
  const typeOrder = ['non_text_element', 'truncated_step', 'fragmented_sentence',
                     'incomplete_list', 'encoding_anomaly', 'us_spelling'];
  const orderedTypes = [
    ...typeOrder.filter(t => grouped[t]),
    ...Object.keys(grouped).filter(t => !typeOrder.includes(t)),
  ];

  return (
    <div className="agent-card">
      <button type="button" className="agent-card-header" onClick={() => setExpanded(!expanded)}>
        <h4>Content Integrity</h4>
        <span className="count">{items.length}</span>
      </button>

      {expanded && (
        <div className="integrity-groups">
          {orderedTypes.map(ftype => {
            const group = grouped[ftype];
            return (
              <IntegrityGroup key={ftype} ftype={ftype} items={group} agentKey={agentKey}
                onFindingClick={onFindingClick} onApplyChange={onApplyChange} onAddNote={onAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={onCustomSolutionChange}
                onCheckWithAgent={onCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} />
            );
          })}
        </div>
      )}

      {/* Collapsed preview: show one item from highest-priority non-empty group */}
      {!expanded && (
        <ul className="agent-list">
          {orderedTypes.slice(0, 2).map(ftype => {
            const first = grouped[ftype][0];
            return (
              <li key={ftype} className="agent-item">
                <div className="integrity-top">
                  <span className="integrity-type-badge">{INTEGRITY_TYPE_LABELS[ftype] || ftype}</span>
                  <SevPill severity={first.severity} />
                  <span className="integrity-count-note">{grouped[ftype].length} finding{grouped[ftype].length > 1 ? 's' : ''}</span>
                </div>
                <div className="agent-field">
                  <span className="agent-field-value">{first.detail?.slice(0, 160)}{first.detail?.length > 160 ? '…' : ''}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="show-more" onClick={() => setExpanded(e => !e)}>
        {expanded ? 'Collapse ▲' : `Expand all ${items.length} findings ▼`}
      </button>
    </div>
  );
}

function IntegrityGroup({ ftype, items, agentKey, onFindingClick, onApplyChange, onAddNote, appliedFindings, findingId, customSolutionByFindingId, onCustomSolutionChange, onCheckWithAgent, validateSolutionResult, validatingFindingId }) {
  const [open, setOpen] = useState(false);
  const label = INTEGRITY_TYPE_LABELS[ftype] || ftype.replace(/_/g, ' ');
  const display = open ? items : items.slice(0, 2);

  return (
    <div className="integrity-group">
      <button type="button" className="integrity-group-header" onClick={() => setOpen(o => !o)}>
        <span className="integrity-type-badge">{label}</span>
        <span className="integrity-group-count">{items.length}</span>
        <span className="integrity-toggle">{open ? '▲' : '▼'}</span>
      </button>
      <ul className="agent-list">
        {display.map((flag, i) => {
          const searchText = flag.excerpt || flag.location;
          const id = findingId(`${agentKey}:${ftype}`, flag);
          const isApplied = appliedFindings?.has(id);
          return (
          <li
            key={i}
            className={`agent-item ${onFindingClick && searchText ? 'agent-item-clickable' : ''}`}
            onClick={onFindingClick && searchText ? () => onFindingClick(searchText) : undefined}
            onKeyDown={onFindingClick && searchText ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFindingClick(searchText); } } : undefined}
            role={onFindingClick && searchText ? 'button' : undefined}
            tabIndex={onFindingClick && searchText ? 0 : undefined}
            title={onFindingClick && searchText ? 'Click to highlight in original document' : undefined}
          >
            <div className="integrity-top">
              <SevPill severity={flag.severity} />
              {flag.location && (
                <span className="integrity-location">{flag.location}</span>
              )}
            </div>
            {flag.excerpt && (
              <div className="finding-excerpt">
                {flag.excerpt.slice(0, 400)}{flag.excerpt.length > 400 ? '…' : ''}
              </div>
            )}
            <div className="agent-field">
              <span className="agent-field-value">{flag.detail}</span>
            </div>
            <div className="agent-field">
              <span className="agent-field-label">recommendation:</span>{' '}
              <span className="agent-field-value">{flag.recommendation}</span>
            </div>
            <FindingActions id={id} agentKey={agentKey} item={flag} onApplyChange={onApplyChange} onAddNote={onAddNote} isApplied={isApplied}
              customSolution={customSolutionByFindingId?.[id]} onCustomSolutionChange={onCustomSolutionChange}
              onCheckWithAgent={onCheckWithAgent} validateFeedback={validateSolutionResult?.findingId === id ? validateSolutionResult.feedback : null} isChecking={validatingFindingId === id} />
          </li>
          );
        })}
      </ul>
      {items.length > 2 && !open && (
        <button type="button" className="show-more" onClick={() => setOpen(true)}>
          Show {items.length - 2} more in this group
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic agent card — supports click-to-highlight via searchTextKey or searchTextKeys (array, try in order)
// ---------------------------------------------------------------------------
function AgentCard({ title, items, keys, agentKey, searchTextKey = 'location', searchTextKeys, onFindingClick, onApplyChange, onAddNote, appliedFindings, findingId, customSolutionByFindingId, onCustomSolutionChange, onCheckWithAgent, validateSolutionResult, validatingFindingId }) {
  const [expanded, setExpanded] = useState(false);
  const displayItems = expanded ? items : items.slice(0, 3);
  const hasMore = items.length > 3;

  function getSearchText(item) {
    const keysToTry = searchTextKeys || (searchTextKey ? [searchTextKey] : []);
    for (const k of keysToTry) {
      const v = item[k];
      if (v && (typeof v === 'string' ? v.trim() : true)) return String(v).slice(0, 300);
    }
    return null;
  }

  return (
    <div className="agent-card">
      <button type="button" className="agent-card-header" onClick={() => setExpanded(!expanded)}>
        <h4>{title}</h4>
        <span className="count">{items.length}</span>
      </button>
      <ul className="agent-list">
        {displayItems.map((item, i) => {
          const searchText = getSearchText(item);
          const id = findingId(agentKey, item);
          const isApplied = appliedFindings?.has(id);
          return (
          <li
            key={i}
            className={`agent-item ${onFindingClick && searchText ? 'agent-item-clickable' : ''}`}
            onClick={onFindingClick && searchText ? () => onFindingClick(searchText) : undefined}
            onKeyDown={onFindingClick && searchText ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFindingClick(searchText); } } : undefined}
            role={onFindingClick && searchText ? 'button' : undefined}
            tabIndex={onFindingClick && searchText ? 0 : undefined}
            title={onFindingClick && searchText ? 'Click to highlight in original document' : undefined}
          >
            {(item.excerpt || item.current_text) && (
              <div className="finding-excerpt" title="Click to highlight in original document">
                {(item.excerpt || item.current_text).slice(0, 400)}{(item.excerpt || item.current_text).length > 400 ? '…' : ''}
              </div>
            )}
            {keys.filter(k => {
              if (k === 'excerpt') return false;
              if (k === 'current_text' && (item.excerpt || item.current_text)) return false;
              return true;
            }).map((k) => {
              const val = item[k];
              const show = val && (!Array.isArray(val) || val.length > 0);
              if (!show) return null;
              const displayVal = Array.isArray(val) ? val.join(', ') : String(val);
              const isCitations = k === 'citations';
              return (
                <div key={k} className={`agent-field${isCitations ? ' agent-field-citations' : ''}`}>
                  <span className="agent-field-label">{isCitations ? 'citations:' : `${k}:`}</span>{' '}
                  <span className="agent-field-value">
                    {displayVal.slice(0, 400)}{displayVal.length > 400 ? '…' : ''}
                  </span>
                </div>
              );
            })}
            <FindingActions id={id} agentKey={agentKey} item={item} onApplyChange={onApplyChange} onAddNote={onAddNote} isApplied={isApplied}
              customSolution={customSolutionByFindingId?.[id]} onCustomSolutionChange={onCustomSolutionChange}
              onCheckWithAgent={onCheckWithAgent} validateFeedback={validateSolutionResult?.findingId === id ? validateSolutionResult.feedback : null} isChecking={validatingFindingId === id} />
          </li>
          );
        })}
      </ul>
      {hasMore && !expanded && (
        <button type="button" className="show-more" onClick={() => setExpanded(true)}>
          Show {items.length - 3} more
        </button>
      )}
    </div>
  );
}
