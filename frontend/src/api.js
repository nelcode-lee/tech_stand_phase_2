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

/** Fetch with timeout. ms=0 means no timeout. */
function fetchWithTimeout(url, options = {}, ms = 60000) {
  if (ms <= 0) return fetch(url, options);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function request(path, options = {}, timeoutMs = 30000) {
  const url = `${BASE}${path}`;
  let res;
  try {
    res = await fetchWithTimeout(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }, timeoutMs);
  } catch (e) {
    if (e.name === 'AbortError' || (e.message && e.message.includes('aborted'))) {
      throw new Error('Request timed out. The backend may be slow or unavailable.');
    }
    throw e;
  }
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
  return request('/ingest/documents', {}, 60000);
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
  return request(`/ingest/documents/${encodeURIComponent(documentId)}/content`, {}, 60000);
}

/**
 * Fetch original DOCX file bytes for procedures (sop, work_instruction).
 * Returns a Blob for use with mammoth.js. 404 if source file not stored.
 */
export async function getDocumentFile(documentId) {
  const url = `${BASE}/ingest/documents/${encodeURIComponent(documentId)}/file`;
  let res;
  try {
    res = await fetchWithTimeout(url, {}, 60000);
  } catch (e) {
    if (e.name === 'AbortError' || (e.message && e.message.includes('aborted'))) {
      throw new Error('Request timed out. The document may be large or the backend is slow.');
    }
    throw e;
  }
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
  return request(`/analysis/sessions?limit=${limit}`, {}, 45000);
}

/**
 * Fetch a single analysis session with full result (findings, flags, etc.).
 */
export async function getAnalysisSession(trackingId) {
  return request(`/analysis/sessions/${encodeURIComponent(trackingId)}`);
}

/**
 * Fetch harmonisation scorecard for a document.
 */
export async function getHarmonisationScorecard(documentId, options = {}) {
  const params = new URLSearchParams();
  if (options.site) params.set('site', options.site);
  if (options.docLayer) params.set('doc_layer', options.docLayer);
  const qs = params.toString();
  return request(`/analysis/harmonisation-scorecard/${encodeURIComponent(documentId)}${qs ? `?${qs}` : ''}`);
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
 * Build audit & regulatory readiness Markdown pack (server-side). Returns blob + filename from Content-Disposition.
 * @param {object} payload - Full analysis result JSON (same shape as /analyse), optional `sites` array.
 */
export async function downloadAuditPack(payload) {
  const url = `${BASE}/analysis/audit-pack`;
  let body;
  try {
    body = JSON.stringify(payload);
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message.includes('circular')
        ? 'Cannot build audit pack: result payload is not serialisable (try saving and reloading the session).'
        : 'Cannot build audit pack: failed to serialise analysis data.',
    );
  }
  let res;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Accept: 'text/markdown',
          'Content-Type': 'application/json',
        },
        body,
      },
      120000,
    );
  } catch (e) {
    if (e.name === 'AbortError' || (e.message && e.message.includes('aborted'))) {
      throw new Error('Request timed out. The backend may be slow or unavailable.');
    }
    throw e;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(errorMessage(err, res.statusText || `HTTP ${res.status}`));
  }
  const cd = res.headers.get('Content-Disposition') || '';
  let filename = 'audit-pack.md';
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
  if (star) {
    try {
      filename = decodeURIComponent(star[1]);
    } catch {
      filename = star[1];
    }
  } else {
    const quoted = /filename="([^"]+)"/i.exec(cd);
    if (quoted) filename = quoted[1];
    else {
      const plain = /filename=([^;\s]+)/i.exec(cd);
      if (plain) filename = plain[1].replace(/^["']|["']$/g, '');
    }
  }
  const text = await res.text();
  if (!text.length) {
    throw new Error('Audit pack response was empty. Check the backend logs.');
  }
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  return { blob, filename };
}

/**
 * Build structured audit & regulatory readiness DOCX pack (server-side). Returns blob + filename from Content-Disposition.
 * @param {object} payload - Full analysis result JSON (same shape as /analyse), optional `sites` array.
 */
export async function downloadAuditPackDocx(payload) {
  const url = `${BASE}/analysis/audit-pack.docx`;
  let body;
  try {
    body = JSON.stringify(payload);
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message.includes('circular')
        ? 'Cannot build audit pack: result payload is not serialisable (try saving and reloading the session).'
        : 'Cannot build audit pack: failed to serialise analysis data.',
    );
  }
  let res;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Type': 'application/json',
        },
        body,
      },
      180000,
    );
  } catch (e) {
    if (e.name === 'AbortError' || (e.message && e.message.includes('aborted'))) {
      throw new Error('Request timed out. The backend may be slow or unavailable.');
    }
    throw e;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(errorMessage(err, res.statusText || `HTTP ${res.status}`));
  }
  const cd = res.headers.get('Content-Disposition') || '';
  let filename = 'audit-pack.docx';
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
  if (star) {
    try {
      filename = decodeURIComponent(star[1]);
    } catch {
      filename = star[1];
    }
  } else {
    const quoted = /filename="([^"]+)"/i.exec(cd);
    if (quoted) filename = quoted[1];
    else {
      const plain = /filename=([^;\s]+)/i.exec(cd);
      if (plain) filename = plain[1].replace(/^["']|["']$/g, '');
    }
  }
  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new Error('Audit pack response was empty. Check the backend logs.');
  }
  return { blob, filename };
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
