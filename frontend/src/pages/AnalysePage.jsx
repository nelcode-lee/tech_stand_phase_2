import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { analyseWithProgress, saveAnalysisSession, getAnalysisSession, getDocumentContent, getDocumentFile, addFindingNote, addInteractionLog, validateSolution, docLayerForApi, downloadAuditPack, downloadAuditPackDocx } from '../api';
import mammoth from 'mammoth';
import { useAnalysis } from '../context/AnalysisContext';
import { resolveSitesForApi } from '../constants/sites';
import { Save, ChevronDown, ChevronUp } from 'lucide-react';
import './AnalysePage.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HACCP_RPN_BAND_CLASS = {
  critical: 'haccp-rpn-critical',
  high:     'haccp-rpn-high',
  medium:   'haccp-rpn-medium',
  low:      'haccp-rpn-low',
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

/** NBSP / smart quotes — keep same string length so offsets stay valid on concatenated text */
function normalizeForDocSearch(s) {
  if (!s) return '';
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

/** Build concatenated text + find best match span for highlight (cross-node safe offsets). */
function findExcerptMatchSpan(full, needle) {
  if (!needle || needle.length < 2) return null;
  const n = needle.trim();
  if (n.length < 2) return null;

  const attempts = [
    () => {
      const i = full.indexOf(n);
      return i >= 0 ? { start: i, length: n.length } : null;
    },
    () => {
      const f = normalizeForDocSearch(full);
      const ne = normalizeForDocSearch(n);
      const i = f.indexOf(ne);
      return i >= 0 ? { start: i, length: ne.length } : null;
    },
    () => {
      const i = full.toLowerCase().indexOf(n.toLowerCase());
      return i >= 0 ? { start: i, length: n.length } : null;
    },
    () => {
      const f = normalizeForDocSearch(full);
      const ne = normalizeForDocSearch(n);
      const i = f.toLowerCase().indexOf(ne.toLowerCase());
      return i >= 0 ? { start: i, length: ne.length } : null;
    },
  ];
  for (const run of attempts) {
    const r = run();
    if (r) return r;
  }
  for (let len = Math.min(n.length, 200); len >= 20; len -= 6) {
    const sub = n.slice(0, len);
    const i = full.indexOf(sub);
    if (i >= 0) return { start: i, length: len };
    const f = normalizeForDocSearch(full);
    const ne = normalizeForDocSearch(sub);
    const j = f.indexOf(ne);
    if (j >= 0) return { start: j, length: len };
  }
  return null;
}

function collectTextNodesUnder(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const out = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent && node.textContent.length) out.push(node);
  }
  return out;
}

