import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSearch, FilePlus2, Clock, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Upload } from 'lucide-react';
import { useAnalysis } from '../context/AnalysisContext';
import { listDocuments } from '../api';
import './LibraryPage.css';

const LAYER_ORDER = { policy: 0, principle: 1, sop: 2, work_instruction: 3 };

const LAYER_LABEL = {
  policy: 'Policy',
  principle: 'Principle',
  sop: 'SOP',
  work_instruction: 'Work Instruction',
};

const RISK_META = {
  low:      'risk-low',
  medium:   'risk-medium',
  high:     'risk-high',
  critical: 'risk-critical',
};

const STATUS_META = {
  current:      { label: 'Current',    icon: CheckCircle2,  className: 'status-current' },
  'review-due': { label: 'Review Due', icon: Clock,         className: 'status-due' },
  overdue:      { label: 'Overdue',    icon: XCircle,       className: 'status-overdue' },
  draft:        { label: 'Draft',      icon: AlertTriangle, className: 'status-draft' },
  analysed:     { label: 'Analysed',   icon: CheckCircle2,  className: 'status-current' },
};

/**
 * Derive a display status from the session log entry.
 * Documents that have been analysed this session are tagged 'analysed'.
 * Without a review date we fall back to 'current'.
 */
function deriveStatus(/* doc */) {
  return 'analysed';
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const { setWorkflowMode, setConfig, sessionLog } = useAnalysis();

  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [layerFilter, setLayerFilter] = useState('all');

  async function fetchDocs() {
    setLoading(true);
    setError(null);
    try {
      const data = await listDocuments();
      setDocs(data || []);
    } catch (err) {
      setError(err.message || 'Could not fetch document list from backend.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDocs();
  }, []);

  // Build a merged view: one row per document.
  // If a document has been analysed this session, overlay its risk/findings.
  const sessionByDocId = useMemo(() => {
    const map = {};
    for (const s of sessionLog) {
      // Keep only the most recent session per document
      if (s.documentId && !map[s.documentId]) {
        map[s.documentId] = s;
      }
    }
    return map;
  }, [sessionLog]);

  // Also show session-only documents (analysed but not yet in the vector store).
  const merged = useMemo(() => {
    const byId = {};

    // Start from backend-ingested docs
    for (const d of docs) {
      byId[d.document_id] = {
        document_id:  d.document_id,
        title:        d.title,
        doc_layer:    d.doc_layer,
        sites:        d.sites,
        library:      d.library,
        source_path:  d.source_path,
        chunk_count:  d.chunk_count,
        overallRisk:  null,
        totalFindings: null,
        completedAt:  null,
        status:       'current',
        fromBackend:  true,
      };
    }

    // Overlay / append session results
    for (const s of [...sessionLog].reverse()) {  // oldest first so newest wins
      const id = s.documentId || s.trackingId;
      if (!id) continue;
      if (byId[id]) {
        byId[id].overallRisk  = s.overallRisk;
        byId[id].totalFindings = s.totalFindings;
        byId[id].completedAt  = s.completedAt;
        byId[id].status       = deriveStatus(s);
      } else {
        byId[id] = {
          document_id:  id,
          title:        s.title || id,
          doc_layer:    s.docLayer || 'sop',
          sites:        s.sites ? [s.sites] : [],
          library:      'Session',
          source_path:  null,
          chunk_count:  null,
          overallRisk:  s.overallRisk,
          totalFindings: s.totalFindings,
          completedAt:  s.completedAt,
          status:       deriveStatus(s),
          fromBackend:  false,
        };
      }
    }

    return Object.values(byId).sort((a, b) => {
      const lo = LAYER_ORDER[a.doc_layer] ?? 99;
      const lb = LAYER_ORDER[b.doc_layer] ?? 99;
      if (lo !== lb) return lo - lb;
      return a.title.localeCompare(b.title);
    });
  }, [docs, sessionLog]);

  // Filter
  const displayed = useMemo(() => {
    let rows = merged;
    if (layerFilter !== 'all') rows = rows.filter(d => d.doc_layer === layerFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(d =>
        d.title.toLowerCase().includes(q) ||
        d.document_id.toLowerCase().includes(q) ||
        (d.sites || []).join(' ').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [merged, layerFilter, search]);

  const overdueCount = merged.filter(d => d.status === 'overdue').length;
  const dueCount     = merged.filter(d => d.status === 'review-due').length;
  const layers       = [...new Set(merged.map(d => d.doc_layer))].sort(
    (a, b) => (LAYER_ORDER[a] ?? 99) - (LAYER_ORDER[b] ?? 99)
  );

  function startReview(doc) {
    setWorkflowMode('review');
    setConfig(c => ({
      ...c,
      requestType: 'review_request',
      documentId: doc.document_id,
      docLayer:   doc.doc_layer,
      sites:      Array.isArray(doc.sites) ? doc.sites.join(', ') : (doc.sites || ''),
    }));
    navigate('/review/configure');
  }

  function startCreate() {
    setWorkflowMode('create');
    setConfig(c => ({ ...c, requestType: 'new_document', documentId: '' }));
    navigate('/create/configure');
  }

  return (
    <div className="library-page">
      <div className="library-header">
        <div>
          <h1 className="library-title">Document Library</h1>
          <p className="library-subtitle">
            Technical standards across all sites
            {docs.length > 0 && ` — ${docs.length} document${docs.length !== 1 ? 's' : ''} in store`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="row-action-btn" onClick={fetchDocs} title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button type="button" className="library-create-btn" onClick={() => navigate('/library/upload')}>
            <Upload size={16} />
            Add to Library
          </button>
          <button type="button" className="library-create-btn secondary" onClick={startCreate}>
            <FilePlus2 size={16} />
            New Document
          </button>
        </div>
      </div>

      {error && <div className="library-error">{error}</div>}

      {(overdueCount > 0 || dueCount > 0) && (
        <div className="library-alerts">
          {overdueCount > 0 && (
            <div className="alert alert-overdue">
              <XCircle size={15} />
              {overdueCount} document{overdueCount > 1 ? 's' : ''} overdue for review
            </div>
          )}
          {dueCount > 0 && (
            <div className="alert alert-due">
              <Clock size={15} />
              {dueCount} document{dueCount > 1 ? 's' : ''} due for review
            </div>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="library-filter-bar">
        <input
          type="search"
          className="library-search"
          placeholder="Search by title, ID or site…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="library-filter-select"
          value={layerFilter}
          onChange={e => setLayerFilter(e.target.value)}
        >
          <option value="all">All layers</option>
          {layers.map(l => (
            <option key={l} value={l}>{LAYER_LABEL[l] || l}</option>
          ))}
        </select>
      </div>

      <div className="library-table-wrap">
        <table className="library-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Document</th>
              <th>Layer</th>
              <th>Site(s)</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Findings</th>
              <th>Analysed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="library-loading">Loading documents…</td>
              </tr>
            )}
            {!loading && displayed.length === 0 && (
              <tr>
                <td colSpan={9} className="library-empty">
                  {merged.length === 0
                    ? 'No documents found. Ingest a document or run an analysis to see results here.'
                    : 'No documents match the current filter.'}
                </td>
              </tr>
            )}
            {!loading && displayed.map(doc => {
              const statusMeta = STATUS_META[doc.status] || STATUS_META.current;
              const StatusIcon = statusMeta.icon;
              const siteLabel = Array.isArray(doc.sites) ? doc.sites.join(', ') : (doc.sites || '—');
              const analysedAt = doc.completedAt
                ? new Date(doc.completedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                : null;
              return (
                <tr key={doc.document_id} className="library-row">
                  <td className="doc-id">{doc.document_id}</td>
                  <td className="doc-title">{doc.title}</td>
                  <td><span className="layer-badge">{LAYER_LABEL[doc.doc_layer] || doc.doc_layer}</span></td>
                  <td className="doc-site">{siteLabel || <span className="doc-none">—</span>}</td>
                  <td>
                    <span className={`status-badge ${statusMeta.className}`}>
                      <StatusIcon size={12} />
                      {statusMeta.label}
                    </span>
                  </td>
                  <td>
                    {doc.overallRisk ? (
                      <span className={`risk-pill ${RISK_META[doc.overallRisk] || 'risk-medium'}`}>
                        {doc.overallRisk}
                      </span>
                    ) : <span className="doc-none">—</span>}
                  </td>
                  <td>
                    {doc.totalFindings != null ? (
                      <span className="findings-chip">{doc.totalFindings}</span>
                    ) : <span className="doc-none">—</span>}
                  </td>
                  <td className="doc-date">
                    {analysedAt || <span className="doc-none">—</span>}
                  </td>
                  <td className="doc-actions-cell">
                    <button
                      type="button"
                      className="row-action-btn"
                      onClick={() => startReview(doc)}
                    >
                      <FileSearch size={14} />
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
