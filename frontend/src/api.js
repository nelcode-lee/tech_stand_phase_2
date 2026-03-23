/**
 * API client for Tech Standards backend.
 */
const BASE = import.meta.env.VITE_API_URL || '/api';

/** Policy-layer variants sent as 'policy' to the backend. */
export function docLayerForApi(layer) {
  if (layer === 'policy_brcgs' || layer === 'policy_cranswick') return 'policy';
  return layer || 'sop';
}

function errorMessage(err, fallback) {
  if (err.detail) {
    return Array.isArray(err.detail)
      ? err.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
      : String(err.detail);
  }
  return err.message || fallback;
}

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(errorMessage(err, res.statusText || `HTTP ${res.status}`));
  }
  return res.json();
}

export async function health() {
  return request('/health');
}

export async function ingestFile(file, metadata = {}) {
  const form = new FormData();
  const docId = (metadata.document_id || '').trim() || file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-') || 'document';
  form.append('file', file);
  form.append('document_id', docId);
  form.append('doc_layer', metadata.doc_layer || 'sop');
  form.append('sites', metadata.sites ? (Array.isArray(metadata.sites) ? metadata.sites.join(',') : metadata.sites) : '');
  if (metadata.policy_ref) form.append('policy_ref', metadata.policy_ref);
  if (metadata.title) form.append('title', metadata.title);
  if (metadata.library) form.append('library', metadata.library);
  const url = `${BASE}/ingest/file`;
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
      : typeof detail === 'string'
        ? detail
        : res.statusText || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

export async function analyse(body) {
  return request('/analyse', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Generate or refine a Work Instruction from qualifying questions.
 * @param {object} body - task_name, parent_sop?, site?, process_type?, has_measurements, measurements_detail?, has_safety, safety_detail?, needs_visuals, needs_checklist, reference_doc_ids?, follow_up_message?, previous_draft?
 * @returns {Promise<{draft: string, suggested_document_id: string}>}
 */
export async function generateWorkInstruction(body) {
  return request('/analysis/generate-work-instruction', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Run analysis with NDJSON streaming: progress events then final result.
 * @param {object} body - Same payload as analyse()
 * @param {(msg: object) => void} [onEvent] - Called for each line: start, progress, complete (complete also returns from promise)
 * @returns {Promise<object>} Final analysis result (same shape as analyse())
 */
export async function analyseWithProgress(body, onEvent) {
  const url = `${BASE}/analyse?stream=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(errorMessage(err, res.statusText || `HTTP ${res.status}`));
  }
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response not supported');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl < 0) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (onEvent) onEvent(msg);
      if (msg.type === 'complete') finalResult = msg.result;
      if (msg.type === 'http_error') {
        const d = msg.detail;
        throw new Error(typeof d === 'string' ? d : JSON.stringify(d));
      }
      if (msg.type === 'error') throw new Error(msg.message || 'Analysis failed');
    }
  }
  if (!finalResult) {
    throw new Error('Analysis ended without a result');
  }
  return finalResult;
}

/**
 * Re-validate a proposed solution against the original excerpt. Returns { feedback }.
 */
export async function validateSolution(excerpt, proposedSolution) {
  return request('/analyse/validate-solution', {
    method: 'POST',
    body: JSON.stringify({
      excerpt: excerpt || '',
      proposed_solution: proposedSolution || '',
    }),
  });
}

/**
 * Q&A over the document library. Returns { answer, citations }.
 * @param {string} question - The question to answer
 * @param {string} [documentId] - Optional: scope to one document
 * @param {string} [docLayer] - Optional: filter by layer (policy, principle, sop, work_instruction)
 */
export async function queryDocuments(question, documentId, docLayer) {
  return request('/query', {
    method: 'POST',
    body: JSON.stringify({
      question,
      document_id: documentId || undefined,
      doc_layer: docLayer || undefined,
    }),
  });
}

/**
 * Fetch all ingested documents from the vector store.
 * Returns an array of { document_id, title, doc_layer, sites, library, source_path, chunk_count }.
 */
export async function listDocuments() {
  return request('/ingest/documents');
}

/**
 * Update document metadata (sites, title, doc_layer, library, policy_ref).
 * Persists to both registry and vector store chunks.
 */
export async function updateDocumentMetadata(documentId, body) {
  return request(`/ingest/documents/${encodeURIComponent(documentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Delete a document from the registry and vector store.
 */
export async function deleteDocument(documentId) {
  return request(`/ingest/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
}

/**
 * Reset dashboard metrics (delete all analysis sessions) and prune library to only
 * "local-Cranswick Manufacturing Standard v2" and "BRCGS - Food Safety Standard - V9".
 * Returns { ok, sessions_deleted, documents_removed, documents_kept }.
 */
export async function resetMetricsAndPruneLibrary() {
  return request('/ingest/admin/reset-metrics-and-library', {
    method: 'POST',
  });
}

/**
 * Clear all ingested SOPs / work instructions, finding notes, user-note vectors,
 * and all analysis sessions. Keeps policy & principle documents (BRCGS, Cranswick MS, etc.).
 */
export async function clearSopsAndResetMetrics() {
  return request('/ingest/admin/clear-sops-and-reset-metrics', {
    method: 'POST',
  });
}

/**
 * Fetch full document content for cross-reference with findings (split view).
 * Returns { document_id, content, sections }.
 */
export async function getDocumentContent(documentId) {
  return request(`/ingest/documents/${encodeURIComponent(documentId)}/content`);
}

/**
 * Fetch original DOCX file bytes for procedures (sop, work_instruction).
 * Returns a Blob for use with mammoth.js. 404 if source file not stored.
 */
export async function getDocumentFile(documentId) {
  const url = `${BASE}/ingest/documents/${encodeURIComponent(documentId)}/file`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText || `HTTP ${res.status}`);
  }
  return res.blob();
}

/**
 * Fetch recent analysis sessions for dashboard metrics.
 * Returns an array of { trackingId, documentId, title, docLayer, sites, overallRisk,
 *   totalFindings, agentsRun, agentFindings, workflowType, completedAt }.
 */
export async function listAnalysisSessions(limit = 50) {
  return request(`/analysis/sessions?limit=${limit}`);
}

/**
 * Fetch a single analysis session with full result (findings, flags, etc.).
 */
export async function getAnalysisSession(trackingId) {
  return request(`/analysis/sessions/${encodeURIComponent(trackingId)}`);
}

/**
 * Fetch user finding notes (logs). Returns [{ id, user_name, document_id, tracking_id, finding_id, finding_summary, agent_key, note, attachments, created_at }].
 */
export async function listFindingNotes(limit = 100) {
  return request(`/analysis/finding-notes?limit=${limit}`);
}

/**
 * Add a user note to a finding. Logged and fed into knowledge base.
 * @param {object} body - { user_name, document_id, tracking_id, finding_id, finding_summary, agent_key, note, attachments? }
 */
export async function addFindingNote(body) {
  return request('/analysis/finding-notes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Fetch recent interaction logs for governance review.
 */
export async function listInteractionLogs(limit = 200) {
  return request(`/analysis/interaction-logs?limit=${limit}`);
}

/**
 * Add one governance interaction log entry.
 */
export async function addInteractionLog(body) {
  return request('/analysis/interaction-logs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Save analysis session (captures changes, ensures state is persisted).
 */
export async function saveAnalysisSession(body) {
  return request('/analysis/save', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Export draft content as DOCX. Returns a Blob.
 */
export async function exportDraftDocx(content, filename = 'draft') {
  const url = `${BASE}/draft`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, filename }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || res.statusText || `HTTP ${res.status}`);
  }
  return res.blob();
}
