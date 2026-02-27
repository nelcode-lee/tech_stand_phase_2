/**
 * API client for Tech Standards backend.
 */
const BASE = import.meta.env.VITE_API_URL || '/api';

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
    throw new Error(err.detail || err.message || res.statusText || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function health() {
  return request('/health');
}

export async function ingestFile(file, metadata = {}) {
  const form = new FormData();
  form.append('file', file);
  form.append('document_id', metadata.document_id || file.name.replace(/\.[^.]+$/, ''));
  form.append('doc_layer', metadata.doc_layer || 'sop');
  form.append('sites', metadata.sites ? (Array.isArray(metadata.sites) ? metadata.sites.join(',') : metadata.sites) : '');
  if (metadata.policy_ref) form.append('policy_ref', metadata.policy_ref);
  if (metadata.title) form.append('title', metadata.title);
  if (metadata.library) form.append('library', metadata.library);
  const url = `${BASE}/ingest/file`;
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText || `HTTP ${res.status}`);
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
 * Fetch all ingested documents from the vector store.
 * Returns an array of { document_id, title, doc_layer, sites, library, source_path, chunk_count }.
 */
export async function listDocuments() {
  return request('/ingest/documents');
}

/**
 * Fetch recent analysis sessions for dashboard metrics.
 * Returns an array of { trackingId, documentId, title, docLayer, sites, overallRisk,
 *   totalFindings, agentsRun, agentFindings, workflowType, completedAt }.
 */
export async function listAnalysisSessions(limit = 50) {
  return request(`/analysis/sessions?limit=${limit}`);
}
