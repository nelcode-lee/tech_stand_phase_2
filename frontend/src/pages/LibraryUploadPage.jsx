import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowLeft } from 'lucide-react';
import { ingestFile } from '../api';
import './LibraryUploadPage.css';

const DOC_LAYERS = [
  { value: 'policy', label: 'Policy' },
  { value: 'principle', label: 'Principle' },
  { value: 'sop', label: 'SOP' },
  { value: 'work_instruction', label: 'Work Instruction' },
];

const LIBRARY_OPTIONS = [
  { value: 'Standards', label: 'Standards' },
  { value: 'External Standards', label: 'External Standards' },
  { value: 'Site SOPs', label: 'Site SOPs' },
  { value: 'Uploads', label: 'Uploads' },
  { value: 'Policies', label: 'Policies' },
];

export default function LibraryUploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState({
    documentId: '',
    docLayer: 'sop',
    sites: '',
    policyRef: '',
    title: '',
    library: 'Uploads',
  });

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      setFile(f);
      if (!form.documentId) {
        const suggested = f.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-').replace(/~/g, '-');
        setField('documentId', suggested);
      }
      if (!form.title) setField('title', f.name.replace(/\.[^.]+$/, ''));
    }
  }

  async function handleIngest(e) {
    e.preventDefault();
    if (!file) {
      setStatus({ ok: false, message: 'Select a file first.' });
      return;
    }
    const docId = (form.documentId || '').trim();
    if (!docId) {
      setStatus({ ok: false, message: 'Document ID is required.' });
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const res = await ingestFile(file, {
        document_id: docId,
        doc_layer: form.docLayer,
        sites: form.sites,
        policy_ref: form.policyRef || undefined,
        title: form.title || undefined,
        library: form.library,
      });
      setStatus({
        ok: true,
        message: `Ingested ${res.chunks_ingested} chunks from "${file.name}". Document added to library.`,
      });
      setFile(null);
      setForm(f => ({ ...f, documentId: '', title: '' }));
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setLoading(false);
    }
  }

  function handleAddAnother() {
    setStatus(null);
    setFile(null);
    setForm(f => ({ ...f, documentId: '', title: '' }));
  }

  return (
    <div className="library-upload-page">
      <div className="library-upload-header">
        <h1 className="library-upload-title">Add Document to Library</h1>
        <p className="library-upload-subtitle">
          Upload a file and set metadata so it is stored correctly in the RAG and available for analysis.
        </p>
      </div>

      <form onSubmit={handleIngest} className="library-upload-form">
        {/* Metadata section */}
        <section className="lib-upload-section">
          <h2 className="lib-upload-section-title">Document Metadata</h2>
          <div className="lib-upload-fields">
            <div className="lib-upload-row">
              <label htmlFor="doc-id">Document ID <span className="required">*</span></label>
              <input
                id="doc-id"
                type="text"
                placeholder="e.g. CMS-v2, BRCGS-FS-v9-meat, GEN-OP-01"
                value={form.documentId}
                onChange={e => setField('documentId', e.target.value)}
                required
              />
            </div>
            <div className="lib-upload-row">
              <label htmlFor="title">Title</label>
              <input
                id="title"
                type="text"
                placeholder="Human-readable document title"
                value={form.title}
                onChange={e => setField('title', e.target.value)}
              />
            </div>
            <div className="lib-upload-row">
              <label htmlFor="doc-layer">Document Layer</label>
              <select
                id="doc-layer"
                value={form.docLayer}
                onChange={e => setField('docLayer', e.target.value)}
              >
                {DOC_LAYERS.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div className="lib-upload-row">
              <label htmlFor="library">Library</label>
              <select
                id="library"
                value={form.library}
                onChange={e => setField('library', e.target.value)}
              >
                {LIBRARY_OPTIONS.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div className="lib-upload-row">
              <label htmlFor="sites">Sites</label>
              <input
                id="sites"
                type="text"
                placeholder="e.g. Barnsley, Hull, Norfolk (comma-separated)"
                value={form.sites}
                onChange={e => setField('sites', e.target.value)}
              />
            </div>
            <div className="lib-upload-row">
              <label htmlFor="policy-ref">Policy Reference</label>
              <input
                id="policy-ref"
                type="text"
                placeholder="e.g. P-001, Food Safety Policy"
                value={form.policyRef}
                onChange={e => setField('policyRef', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* File upload */}
        <section className="lib-upload-section">
          <h2 className="lib-upload-section-title">File</h2>
          <div
            className={`lib-upload-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
          >
            <Upload className="lib-upload-icon" size={36} />
            <p>Drag and drop, or browse</p>
            <span className="lib-upload-formats">PDF, DOCX, DOC</span>
            <input
              type="file"
              accept=".docx,.pdf,.doc"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  if (!form.documentId) {
                    const suggested = f.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-').replace(/~/g, '-');
                    setField('documentId', suggested);
                  }
                  if (!form.title) setField('title', f.name.replace(/\.[^.]+$/, ''));
                }
              }}
              className="lib-upload-input"
              id="lib-upload-input"
            />
            <label htmlFor="lib-upload-input" className="lib-upload-browse">Browse Files</label>
            {file && <span className="lib-upload-filename">{file.name}</span>}
          </div>
        </section>

        {status && (
          <div className={`lib-upload-status ${status.ok ? 'success' : 'error'}`}>
            {status.message}
          </div>
        )}

        <div className="lib-upload-actions">
          <button
            type="button"
            className="lib-upload-btn-secondary"
            onClick={() => navigate('/library')}
          >
            <ArrowLeft size={16} />
            Back to Library
          </button>
          <div className="lib-upload-right">
            {status?.ok && (
              <button
                type="button"
                className="lib-upload-btn-outline"
                onClick={handleAddAnother}
              >
                Add Another
              </button>
            )}
            <button
              type="submit"
              className="lib-upload-btn-primary"
              disabled={!file || !form.documentId?.trim() || loading}
            >
              {loading ? 'Ingesting…' : 'Add to Library'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