/** Map character offsets in concatenated text to a DOM Range across text nodes. */
function rangeFromTextOffsets(nodes, start, length) {
  if (length < 1 || !nodes.length) return null;
  const end = start + length;
  let pos = 0;
  let startNode = null;
  let startOff = 0;
  let endNode = null;
  let endOff = 0;
  for (const n of nodes) {
    const len = n.textContent.length;
    if (startNode == null && start < pos + len) {
      startNode = n;
      startOff = start - pos;
    }
    if (startNode != null && end <= pos + len) {
      endNode = n;
      endOff = end - pos;
      break;
    }
    pos += len;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  return range;
}

function surroundRangeWithHighlightMark(range) {
  const mark = document.createElement('mark');
  mark.className = 'original-doc-highlight';
  try {
    range.surroundContents(mark);
  } catch {
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
  }
}

// Group an array of objects by a key value
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'other';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

function normaliseDocId(value) {
  return String(value || '').trim().toLowerCase();
}

function resultMatchesDocument(result, documentId) {
  const expected = normaliseDocId(documentId);
  if (!expected) return true;
  return normaliseDocId(result?.document_id) === expected;
}

function normaliseSessionSites(sites) {
  if (Array.isArray(sites)) return sites.map((site) => String(site).trim()).filter(Boolean);
  return String(sites || '').split(',').map((site) => site.trim()).filter(Boolean);
}

/** Strip legacy fields from stored findings so finding IDs stay stable across runs. */
function itemForFindingIdHash(item) {
  if (!item || typeof item !== 'object') return item;
  const { policy_evidence: _pe, policyEvidence: _pE, citations: _c, requirement_reference: _rr, clause_mapping: _cm, ...rest } = item;
  return rest;
}

function buildSessionMetadata(session, fallbackResult = null) {
  if (!session && !fallbackResult) return null;
  const documentId = fallbackResult?.document_id || session?.documentId || session?.document_id || '';
  const title = fallbackResult?.title || session?.title || documentId || '';
  const docLayer = fallbackResult?.doc_layer || session?.docLayer || session?.doc_layer || 'sop';
  const requester = fallbackResult?.requester || session?.requester || '';
  const trackingId = fallbackResult?.tracking_id || session?.trackingId || session?.tracking_id || '';
  return {
    trackingId,
    documentId,
    title,
    docLayer,
    requester,
    sites: normaliseSessionSites(session?.sites),
  };
}

/** Eight named agents — strip order: Cleansor → Risk-Assessor → Conflictor → Specifier → Sequencer → Terminator → Formatter → Validator */
const ANALYSIS_LOADING_STEPS = [
  {
    key: 'cleansor',
    label: 'Cleansor',
    flowSlot: 'source',
    title: 'Cleansor: normalising the document',
    message: 'Cleaning structure, headings, and noise so downstream agents see a consistent SOP.',
    detail: 'Text hygiene and layout passes are running on the working document',
  },
  {
    key: 'risk-assessor',
    label: 'Risk-Assessor',
    flowSlot: 'output',
    title: 'Risk-Assessor: operational risk',
    message: 'Scoring severity, likelihood, and detectability to rank the most important issues.',
    detail: 'HACCP score (Severity × Likelihood × Detectability) ranks gaps; food-safety and CCP issues use higher severity floors from domain rules',
  },
  {
    key: 'conflictor',
    label: 'Conflictor',
    flowSlot: 'reasoning',
    title: 'Conflictor: contradictions',
    message: 'Looking for conflicting instructions, duplicated rules, and incompatible requirements.',
    detail: 'Conflictor is cross-referencing sections for logical clashes',
  },
  {
    key: 'specifier',
    label: 'Specifier',
    flowSlot: 'policy',
    title: 'Specifier: requirements and clarity',
    message: 'Checking that instructions are specific, testable, and free of vague language.',
    detail: 'Specifier is comparing clauses against good-practice specifying patterns',
  },
  {
    key: 'sequencer',
    label: 'Sequencer',
    flowSlot: 'policy',
    title: 'Sequencer: flow and order',
    message: 'Reviewing step order, dependencies, and whether the sequence can be followed safely.',
    detail: 'Sequencer is tracing procedural logic across the document',
  },
  {
    key: 'terminator',
    label: 'Terminator',
    flowSlot: 'reasoning',
    title: 'Terminator: terminology',
    message: 'Aligning terms with the glossary and flagging inconsistent or undefined vocabulary.',
    detail: 'Terminator is normalising language against controlled terms',
  },
  {
    key: 'formatter',
    label: 'Formatter',
    flowSlot: 'reasoning',
    title: 'Formatter: presentation and structure',
    message: 'Checking tables, lists, numbering, and visual structure for readability.',
    detail: 'Formatter is validating how the content is laid out on the page',
  },
  {
    key: 'validator',
    label: 'Validator',
    flowSlot: 'output',
    title: 'Validator: consolidation',
    message: 'Cross-checking outputs and packaging results for the review screen.',
    detail: 'Final validation before results are returned to the dashboard',
  },
];

function AnalysisLoadingPanel({ activeIndex, progressPercent }) {
  const currentStep = ANALYSIS_LOADING_STEPS[activeIndex] || ANALYSIS_LOADING_STEPS[0];
  const barPct =
    progressPercent != null && !Number.isNaN(progressPercent)
      ? Math.min(100, Math.max(0, progressPercent))
      : ((activeIndex + 1) / ANALYSIS_LOADING_STEPS.length) * 100;

  return (
    <div className="analyse-loading-overlay analyse-loading-panel" role="status" aria-live="polite">
      <div className="analyse-loading-copy">
        <h3 className="analyse-loading-title">Running analysis</h3>
        <p className="analyse-loading-subtitle">
          The workflow below mirrors how the platform retrieves context, calls the LLM, coordinates agents, and builds the final review.
        </p>
      </div>

      <div className="analyse-loading-progress" aria-hidden="true">
        <div
          className="analyse-loading-progress-bar"
          style={{ width: `${barPct}%` }}
        />
      </div>

      <div className="analyse-loading-phase-strip">
        {ANALYSIS_LOADING_STEPS.map((step, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
          return (
            <div key={step.key} className={`analyse-loading-phase analyse-loading-phase-${state}`}>
              <span className="analyse-loading-phase-dot" />
              <span className="analyse-loading-phase-label">{step.label}</span>
            </div>
          );
        })}
      </div>

      <div className="analyse-loading-scene">
        <div className="analyse-loading-robot-card">
          <div className="analyse-loading-robot-wrap" aria-hidden="true">
            <svg
              viewBox="0 0 140 168"
              className="analyse-loading-robot-svg analyse-loading-robot-v2"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="robot-visor-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#3d5570" />
                  <stop offset="100%" stopColor="#1a2636" />
                </linearGradient>
              </defs>
              {/* Neck */}
              <path
                className="robot-neck"
                d="M 54 132 Q 70 142 86 132 L 86 136 Q 70 148 54 136 Z"
              />
              {/* Side tabs */}
              <rect x="6" y="70" width="12" height="32" rx="4" className="robot-ear robot-ear-left" />
              <rect x="122" y="70" width="12" height="32" rx="4" className="robot-ear robot-ear-right" />
              {/* Main head shell */}
              <rect x="16" y="40" width="108" height="100" rx="28" className="robot-chassis" />
              {/* Top cap */}
              <rect x="50" y="32" width="40" height="12" rx="5" className="robot-top-cap" />
              {/* Dual antennae */}
              <path
                className="robot-antenna-stalk robot-antenna-stalk-l"
                d="M 44 40 L 42 20"
                fill="none"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <circle cx="40" cy="16" r="7" className="robot-antenna-bulb robot-antenna-bulb-l" />
              <path
                className="robot-antenna-stalk robot-antenna-stalk-r"
                d="M 96 40 L 98 20"
                fill="none"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <circle cx="100" cy="16" r="7" className="robot-antenna-bulb robot-antenna-bulb-r" />
              {/* Visor */}
              <rect
                x="26"
                y="54"
                width="88"
                height="78"
                rx="18"
                className="robot-visor"
                fill="url(#robot-visor-grad)"
              />
              <rect
                x="29"
                y="57"
                width="82"
                height="72"
                rx="15"
                className="robot-visor-inner"
                fill="none"
              />
              {/* Face: eyes + smile */}
              <g className="robot-face-eyes" aria-hidden="true">
                <circle cx="52" cy="82" r="8" className="robot-eye-halo robot-eye-halo-l" />
                <circle cx="88" cy="82" r="8" className="robot-eye-halo robot-eye-halo-r" />
                <g className="robot-eye-cores">
                  <circle cx="52" cy="82" r="5.5" className="robot-eye-core" />
                  <circle cx="88" cy="82" r="5.5" className="robot-eye-core" />
                </g>
              </g>
              <path
                className="robot-smile"
                d="M 56 104 Q 70 114 84 104"
                fill="none"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            <span className="analyse-loading-robot-glow" />
          </div>
          <div className="analyse-loading-robot-copy">
            <span className="analyse-loading-active-label">AI workflow assistant</span>
            <strong>{currentStep.title}</strong>
            <span>{currentStep.message}</span>
          </div>
        </div>

        <div className="analyse-loading-flow">
          <div className={`analyse-loading-node ${currentStep.flowSlot === 'source' ? 'is-active' : ''}`}>
            <span className="analyse-loading-node-kicker">Source</span>
            <strong>Document + RAG</strong>
            <span>Relevant SOP content is gathered and scoped.</span>
          </div>
          <div className={`analyse-loading-node ${currentStep.flowSlot === 'policy' ? 'is-active' : ''}`}>
            <span className="analyse-loading-node-kicker">Policy</span>
            <strong>Standards Context</strong>
            <span>Parent policies and structured clauses inform the review.</span>
          </div>
          <div className={`analyse-loading-node ${currentStep.flowSlot === 'reasoning' ? 'is-active' : ''}`}>
            <span className="analyse-loading-node-kicker">Reasoning</span>
            <strong>LLM Workspace</strong>
            <span>Specialist agents run in the shared analysis context.</span>
          </div>
          <div className={`analyse-loading-node ${currentStep.flowSlot === 'output' ? 'is-active' : ''}`}>
            <span className="analyse-loading-node-kicker">Output</span>
            <strong>Findings + Draft</strong>
            <span>Risk scoring and validation before results return to the page.</span>
          </div>
        </div>
      </div>

      <div className="analyse-loading-active">
        <span className="analyse-loading-active-label">Current stage</span>
        <strong>{currentStep.title}</strong>
        <span>{currentStep.detail}</span>
      </div>

    </div>
  );
}

// Flag count key -> section id for scroll target (metric tiles)
const FLAG_KEY_TO_SECTION_ID = {
  'risk gaps': 'agent-card-risk',
  'cleanser': 'agent-card-cleanser',
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
  'cleanser': 'cleanser',
  'structure': 'structure',
  'content-integrity': 'content integrity',
  'specifying': 'specifying',
  'sequencing': 'sequencing',
  'formatting': 'formatting',
  'compliance': 'compliance',
  'terminology': 'terminology',
  'conflict': 'conflicts',
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
    { key: 'cleanser', items: result.cleanser_flags },
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
  if (agentKey === 'cleanser') return item.current_text || item.location || '';
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
  else if (agentKey === 'cleanser') search = item.current_text || item.location || '';
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

// Apply a single finding to draft content by inserting a proposed update near matching text.
// This preserves original document integrity instead of replacing source content.
function applyFindingToDraft(draft, search, replacement) {
  if (!draft || !search || !replacement) {
    return { draft, applied: false, reason: 'invalid_input', range: null };
  }
  if (draft.includes(replacement)) {
    return { draft, applied: false, reason: 'already_present', range: null };
  }

  const locateMatch = (text, needle) => {
    const rawNeedle = String(needle || '').trim();
    if (!rawNeedle) return null;
    // 1) Exact (fast path)
    const exactIdx = text.indexOf(rawNeedle);
    if (exactIdx >= 0) return { idx: exactIdx, len: rawNeedle.length };
    // 2) Case-insensitive literal
    const lowerIdx = text.toLowerCase().indexOf(rawNeedle.toLowerCase());
    if (lowerIdx >= 0) return { idx: lowerIdx, len: rawNeedle.length };
    // 3) Flexible whitespace, case-insensitive regex
    const escaped = rawNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = escaped.replace(/\s+/g, '\\s+');
    try {
      const re = new RegExp(pattern, 'i');
      const match = re.exec(text);
      if (match && typeof match.index === 'number') {
        return { idx: match.index, len: match[0].length || rawNeedle.length };
      }
    } catch {
      // Ignore invalid regex fallback
    }
    return null;
  };

  const match = locateMatch(draft, search);
  if (!match) {
    return { draft, applied: false, reason: 'search_not_found', range: null };
  }
  const insertionPoint = match.idx + match.len;
  const lineStart = draft.lastIndexOf('\n', match.idx) + 1;
  const linePrefix = draft.slice(lineStart, match.idx);
  const indentMatch = linePrefix.match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const prefixNeedsNewline = insertionPoint > 0 && draft[insertionPoint - 1] !== '\n';
  const suffixNeedsNewline = insertionPoint < draft.length && draft[insertionPoint] !== '\n';
  const insertedText =
    `${prefixNeedsNewline ? '\n' : ''}${indent}  - Amendment: ${replacement}${suffixNeedsNewline ? '\n' : ''}`;
  const nextDraft = draft.slice(0, insertionPoint) + insertedText + draft.slice(insertionPoint);
  return {
    draft: nextDraft,
    applied: true,
    reason: 'applied',
    range: { start: insertionPoint + (prefixNeedsNewline ? 1 : 0), end: insertionPoint + (prefixNeedsNewline ? 1 : 0) + insertedText.length },
  };
}

function htmlToPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return (doc.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return '';
  }
}

// Render HACCP score bar (max S×L×D = 6×6×6 = 216, 20-segment)
function HaccpRpnBar({ score, band }) {
  if (!score || !band) return null;
  const filled = Math.min(20, Math.round(score / 10.8));
  const empty = 20 - filled;
  return (
    <span className={`haccp-rpn-bar ${HACCP_RPN_BAND_CLASS[band] || ''}`} title={`HACCP score ${band} — ${score} (S×L×D)`}>
      {'█'.repeat(filled)}{'░'.repeat(empty)}
      <span className="haccp-rpn-band-label">{band.toUpperCase()} {score}</span>
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
function FindingActions({ id, agentKey, item, onApplyChange, onAddNote, isApplied, customSolution, onCustomSolutionChange, validateFeedback }) {
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteAttachments, setNoteAttachments] = useState([]); // [{ name, contentType, dataBase64 }]
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [modalPos, setModalPos] = useState(null); // { left, top } or null = centered
  const [isEditingSolution, setIsEditingSolution] = useState(false);
  const fileInputRef = useRef(null);
  const modalRef = useRef(null);
  const dragRef = useRef(null);

  if (!onApplyChange || !onAddNote) return null;
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

  const proposedSolution = item.recommendation || '';
  const hasCustomSolution = customSolution != null && customSolution !== '';
  const displayValue = hasCustomSolution ? customSolution : proposedSolution;
  const solutionValue = displayValue;
  const isConfirmDisabled = !solutionValue.trim();

  return (
    <div className="finding-actions" onClick={e => e.stopPropagation()}>
      {onCustomSolutionChange && (
        <div className="finding-solution-edit">
          <label className="finding-solution-label">Proposed solution (agent)</label>
          <textarea
            className={`finding-solution-textarea ${isEditingSolution ? 'is-editing' : 'is-readonly'}`}
            value={displayValue}
            onChange={e => onCustomSolutionChange(id, e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            placeholder={proposedSolution || 'No proposed solution available for this finding.'}
            rows={2}
            readOnly={!isEditingSolution}
          />
          {validateFeedback != null && (
            <div className="finding-validate-feedback">{validateFeedback}</div>
          )}
        </div>
      )}
      <div className="finding-action-buttons-row">
        {onCustomSolutionChange && (
          <button
            type="button"
            className={`finding-action-btn edit ${isEditingSolution ? 'editing' : ''}`}
            onClick={() => {
              if (!isEditingSolution && !hasCustomSolution) {
                onCustomSolutionChange(id, proposedSolution);
              }
              setIsEditingSolution(v => !v);
            }}
            title={isEditingSolution ? 'Lock this text and confirm it' : 'Edit the proposed solution'}
          >
            {isEditingSolution ? 'Done editing' : 'Edit solution'}
          </button>
        )}
        <button
          type="button"
          className={`finding-action-btn apply ${isApplied ? 'applied' : ''}`}
          onClick={() => onApplyChange(id)}
          disabled={isConfirmDisabled}
          title="Add this change to the updated procedure"
        >
          {isApplied ? 'Confirmed ✓' : 'Confirm to draft'}
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

  const [loading, setLoading] = useState(false);
  const [loadingStored, setLoadingStored] = useState(!!trackingIdFromUrl);
  const [saving, setSaving] = useState(false);
  const [auditPackDownloading, setAuditPackDownloading] = useState(false);
  const [auditPackDocxDownloading, setAuditPackDocxDownloading] = useState(false);
  const [auditPackError, setAuditPackError] = useState(null);
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
  const [isDraftUserEdited, setIsDraftUserEdited] = useState(false);
  const [appliedFindings, setAppliedFindings] = useState(new Set());
  const [customSolutionByFindingId, setCustomSolutionByFindingId] = useState({}); // { [findingId]: "user typed solution" }
  const [notesAddedByFlag, setNotesAddedByFlag] = useState({}); // { 'risk gaps': 2, ... } — session count
  const [lastAppliedRange, setLastAppliedRange] = useState(null); // { start, end } for highlighting in draft
  const [draftConfirmationItems, setDraftConfirmationItems] = useState([]); // [{ id, label, status, detail }]
  const [selectedMetricFilter, setSelectedMetricFilter] = useState(null); // null = show placeholder, else e.g. 'risk gaps'
  const [validateSolutionResult, setValidateSolutionResult] = useState(null); // { findingId, feedback } or null
  const [validatingFindingId, setValidatingFindingId] = useState(null); // id while request in flight
  const [loadedSessionMeta, setLoadedSessionMeta] = useState(() => (
    trackingIdFromUrl ? buildSessionMetadata(sessionFromState, storedResultFromState) : null
  ));
  const latestTrackingRequestRef = useRef(null);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  /** Backend stream: done/total progress events (drives progress bar when total > 0). */
  const [streamProgress, setStreamProgress] = useState({ done: 0, total: 0 });

  function logInteraction(actionType, metadata = {}) {
    addInteractionLog({
      user_name: effectiveRequester,
      action_type: actionType,
      route: `${base}/analyse/${step}`,
      workflow_mode: workflowMode || mode,
      document_id: effectiveDocId || config?.documentId || '',
      tracking_id: result?.tracking_id || metadata.tracking_id || '',
      finding_id: metadata.finding_id || '',
      doc_layer: effectiveDocLayer || '',
      metadata,
    }).catch(() => {});
  }

  function findingId(agentKey, item) {
    const str = JSON.stringify(itemForFindingIdHash(item));
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
    return `${agentKey}:${h}`;
  }

  function handleApplyFinding(id) {
    setAppliedFindings(s => {
      const next = new Set(s);
      const nowApplied = !next.has(id);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      logInteraction('apply_update_toggle', { finding_id: id, applied: nowApplied });
      return next;
    });
  }

  function handleProcessChanges() {
    if (!result || appliedFindings.size === 0) return;
    let currentDraft = draftContent || documentContent || result?.draft_content || '';
    if (!currentDraft) return;
    const agentOrder = ['risk', 'cleanser', 'structure', 'specifying', 'sequencing', 'formatting', 'compliance', 'terminology', 'conflict', 'content-integrity'];
    const collected = [];
    for (const id of appliedFindings) {
      const found = findFindingById(result, id, findingId);
      if (found) collected.push({ id, ...found });
    }
    collected.sort((a, b) => agentOrder.indexOf(a.agentKey) - agentOrder.indexOf(b.agentKey));
    let lastRange = null;
    const confirmations = [];
    for (const { id, agentKey, item } of collected) {
      const replacementOverride = customSolutionByFindingId[id];
      const solutionText = (replacementOverride != null && String(replacementOverride).trim() !== '')
        ? String(replacementOverride).trim()
        : (item.recommendation || '');
      const label = item.issue || item.detail || item.location || item.term || item.description || 'Finding';
      const parsed = getSearchAndReplacement(agentKey, item, replacementOverride);
      if (!parsed || !parsed.search || !parsed.replacement) {
        confirmations.push({ id, label, status: 'not_applied', detail: 'No valid replacement text found for this finding.' });
        continue;
      }
      const { search, replacement } = parsed;
      const appliedResult = applyFindingToDraft(currentDraft, search, replacement);
      if (!appliedResult.applied) {
        const detail =
          appliedResult.reason === 'already_present'
            ? 'Suggested text is already present in the draft.'
            : 'Matching source text was not found in the current draft.';
        confirmations.push({ id, label, status: 'not_applied', detail });
        continue;
      }
      currentDraft = appliedResult.draft;
      lastRange = appliedResult.range;
      confirmations.push({ id, label, status: 'applied', detail: solutionText });
    }
    const appliedCount = confirmations.filter(c => c.status === 'applied').length;
    const changed = currentDraft !== (draftContent || result?.draft_content || '');
    setDraftConfirmationItems(confirmations);
    if (changed) {
      setDraftContent(currentDraft);
      setLastAppliedRange(lastRange);
    } else {
      setLastAppliedRange(null);
    }
    logInteraction('process_changes_to_draft', {
      confirmed_count: collected.length,
      applied_count: appliedCount,
      not_applied_count: confirmations.length - appliedCount,
      last_applied_start: lastRange?.start ?? null,
    });
    navigate(`${base}/analyse/draft`);
  }

  async function handleCheckWithAgent(id, agentKey, item, solutionValue) {
    const excerpt = getExcerptForValidation(agentKey, item);
    setValidatingFindingId(id);
    setValidateSolutionResult(null);
    try {
      const data = await validateSolution(excerpt, solutionValue || item.recommendation || '');
      setValidateSolutionResult({ findingId: id, feedback: data.feedback || '' });
      logInteraction('validate_solution', { finding_id: id, agent_key: agentKey, feedback: data.feedback || '' });
    } catch (e) {
      console.error('Validate solution failed:', e);
      setValidateSolutionResult({ findingId: id, feedback: `Error: ${e.message}` });
      logInteraction('validate_solution_failed', { finding_id: id, agent_key: agentKey, error: e.message || 'Validate failed' });
    } finally {
      setValidatingFindingId(null);
    }
  }

  async function handleAddNote(findingIdArg, agentKey, item, note, attachments = []) {
    await addFindingNote({
      user_name: effectiveRequester || 'Unknown',
      document_id: effectiveDocId || '',
      tracking_id: result?.tracking_id || '',
      finding_id: findingIdArg,
      finding_summary: typeof item === 'object' ? item : { raw: String(item) },
      agent_key: agentKey,
      note,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    logInteraction('agent_feedback_added', { finding_id: findingIdArg, agent_key: agentKey, attachment_count: attachments.length });
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
    setIsDraftUserEdited(false);
    setDraftConfirmationItems([]);
    setSelectedMetricFilter(null);
    setValidateSolutionResult(null);
    setValidatingFindingId(null);
  }, [result?.tracking_id]);

  const fromIngestState = location.state?.fromIngest && location.state?.documentId;
  const trackingSessionMeta = trackingIdFromUrl ? loadedSessionMeta : null;
  // Effective document: tracking session metadata first when reviewing a stored session; otherwise URL / state / config, then result fallback.
  const effectiveDocId = trackingSessionMeta?.documentId || documentIdFromUrl || (location.state?.fromIngest && location.state?.documentId) || (location.state?.generatedContent && location.state?.documentId) || config.documentId || (result?.document_id || '');
  const effectiveTitle = trackingSessionMeta?.title || titleFromUrl || (location.state?.fromIngest && location.state?.title) || (location.state?.generatedContent && location.state?.title) || config.title || config.documentId || (result?.title || result?.document_id || '');
  const effectiveDocLayer = (
    trackingSessionMeta?.docLayer ||
    location.state?.docLayer ||
    result?.doc_layer ||
    config.docLayer ||
    'sop'
  ).toLowerCase();
  const effectiveRequester = trackingSessionMeta?.requester || config.requester || '';
  const effectiveSites = trackingSessionMeta?.sites?.length
    ? trackingSessionMeta.sites
    : (Array.isArray(config.sites) ? config.sites : (config.sites ? String(config.sites).split(/[,\s]+/).filter(Boolean) : []));
  const effectiveSitesDisplay = effectiveSites.includes('all') ? 'All Sites' : effectiveSites.join(',');
  const effectiveResultJson = result ? {
    ...result,
    draft_content: draftContent || result.draft_content || '',
  } : {};

  // If the user navigates to Analyse for a different document, clear any prior result
  // so findings from the previous document cannot be shown for the new one.
  // Target doc can come from URL, location state (from Ingest or Create), or config.
  useEffect(() => {
    if (trackingIdFromUrl) return; // Viewing a stored session – don't clear based on doc mismatch
    const targetDocId = (
      documentIdFromUrl ||
      (location.state?.fromIngest && location.state?.documentId) ||
      (location.state?.generatedContent && location.state?.documentId) ||
      config.documentId ||
      ''
    ).trim();
    if (!targetDocId) return;
    const resultDocId = (result?.document_id || '').trim();
    if (!resultDocId) return;
    if (normaliseDocId(resultDocId) !== normaliseDocId(targetDocId)) {
      setResult(null);
      setDraftContent('');
      setHighlightSearch('');
    }
  }, [trackingIdFromUrl, documentIdFromUrl, location.state?.fromIngest, location.state?.documentId, location.state?.generatedContent, config.documentId, result?.document_id, setResult]);

  // When arriving from Ingest (state or URL), sync config so it matches the document we're analysing
  useEffect(() => {
    const docId = documentIdFromUrl || (location.state?.fromIngest && location.state?.documentId) || (location.state?.generatedContent && location.state?.documentId) || '';
    const docTitle = titleFromUrl || (location.state?.fromIngest && location.state?.title) || (location.state?.generatedContent && location.state?.title) || docId;
    const docLayer = (location.state?.docLayer || result?.doc_layer || 'sop');
    const sites = location.state?.sites;
    if (!docId) return;
    setConfig(c => {
      const nextDocLayer = docLayer || c.docLayer || 'sop';
      const nextSites = Array.isArray(sites) ? sites : c.sites;
      if (c.documentId === docId && c.title === docTitle && c.docLayer === nextDocLayer) return c;
      return { ...c, documentId: docId, title: docTitle, docLayer: nextDocLayer, requestType: location.state?.generatedContent ? 'new_document' : c.requestType, ...(nextSites != null && { sites: nextSites }) };
    });
  }, [documentIdFromUrl, titleFromUrl, fromIngestState, location.state?.documentId, location.state?.title, location.state?.docLayer, location.state?.generatedContent, location.state?.sites, result?.doc_layer, setConfig]);

  // When arriving from Create WI with generated content, set draft and use it as "original" document
  const generatedContent = location.state?.generatedContent;
  useEffect(() => {
    if (generatedContent && !result) {
      setDraftContent(generatedContent);
    }
  }, [generatedContent, result]);

  // When result has document_id but config doesn't, sync so form and split view stay in sync (e.g. after run from Library)
  useEffect(() => {
    if (!result?.document_id) return;
    setConfig(c => {
      const nextDocId = c.documentId || result.document_id || '';
      const nextTitle = c.title || result.title || result.document_id || '';
      const nextDocLayer = c.docLayer || result.doc_layer || 'sop';
      if (c.documentId && c.title && c.docLayer) return c;
      return { ...c, documentId: nextDocId, title: nextTitle, docLayer: nextDocLayer };
    });
  }, [result?.document_id, result?.title, result?.doc_layer, setConfig]);

  // Auto-select first finding category when result loads so findings are visible without clicking a metric
  const metricOrder = ['risk gaps', 'cleanser', 'specifying', 'structure', 'content integrity', 'sequencing', 'formatting', 'compliance', 'terminology', 'conflicts'];
  useEffect(() => {
    if (!result || selectedMetricFilter) return;
    const count = (key) => {
      if (key === 'risk gaps') return result.risk_gaps?.length || 0;
      if (key === 'cleanser') return result.cleanser_flags?.length || 0;
      if (key === 'structure') return result.structure_flags?.length || 0;
      if (key === 'content integrity') return result.content_integrity_flags?.length || 0;
      if (key === 'specifying') return result.specifying_flags?.length || 0;
      if (key === 'sequencing') return result.sequencing_flags?.length || 0;
      if (key === 'formatting') return result.formatting_flags?.length || 0;
      if (key === 'compliance') return result.compliance_flags?.length || 0;
      if (key === 'terminology') return result.terminology_flags?.length || 0;
      if (key === 'conflicts') return result.conflicts?.length || 0;
      return 0;
    };
    const first = metricOrder.find((key) => count(key) > 0);
    if (first) setSelectedMetricFilter(first);
  }, [result, selectedMetricFilter]);

  // When trackingId in URL, use the stored session metadata as the review source of truth.
  // Still keep explicit documentId validation if one was provided in the URL.
  useEffect(() => {
    if (!trackingIdFromUrl) {
      setLoadedSessionMeta(null);
      return;
    }
    latestTrackingRequestRef.current = trackingIdFromUrl;
    const stateSessionMeta = buildSessionMetadata(sessionFromState, storedResultFromState);
    setLoadedSessionMeta(stateSessionMeta);
    setError(null);
    setSessionNotPersisted(false);
    setResult(null);
    setDraftContent('');
    setHighlightSearch('');
    setLoadingStored(true);
    getAnalysisSession(trackingIdFromUrl)
      .then(session => {
        if (latestTrackingRequestRef.current !== trackingIdFromUrl) return;
        const sessionMeta = buildSessionMetadata(session, session?.result || null);
        setLoadedSessionMeta(sessionMeta);
        const res = session?.result;
        if (res) {
          if (!resultMatchesDocument(res, sessionMeta?.documentId || documentIdFromUrl)) {
            setError('Loaded analysis results do not match the selected document. Run a fresh analysis for this SOP.');
            setLoadedSessionMeta(null);
            setResult(null);
            setDraftContent('');
            return;
          }
          setResult(res);
          setDraftContent(res.draft_content || '');
        } else if (session) {
          setError('Results not stored for this session. Run a new analysis to see findings.');
        }
        if (sessionMeta && !documentIdFromUrl) {
          setConfig(c => ({
            ...c,
            documentId: sessionMeta.documentId || '',
            title: sessionMeta.title || '',
            requester: sessionMeta.requester || '',
            docLayer: sessionMeta.docLayer || 'sop',
            sites: sessionMeta.sites,
          }));
        }
      })
      .catch(() => {
        if (latestTrackingRequestRef.current !== trackingIdFromUrl) return;
        if (storedResultFromState) {
          if (!resultMatchesDocument(storedResultFromState, stateSessionMeta?.documentId || documentIdFromUrl)) {
            setError('Stored analysis results do not match the selected document. Open the latest analysis for this SOP or run a new analysis.');
            setLoadedSessionMeta(null);
            return;
          }
          setLoadedSessionMeta(stateSessionMeta);
          setResult(storedResultFromState);
          setDraftContent(storedResultFromState.draft_content || '');
          if (stateSessionMeta && !documentIdFromUrl) {
            setConfig(c => ({
              ...c,
              documentId: stateSessionMeta.documentId || '',
              title: stateSessionMeta.title || '',
              requester: stateSessionMeta.requester || '',
              docLayer: stateSessionMeta.docLayer || 'sop',
              sites: stateSessionMeta.sites,
            }));
          }
          return;
        }
        setError('Could not load analysis results. The session may not be in the database — run a new analysis to see results.');
        setLoadedSessionMeta(null);
      })
      .finally(() => {
        if (latestTrackingRequestRef.current !== trackingIdFromUrl) return;
        setLoadingStored(false);
      });
  }, [trackingIdFromUrl, documentIdFromUrl, storedResultFromState, sessionFromState, setResult, setConfig]);

  // Fetch original document for split view — DOCX→HTML for procedures, else plain text. For Create WI, use generated content.
  useEffect(() => {
    if (generatedContent && !result) {
      setDocumentContent(generatedContent);
      setDocumentSections([]);
      setDocumentHtml(null);
      setDocumentSourceType('text');
      setLoadingContent(false);
      return;
    }
    if (!result || !effectiveDocId) {
      setDocumentContent(null);
      setDocumentSections([]);
      setDocumentHtml(null);
      setDocumentSourceType(null);
      return;
    }
    const isProcedure = effectiveDocLayer === 'sop' || effectiveDocLayer === 'work_instruction';

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
            const plain = htmlToPlainText(html || '');
            if (plain) setDocumentContent(plain);
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
  }, [result, effectiveDocId, effectiveDocLayer, generatedContent]);

  // Keep review draft anchored to original document once it becomes available.
  // This prevents apply-to-draft misses caused by summarised draft_content baselines.
  useEffect(() => {
    if (mode !== 'review') return;
    if (!documentContent || !documentContent.trim()) return;
    if (isDraftUserEdited) return;
    setDraftContent(prev => {
      const current = (prev || '').trim();
      const source = documentContent.trim();
      return current === source ? prev : source;
    });
  }, [mode, documentContent, isDraftUserEdited]);

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

    // Defer until after paint; HTML highlights run in child useEffect — retry for mammoth DOM
    const id1 = setTimeout(doScroll, 0);
    const id2 = setTimeout(doScroll, 100);
    return () => {
      clearTimeout(id1);
      clearTimeout(id2);
    };
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
    setLoadingStepIndex(0);
    setStreamProgress({ done: 0, total: 0 });
    try {
      const sitesArr = Array.isArray(config.sites) ? config.sites : (config.sites ? String(config.sites).split(/[,\s]+/).filter(Boolean) : []);
      const body = {
        tracking_id: `ui-${Date.now()}`,
        request_type: mode === 'create' && generatedContent ? 'new_document' : (config.requestType || 'single_document_review'),
        doc_layer: docLayerForApi(config.docLayer),
        sites: resolveSitesForApi(sitesArr),
        policy_ref: mode === 'review' ? null : (config.policyRef || null),
        document_id: effectiveDocId || null,
        title: effectiveTitle || effectiveDocId || null,
        requester: config.requester || null,
        agents: config?.mode && config.mode !== 'full' ? config.agents : undefined,
        additional_doc_ids: (config.additionalDocIds || []).length > 0 ? config.additionalDocIds : undefined,
        agent_instructions: (config.agentInstructions || '').trim() || undefined,
      };
      if (mode === 'create' && (generatedContent || (draftContent || '').trim())) {
        body.content = (generatedContent || draftContent || '').trim();
      }
      logInteraction('analysis_run_started', {
        tracking_id: body.tracking_id,
        request_type: body.request_type,
        agent_count: Array.isArray(body.agents) ? body.agents.length : 'full',
      });
      const res = await analyseWithProgress(body, (msg) => {
        if (msg.type === 'start') {
          setStreamProgress({
            done: 0,
            total: Math.max(1, msg.total || ANALYSIS_LOADING_STEPS.length),
          });
        }
        if (msg.type === 'progress') {
          setStreamProgress((prev) => {
            const total = prev.total || ANALYSIS_LOADING_STEPS.length;
            return { total, done: Math.min(total, prev.done + 1) };
          });
          const idx = ANALYSIS_LOADING_STEPS.findIndex((s) => s.key === msg.step_key);
          if (idx >= 0) setLoadingStepIndex(idx);
        }
      });
      setStreamProgress((prev) =>
        prev.total > 0 ? { ...prev, done: prev.total } : prev,
      );
      setResult(res);
      // In review mode, preserve source document integrity as the draft baseline.
      if (mode === 'review' && documentContent) setDraftContent(documentContent);
      else setDraftContent(res.draft_content || '');
      recordSession(res, { ...config, documentId: effectiveDocId, title: effectiveTitle }, workflowMode);
      logInteraction('analysis_run_completed', {
        tracking_id: res.tracking_id,
        total_findings:
          (res.risk_gaps?.length || 0) + (res.cleanser_flags?.length || 0) + (res.specifying_flags?.length || 0) +
          (res.structure_flags?.length || 0) + (res.content_integrity_flags?.length || 0) + (res.sequencing_flags?.length || 0) +
          (res.formatting_flags?.length || 0) + (res.compliance_flags?.length || 0) + (res.terminology_flags?.length || 0) + (res.conflicts?.length || 0),
      });
      if (res.session_saved === false) {
        setSessionNotPersisted(true);
      }
      // Auto-save to backend so dashboard reflects metrics
      const totalFindings =
        (res.risk_gaps?.length || 0) + (res.cleanser_flags?.length || 0) + (res.specifying_flags?.length || 0) + (res.structure_flags?.length || 0) +
        (res.content_integrity_flags?.length || 0) + (res.sequencing_flags?.length || 0) + (res.formatting_flags?.length || 0) +
        (res.compliance_flags?.length || 0) + (res.terminology_flags?.length || 0) + (res.conflicts?.length || 0);
      const agentFindings = {};
      if (res.risk_gaps?.length) agentFindings.risk = res.risk_gaps.length;
      if (res.cleanser_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + res.cleanser_flags.length;
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
          result_json: {
            ...res,
            document_id: effectiveDocId || res.document_id || '',
            title: effectiveTitle || res.title || res.document_id || '',
            doc_layer: effectiveDocLayer || res.doc_layer || 'sop',
            draft_content: draftContent || res.draft_content || '',
          },
        });
      } catch (_) { /* non-blocking */ }
    } catch (err) {
      setError(err.message);
      logInteraction('analysis_run_failed', { error: err.message || 'Analysis failed' });
    } finally {
      setLoading(false);
    }
  }

  const flagCounts = result ? {
    'risk gaps':         result.risk_gaps?.length || 0,
    'cleanser':          result.cleanser_flags?.length || 0,
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
  const visibleFlagKeys = flagCounts ? Object.keys(flagCounts).filter((k) => k !== 'content integrity') : [];
  const totalVisibleFindings = visibleFlagKeys.reduce((sum, key) => sum + (flagCounts?.[key] || 0), 0);
  const totalVisibleApplied = visibleFlagKeys.reduce((sum, key) => sum + (appliedCountByFlag?.[key] || 0), 0);

  const isCreate = mode === 'create';
  const hasDraft = !!result; // Show draft in both modes when analysis has run — apply changes update it
  const displayDraft = draftContent || documentContent || result?.draft_content || '';

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const agentFindings = {};
      if (result.risk_gaps?.length) agentFindings.risk = result.risk_gaps.length;
      if (result.cleanser_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + result.cleanser_flags.length;
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
        document_id: effectiveDocId || '',
        title: effectiveTitle || effectiveDocId || 'Unnamed',
        requester: effectiveRequester,
        doc_layer: docLayerForApi(effectiveDocLayer),
        sites: effectiveSitesDisplay,
        overall_risk: result.overall_risk || null,
        total_findings: totalFindings,
        agents_run: result.agents_run || [],
        agent_findings: agentFindings,
        corrections_implemented: totalApplied,
        result_json: effectiveResultJson,
      });
      setSaveStatus(res?.ok !== false ? 'saved' : 'error');
      logInteraction(res?.ok !== false ? 'analysis_save' : 'analysis_save_failed', {
        tracking_id: result.tracking_id,
        corrections_implemented: totalApplied,
      });
      if (res?.ok !== false) setTimeout(() => setSaveStatus(null), 2500);
    } catch (err) {
      setSaveStatus('error');
      logInteraction('analysis_save_failed', {
        tracking_id: result.tracking_id,
        error: err.message || 'Save failed',
      });
      setTimeout(() => setSaveStatus(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadAuditPack() {
    if (!result) return;
    setAuditPackDownloading(true);
    setAuditPackError(null);
    try {
      const sitesArr = resolveSitesForApi(Array.isArray(effectiveSites) ? effectiveSites : []);
      const payload = {
        ...effectiveResultJson,
        document_id: effectiveDocId || effectiveResultJson.document_id || '',
        title: effectiveTitle || effectiveResultJson.title || '',
        doc_layer: docLayerForApi(effectiveDocLayer),
        sites: sitesArr,
        ...(effectiveRequester ? { requester: effectiveRequester } : {}),
      };
      const { blob, filename } = await downloadAuditPack(payload);
      const safeName = String(filename || 'audit-pack.md').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'audit-pack.md';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Revoking immediately can abort the download in some browsers; defer cleanup.
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 2000);
      logInteraction('audit_pack_download', { tracking_id: result.tracking_id });
    } catch (err) {
      const msg = err?.message || 'Download failed';
      setAuditPackError(msg);
      window.setTimeout(() => setAuditPackError(null), 8000);
      logInteraction('audit_pack_download_failed', {
        tracking_id: result.tracking_id,
        error: msg,
      });
    } finally {
      setAuditPackDownloading(false);
    }
  }

  async function handleDownloadAuditPackDocx() {
    if (!result) return;
    setAuditPackDocxDownloading(true);
    setAuditPackError(null);
    try {
      const sitesArr = resolveSitesForApi(Array.isArray(effectiveSites) ? effectiveSites : []);
      const payload = {
        ...effectiveResultJson,
        document_id: effectiveDocId || effectiveResultJson.document_id || '',
        title: effectiveTitle || effectiveResultJson.title || '',
        doc_layer: docLayerForApi(effectiveDocLayer),
        sites: sitesArr,
        ...(effectiveRequester ? { requester: effectiveRequester } : {}),
      };
      const { blob, filename } = await downloadAuditPackDocx(payload);
      const safeName = String(filename || 'audit-pack.docx').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'audit-pack.docx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 2000);
      logInteraction('audit_pack_docx_download', { tracking_id: result.tracking_id });
    } catch (err) {
      const msg = err?.message || 'Download failed';
      setAuditPackError(msg);
      window.setTimeout(() => setAuditPackError(null), 8000);
      logInteraction('audit_pack_docx_download_failed', {
        tracking_id: result.tracking_id,
        error: msg,
      });
    } finally {
      setAuditPackDocxDownloading(false);
    }
  }

  async function handleSubmitForHITL() {
    if (!result) return;
    setHitlSubmitStatus(null);
    try {
      const agentFindings = {};
      if (result.risk_gaps?.length) agentFindings.risk = result.risk_gaps.length;
      if (result.cleanser_flags?.length) agentFindings.cleansing = (agentFindings.cleansing || 0) + result.cleanser_flags.length;
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
        document_id: effectiveDocId || '',
        title: effectiveTitle || effectiveDocId || 'Unnamed',
        requester: effectiveRequester,
        doc_layer: docLayerForApi(effectiveDocLayer),
        sites: effectiveSitesDisplay,
        overall_risk: result.overall_risk || null,
        total_findings: totalFindings,
        agents_run: result.agents_run || [],
        agent_findings: agentFindings,
        corrections_implemented: totalApplied,
        result_json: effectiveResultJson,
      });
      setHitlSubmitStatus('submitted');
      logInteraction('submit_for_hitl', {
        tracking_id: result.tracking_id,
        corrections_implemented: totalApplied,
      });
      setTimeout(() => setHitlSubmitStatus(null), 3000);
    } catch {
      setHitlSubmitStatus('error');
      logInteraction('submit_for_hitl_failed', {
        tracking_id: result?.tracking_id || '',
      });
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
            Agent pipeline · {effectiveDocLayer || 'sop'}
            {effectiveSites.length ? ` · ${effectiveSites.includes('all') ? 'All Sites' : effectiveSites.join(', ')}` : ''}
            {effectiveRequester ? ` · Requester: ${effectiveRequester}` : ''}
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
      </form>

      {loadingStored && (
        <div className="analyse-loading-overlay">
          <div className="analyse-loading-spinner" />
          <p>Loading analysis results…</p>
        </div>
      )}

      {loading && (
        <AnalysisLoadingPanel
          activeIndex={loadingStepIndex}
          progressPercent={
            streamProgress.total > 0
              ? (streamProgress.done / streamProgress.total) * 100
              : null
          }
        />
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
                {!loadingContent && !documentHtml && !documentContent && (
                  <p className="split-unavailable">
                    Original document not available for highlights. Re-ingest the document (Library or Configure) to enable the left panel and click-to-highlight. Excerpts are still shown in each finding below.
                  </p>
                )}
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
            <div className="resolved-counter">{totalVisibleApplied} of {totalVisibleFindings} resolved</div>
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
              <button
                type="button"
                className="doc-btn"
                onClick={handleDownloadAuditPack}
                disabled={!result || auditPackDownloading}
                title="Download Markdown audit pack (includes compliance clause mapping)"
              >
                {auditPackDownloading ? 'Preparing pack…' : 'Download audit pack'}
              </button>
              <button
                type="button"
                className="doc-btn"
                onClick={handleDownloadAuditPackDocx}
                disabled={!result || auditPackDocxDownloading}
                title="Download structured DOCX audit pack"
              >
                {auditPackDocxDownloading ? 'Preparing DOCX…' : 'Download audit pack (DOCX)'}
              </button>
              {auditPackError && (
                <span className="audit-pack-error" role="alert" title={auditPackError}>
                  {auditPackError}
                </span>
              )}
              <button type="button" className="doc-btn" onClick={() => navigate(`${base}/analyse/draft`)}>
                Go to Draft →
              </button>
            </div>
          </div>

          <div className="agent-cards">
            {!selectedMetricFilter && (
              <div className="agent-cards-placeholder-wrap">
                <p className="agent-cards-placeholder">Click a metric above to view findings for that category.</p>
                {result.compliance_flags?.length > 0 && (
                  <p className="agent-cards-hint">
                    <strong>Policy clause mapping</strong> is shown on each <strong>Compliance</strong> finding — click the <strong>Compliance</strong> metric tile above to open that list.
                  </p>
                )}
              </div>
            )}
            {result.risk_gaps?.length > 0 && selectedMetricFilter === 'risk gaps' && (
              <div id="agent-card-risk"><RiskGapCard items={result.risk_gaps} agentKey="risk"
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.cleanser_flags?.length > 0 && selectedMetricFilter === 'cleanser' && (
              <div id="agent-card-cleanser"><AgentCard title="Cleanser" items={result.cleanser_flags} agentKey="cleanser"
                keys={['location', 'issue_category', 'current_text', 'issue', 'recommendation']} searchTextKeys={['current_text', 'location']}
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
                keys={['location', 'current_text', 'issue', 'recommendation']} searchTextKeys={['current_text', 'location']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.sequencing_flags?.length > 0 && selectedMetricFilter === 'sequencing' && (
              <div id="agent-card-sequencing"><AgentCard title="Sequencing" items={result.sequencing_flags} agentKey="sequencing"
                keys={['location', 'excerpt', 'issue', 'impact', 'recommendation']} searchTextKeys={['excerpt', 'location']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.formatting_flags?.length > 0 && selectedMetricFilter === 'formatting' && (
              <div id="agent-card-formatting"><AgentCard title="Formatting" items={result.formatting_flags} agentKey="formatting"
                keys={['location', 'excerpt', 'issue', 'recommendation']} searchTextKeys={['excerpt', 'location']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.compliance_flags?.length > 0 && selectedMetricFilter === 'compliance' && (
              <div id="agent-card-compliance"><AgentCard title="Compliance" items={result.compliance_flags} agentKey="compliance"
                keys={['location', 'excerpt', 'issue', 'recommendation']} searchTextKeys={['excerpt', 'location']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.terminology_flags?.length > 0 && selectedMetricFilter === 'terminology' && (
              <div id="agent-card-terminology"><AgentCard title="Terminology" items={result.terminology_flags} agentKey="terminology"
                keys={['term', 'location', 'issue', 'recommendation']} searchTextKeys={['location', 'term']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
            {result.conflicts?.length > 0 && selectedMetricFilter === 'conflicts' && (
              <div id="agent-card-conflict"><AgentCard title="Conflicts" items={result.conflicts} agentKey="conflict"
                keys={['conflict_type', 'severity', 'description', 'recommendation']} searchTextKeys={['description']}
                onFindingClick={effectiveDocId ? setHighlightSearch : undefined}
                onApplyChange={handleApplyFinding} onAddNote={handleAddNote}
                appliedFindings={appliedFindings} findingId={findingId}
                customSolutionByFindingId={customSolutionByFindingId} onCustomSolutionChange={(id, text) => setCustomSolutionByFindingId(prev => ({ ...prev, [id]: text }))}
                onCheckWithAgent={handleCheckWithAgent} validateSolutionResult={validateSolutionResult} validatingFindingId={validatingFindingId} /></div>
            )}
          </div>

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
              {!draftEditMode && (
                <span className="draft-layout-hint">Structured layout (sections, numbered steps, bullets)</span>
              )}
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
              {draftConfirmationItems.length > 0 && (
                <div className="draft-confirmation-panel" role="status">
                  <p className="draft-confirmation-summary">
                    {draftConfirmationItems.filter(i => i.status === 'applied').length} of {draftConfirmationItems.length} confirmed changes applied to draft.
                  </p>
                  <ul className="draft-confirmation-list">
                    {draftConfirmationItems.map((item) => (
                      <li key={item.id} className={`draft-confirmation-item ${item.status}`}>
                        <span className="draft-confirmation-icon" aria-hidden="true">{item.status === 'applied' ? '✓' : '✗'}</span>
                        <span className="draft-confirmation-text">{item.label}</span>
                        {item.detail && <span className="draft-confirmation-detail"> — {item.detail}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {draftEditMode ? (
              <DraftEditor
                value={displayDraft}
                onChange={setDraftContent}
                lastAppliedRange={lastAppliedRange}
                onEdit={() => {
                  setLastAppliedRange(null);
                  setIsDraftUserEdited(true);
                }}
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
  'Scope', 'Reference documents', 'References', 'Responsibility', 'Responsibilities',
  'Frequency', 'Procedure', 'Procedures', 'Method', 'Methods',
  'Record Keeping', 'Corrective Actions', 'Picking orders', 'Loading Procedure',
  'Trailer information', 'Definitions', 'Overview', 'Introduction',
  'Related documents', 'Revision history', 'History of Change'
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
  const SECTION_ALIASES = {
    scope: ['scope'],
    references: ['reference documents', 'references', 'related documents'],
    responsibility: ['responsibility', 'responsibilities'],
    frequency: ['frequency'],
    procedure: ['procedure', 'procedures', 'method', 'methods'],
  };

  const sectionModel = {
    scope: [],
    references: [],
    responsibility: [],
    frequency: [],
    procedure: [],
  };

  const matchSectionKey = (heading) => {
    const t = String(heading || '').trim().toLowerCase();
    if (!t) return null;
    for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
      if (aliases.some((a) => t === a || t.startsWith(`${a}:`))) return key;
    }
    return null;
  };

  let currentKey = 'procedure';
  for (const block of blocks) {
    if (block.type === 'section') {
      const key = matchSectionKey(block.content);
      if (key) {
        currentKey = key;
      } else {
        currentKey = 'procedure';
        sectionModel.procedure.push({ type: 'paragraph', content: String(block.content || '').trim() });
      }
      continue;
    }
    sectionModel[currentKey].push(block);
  }

  const isAmendment = (text) => /^\s*amendment\s*:/i.test(String(text || '').trim());
  const renderBlocks = (sectionKey, blocksToRender) => {
    if (!blocksToRender || blocksToRender.length === 0) {
      return <p className="draft-template-empty">No content captured.</p>;
    }
    return blocksToRender.map((b, idx) => {
      const blockKey = `${sectionKey}-${idx}`;
      if (b.type === 'numbered') {
        return (
          <ol key={blockKey} className="draft-structured-list draft-structured-list--numbered">
            {b.items.map((item, i) => (
              <li key={i} className={isAmendment(item) ? 'draft-amendment-line' : ''}>
                {isAmendment(item) ? <span className="draft-amendment-badge">Amendment</span> : null}
                {item.replace(/^\s*amendment\s*:\s*/i, '')}
              </li>
            ))}
          </ol>
        );
      }
      if (b.type === 'bullet') {
        return (
          <ul key={blockKey} className="draft-structured-list draft-structured-list--bullet">
            {b.items.map((item, i) => (
              <li key={i} className={isAmendment(item) ? 'draft-amendment-line' : ''}>
                {isAmendment(item) ? <span className="draft-amendment-badge">Amendment</span> : null}
                {item.replace(/^\s*amendment\s*:\s*/i, '')}
              </li>
            ))}
          </ul>
        );
      }
      return (
        <p key={blockKey} className={`draft-structured-para ${isAmendment(b.content) ? 'draft-amendment-line' : ''}`}>
          {isAmendment(b.content) ? <span className="draft-amendment-badge">Amendment</span> : null}
          {String(b.content || '').replace(/^\s*amendment\s*:\s*/i, '')}
        </p>
      );
    });
  };

  return (
    <div className="draft-structured-view">
      <section className="draft-section-card"><h3 className="draft-structured-section">Title</h3><p className="draft-template-empty">Preserved from source document metadata.</p></section>
      <section className="draft-section-card"><h3 className="draft-structured-section">Scope</h3>{renderBlocks('scope', sectionModel.scope)}</section>
      <section className="draft-section-card"><h3 className="draft-structured-section">Reference Documents</h3>{renderBlocks('references', sectionModel.references)}</section>
      <section className="draft-section-card"><h3 className="draft-structured-section">Responsibility</h3>{renderBlocks('responsibility', sectionModel.responsibility)}</section>
      <section className="draft-section-card"><h3 className="draft-structured-section">Frequency</h3>{renderBlocks('frequency', sectionModel.frequency)}</section>
      <section className="draft-section-card"><h3 className="draft-structured-section">Procedure</h3>{renderBlocks('procedure', sectionModel.procedure)}</section>
      <section className="draft-section-card">
        <h3 className="draft-structured-section">History of document change</h3>
        <p className="draft-template-empty">Populate change log at approval stage (date, issue number, reason, training required, authorised by).</p>
      </section>
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

  // Apply highlights in HTML DOM when highlightSearch changes (cross-node + per-node fallback)
  useEffect(() => {
    if (sourceType !== 'html' || !htmlContainerRef.current || !htmlContent) return;
    const container = htmlContainerRef.current;
    container.innerHTML = htmlContent;

    const search = highlightSearch?.trim();
    if (!search || search.length < 2) return;

    const textNodes = collectTextNodesUnder(container);
    const full = textNodes.map((n) => n.textContent).join('');
    const span = findExcerptMatchSpan(full, search);
    if (span) {
      const range = rangeFromTextOffsets(textNodes, span.start, span.length);
      if (range) {
        surroundRangeWithHighlightMark(range);
        return;
      }
    }

    // Fallback: excerpt split across elements sometimes still fails — try per-text-node regex
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escapeRegex(search)})`, 'gi');
    textNodes.forEach((node) => {
      re.lastIndex = 0;
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
    const tryHighlight = (needle) => {
      try {
        const re = new RegExp(`(${escapeRegex(needle)})`, 'gi');
        const parts = text.split(re);
        if (parts.length <= 1) return null;
        return parts.map((part, j) =>
          j % 2 === 1 ? (
            <mark key={`${needle.length}-${j}`} className="original-doc-highlight" data-highlight>{part}</mark>
          ) : part
        );
      } catch {
        return null;
      }
    };
    const full = tryHighlight(search);
    if (full) return full;
    for (let len = Math.min(search.length, 160); len >= 20; len -= 8) {
      const sub = search.slice(0, len);
      const partial = tryHighlight(sub);
      if (partial) return partial;
    }
    const n = normalizeForDocSearch(text);
    const ns = normalizeForDocSearch(search);
    if (ns.length >= 2) {
      const idx = n.toLowerCase().indexOf(ns.toLowerCase());
      if (idx >= 0) {
        const before = text.slice(0, idx);
        const mid = text.slice(idx, idx + ns.length);
        const after = text.slice(idx + ns.length);
        return (
          <>
            {before}
            <mark className="original-doc-highlight" data-highlight>{mid}</mark>
            {after}
          </>
        );
      }
    }
    return text;
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
// Risk Gap card — sorted by HACCP RPN score, shows score bar inline
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
              <HaccpRpnBar score={gap.fmea_score} band={gap.fmea_band} />
            </div>
            {gap.fmea_score > 0 && (
              <div
                className="haccp-rpn-dimensions"
                title={!(gap.detectability > 0) ? 'Detectability omitted; 3 used in HACCP score' : undefined}
              >
                Severity={gap.severity} · Likelihood={gap.likelihood ?? gap.scope}
                {' · '}
                Detectability={gap.detectability > 0 ? gap.detectability : '3 (default)'}
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
            {agentKey === 'compliance' && (() => {
              const cm = item.clause_mapping || { status: 'unmapped', unmapped_reason: 'not_run' };
              return (
              <div className={`clause-mapping ${cm.status === 'linked' ? 'clause-mapping-linked' : 'clause-mapping-hitl'}`}>
                {cm.status === 'linked' ? (
                  <details className="clause-mapping-details">
                    <summary className="clause-mapping-summary">
                      <span className="clause-mapping-label-inline">Policy clause (verified)</span>
                      <span className="clause-mapping-citation-inline">{cm.canonical_citation || [cm.standard_name, cm.clause_id].filter(Boolean).join(' ')}</span>
                    </summary>
                    <div className="clause-mapping-body">
                      {cm.requirement_preview && (
                        <div className="clause-mapping-section">
                          <div className="clause-mapping-section-label">Policy clause text</div>
                          <div className="clause-mapping-preview">{cm.requirement_preview}</div>
                        </div>
                      )}
                      {cm.supporting_quote && (
                        <div className="clause-mapping-section">
                          <div className="clause-mapping-section-label">Verified match</div>
                          <div className="clause-mapping-quote">
                            “{cm.supporting_quote.slice(0, 320)}{cm.supporting_quote.length > 320 ? '…' : ''}”
                          </div>
                        </div>
                      )}
                      {cm.site_scope && cm.site_scope.length > 0 && (
                        <div className="clause-mapping-site-scope">
                          <span className="clause-mapping-site-scope-label">Sites in scope:</span>
                          {cm.site_scope.map(s => (
                            <span key={s} className="clause-mapping-site-badge">{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                ) : (
                  <details className="clause-mapping-details">
                    <summary className="clause-mapping-summary">
                      <span className="clause-mapping-label-inline clause-mapping-label-hitl">Policy clause — review needed</span>
                      {(cm.canonical_citation || cm.clause_id) && (
                        <span className="clause-mapping-citation-inline clause-mapping-tentative">{cm.canonical_citation || cm.clause_id} (tentative)</span>
                      )}
                    </summary>
                    <div className="clause-mapping-body">
                      <div className="clause-mapping-reason">
                        {cm.unmapped_reason === 'no_candidates' && 'No lexical match in scoped standards — map manually (ingest BRCGS / Cranswick standard with clause structure).'}
                        {cm.unmapped_reason === 'no_policy_scope' && 'No policy documents in scope — check Supabase / policy ingest.'}
                        {cm.unmapped_reason === 'model_none' && 'No candidate clause selected — map manually.'}
                        {cm.unmapped_reason === 'verify_failed' && 'Could not verify quote against requirement text — map manually.'}
                        {cm.unmapped_reason === 'error' && 'Mapping failed — map manually.'}
                        {cm.unmapped_reason === 'not_run' && 'No clause mapping on this record — run a new analysis to attach policy clauses (saved sessions before this feature show this).'}
                        {cm.unmapped_reason === 'disabled' && 'Clause mapping is turned off (CLAUSE_MAPPING_ENABLED).'}
                        {!cm.unmapped_reason && 'Map manually to the correct standard clause.'}
                      </div>
                    </div>
                  </details>
                )}
              </div>
              );
            })()}
            {keys.filter(k => {
              if (k === 'excerpt') return false;
              if (k === 'policy_evidence') return false;
              if (k === 'citations') return false;
              if (k === 'requirement_reference') return false;
              if (k === 'current_text' && (item.excerpt || item.current_text)) return false;
              return true;
            }).map((k) => {
              const val = item[k];
              const show = val && (!Array.isArray(val) || val.length > 0);
              if (!show) return null;
              const displayVal = Array.isArray(val) ? val.join(', ') : String(val);
              return (
                <div key={k} className="agent-field">
                  <span className="agent-field-label">{`${k}:`}</span>{' '}
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
