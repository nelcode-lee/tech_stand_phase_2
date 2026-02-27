import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { ingestFile } from '../api';
import { useAnalysis } from '../context/AnalysisContext';
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
      const res = await ingestFile(file, {
        document_id: config.documentId || undefined,
        doc_layer: config.docLayer || 'sop',
      });
      setStatus({ ok: true, message: `Ingested ${res.chunks_ingested} chunks from "${file.name}"` });
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ingest-page">
      <div className="ingest-header">
        <h1 className="ingest-title">
          {isCreate ? 'Upload Source Material' : 'Upload Document'}
        </h1>
        <p className="ingest-subtitle">
          {isCreate
            ? 'Upload reference documents that will inform the new draft.'
            : 'Upload the document to be reviewed. It will be chunked and passed to the agents.'}
        </p>
        <div className="ingest-meta">
          <span className="meta-pill">{(config.docLayer || 'sop').replace('_', ' ')}</span>
          {config.sites && <span className="meta-pill">{config.sites}</span>}
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
          {loading ? 'Ingesting…' : 'Ingest Document'}
        </button>
        <button
          type="button"
          className="ingest-btn-primary"
          onClick={() => navigate(`${base}/analyse`)}
        >
          Continue to {isCreate ? 'Analysis' : 'Review'} →
        </button>
      </div>
    </div>
  );
}
