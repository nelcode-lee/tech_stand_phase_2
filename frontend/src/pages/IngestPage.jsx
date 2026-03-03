import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { ingestFile } from '../api';
import { useAnalysis } from '../context/AnalysisContext';
import { resolveSitesForApi } from '../constants/sites';
import './IngestPage.css';

export default function IngestPage({ mode = 'review' }) {
  const navigate = useNavigate();
  const { config, setConfig } = useAnalysis();
  const base = `/${mode}`;

  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const isCreate = mode === 'create';
  const agentCount = config?.agents?.length ?? 8;

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  }

  async function handleIngest(e) {
    e.preventDefault();
    if (!file) { setStatus({ ok: false, message: 'Select a file first.' }); return; }
    setLoading(true);
    setStatus(null);
    try {
      const sitesArr = Array.isArray(config?.sites) ? config.sites : (config?.sites ? String(config.sites).split(/[,\s]+/).filter(Boolean) : []);
      const sitesForApi = resolveSitesForApi(sitesArr);
      // Always derive document_id from the file being uploaded — never use stale config.documentId
      // (e.g. FSB009 from localStorage) which would overwrite the wrong document.
      const docIdForIngest = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-');
      const res = await ingestFile(file, {
        document_id: docIdForIngest,
        doc_layer: config?.docLayer || 'sop',
        sites: sitesForApi,
        policy_ref: config?.policyRef || undefined,
        title: config?.title || docIdForIngest,
      });
      const docId = res.document_id || docIdForIngest;
      const docTitle = res.title || file.name.replace(/\.[^.]+$/, '') || docId;
      setConfig(c => ({
        ...c,
        documentId: docId,
        title: docTitle,
      }));
      // Persist to localStorage so Configure and other pages see the correct document
      try {
        const stored = JSON.parse(localStorage.getItem(`tech-standards-review-config-${mode}`) || '{}');
        localStorage.setItem(`tech-standards-review-config-${mode}`, JSON.stringify({ ...stored, documentId: docId, title: docTitle }));
      } catch (_) { /* ignore */ }
      setStatus({ ok: true, message: `Ingested ${res.chunks_ingested} chunks from "${file.name}". Ready for analysis.` });
      // Put documentId in URL so it persists and cannot be overwritten by config/localStorage/session
      const analyseUrl = `${base}/analyse?documentId=${encodeURIComponent(docId)}${docTitle && docTitle !== docId ? `&title=${encodeURIComponent(docTitle)}` : ''}`;
      setTimeout(() => navigate(analyseUrl, { state: { fromIngest: true, documentId: docId, title: docTitle }, replace: true }), 1500);
    } catch (err) {
      setStatus({ ok: false, message: err.message || 'Ingest failed' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ingest-page">
      <div className="ingest-header">
        <h1 className="ingest-title">
          {isCreate ? 'Upload Reference Materials' : 'Upload Document'}
        </h1>
        <p className="ingest-subtitle">
          {isCreate
            ? 'Upload policies, standards, or example documents to inform the draft. The pipeline will use these alongside your knowledge base.'
            : config?.documentId
              ? 'Document is in the Library — upload a new version or skip to analyse existing.'
              : 'Upload the document to be reviewed. It will be chunked and passed to the agents.'}
        </p>
        <div className="ingest-meta">
          <span className="meta-pill">{(config.docLayer || 'sop').replace('_', ' ')}</span>
          {config.sites?.length ? (
            <span className="meta-pill">
              {Array.isArray(config.sites) && config.sites.includes('all') ? 'All Sites' : (Array.isArray(config.sites) ? config.sites.join(', ') : config.sites)}
            </span>
          ) : null}
          <span className="meta-pill">{agentCount} agents</span>
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`upload-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
      >
        <Upload className="upload-icon" size={36} />
        <p>Drag and drop, or browse</p>
        <span className="upload-formats">PDF, DOCX, DOC, TXT</span>
        <input
          type="file"
          accept=".docx,.pdf,.doc,.txt"
          onChange={e => setFile(e.target.files[0] || null)}
          className="upload-input"
          id="upload-input"
        />
        <label htmlFor="upload-input" className="upload-browse">Browse Files</label>
        {file && <span className="upload-filename">{file.name}</span>}
      </div>

      {loading && (
        <div className="ingest-progress-wrap">
          <div className="ingest-progress-bar" />
          <p className="ingest-progress-text">Processing document — chunking and embedding…</p>
        </div>
      )}

      {status && (
        <div className={`upload-status ${status.ok ? 'success' : 'error'}`}>
          {status.message}
        </div>
      )}

      <div className="ingest-actions">
        <button
          type="button"
          className="ingest-btn-secondary"
          onClick={() => navigate(`${base}/configure`)}
        >
          ← Back
        </button>
        <button
          type="button"
          className="ingest-btn-ingest"
          disabled={!file || loading}
          onClick={handleIngest}
        >
          {loading ? 'Ingesting…' : isCreate ? 'Ingest Reference Materials' : 'Ingest Document'}
        </button>
        <button
          type="button"
          className={`ingest-btn-primary ${config?.documentId && !file ? 'ingest-skip-highlight' : ''}`}
          disabled={!!file}
          title={file ? 'Ingest the document first — then you can analyse it' : undefined}
          onClick={() => {
            // Always put documentId in URL so Analyse page uses the correct document (never stale config)
            const docId = config?.documentId || '';
            const url = docId ? `${base}/analyse?documentId=${encodeURIComponent(docId)}` : `${base}/analyse`;
            navigate(url);
          }}
        >
          {file
            ? 'Ingest first to analyse →'
            : config?.documentId
              ? 'Skip to Analysis →'
              : `Continue to ${isCreate ? 'Analysis' : 'Review'} →`}
        </button>
      </div>
    </div>
  );
}
