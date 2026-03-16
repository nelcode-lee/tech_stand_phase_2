import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowLeft } from 'lucide-react';
import { ingestFile } from '../api';
import SitesSelect from '../components/SitesSelect';
import { resolveSitesForApi } from '../constants/sites';
import './LibraryUploadPage.css';

/** Single category: maps to both doc_layer and library for the backend. */
const CATEGORY_OPTIONS = [
  { value: 'policy', label: 'Policy', docLayer: 'policy', library: 'Policies' },
  { value: 'policy_brcgs', label: 'BRCGS', docLayer: 'policy', library: 'Policies' },
  { value: 'policy_cranswick', label: 'Cranswick Standards', docLayer: 'policy', library: 'Policies' },
  { value: 'principle', label: 'Principle / Standard', docLayer: 'principle', library: 'Standards' },
  { value: 'sop', label: 'SOP (Standards)', docLayer: 'sop', library: 'Standards' },
  { value: 'sop_site', label: 'SOP (Site)', docLayer: 'sop', library: 'Site SOPs' },
  { value: 'external', label: 'External Standard', docLayer: 'principle', library: 'External Standards' },
  { value: 'work_instruction', label: 'Work Instruction', docLayer: 'work_instruction', library: 'Site SOPs' },
  { value: 'upload', label: 'Upload / Other', docLayer: 'sop', library: 'Uploads' },
];

const ALLOWED_EXTENSIONS = ['.docx', '.pdf', '.doc'];
function isAllowedFileName(name) {
  if (!name || !name.includes('.')) return false;
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  return ALLOWED_EXTENSIONS.includes(ext);
}

/** Derive a stable document_id from title (slug-style for storage). */
function slugFromTitle(title) {
  if (!title || !title.trim()) return '';
  return title.trim()
    .replace(/\s+/g, '-')
    .replace(/[~/#@]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function LibraryUploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState({
    title: '',
    category: 'upload',
    sites: [],
    policyRef: '',
  });

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f && !form.title) {
      setFile(f);
      const suggested = f.name.replace(/\.[^.]+$/, '').trim();
      setField('title', suggested);
    } else if (f) setFile(f);
  }

  async function handleIngest(e) {
    e.preventDefault();
    if (!file) {
      setStatus({ ok: false, message: 'Select a file first.' });
      return;
    }
    if (!isAllowedFileName(file.name)) {
      setStatus({ ok: false, message: `"${file.name}" is not an allowed type. Use ${ALLOWED_EXTENSIONS.join(', ')}.` });
      return;
    }
    const title = (form.title || '').trim();
    if (!title) {
      setStatus({ ok: false, message: 'Title is required.' });
      return;
    }
    const documentId = (slugFromTitle(title) || file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-') || 'document').trim() || 'document';
    setLoading(true);
    setStatus(null);
    try {
      const cat = CATEGORY_OPTIONS.find(c => c.value === form.category) || CATEGORY_OPTIONS.find(c => c.value === 'upload');
      const sitesForApi = resolveSitesForApi(form.sites);
      const res = await ingestFile(file, {
        document_id: documentId,
        title,
        doc_layer: cat.docLayer,
        sites: sitesForApi,
        policy_ref: form.policyRef || undefined,
        library: cat.library,
      });
      setStatus({
        ok: true,
        message: `Ingested ${res.chunks_ingested} chunks from "${file.name}". Document added to library.`,
      });
      setFile(null);
      setForm(f => ({ ...f, title: '' }));
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setLoading(false);
    }
  }

  function handleAddAnother() {
    setStatus(null);
    setFile(null);
    setForm(f => ({ ...f, title: '' }));
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
              <label htmlFor="title">Title <span className="required">*</span></label>
              <input
                id="title"
                type="text"
                placeholder="e.g. BRCGS Food Safety Standard v9, GEN-OP-01 Goods In Procedure"
                value={form.title}
                onChange={e => setField('title', e.target.value)}
                required
              />
              <span className="lib-upload-hint">Used for display and as the document identifier</span>
            </div>
            <div className="lib-upload-row">
              <label htmlFor="category">Category</label>
              <select
                id="category"
                value={form.category}
                onChange={e => setField('category', e.target.value)}
              >
                {CATEGORY_OPTIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <span className="lib-upload-hint">Document type and library placement</span>
            </div>
            <div className="lib-upload-row">
              <label>Sites</label>
              <SitesSelect
                id="sites"
                value={form.sites}
                onChange={v => setField('sites', v)}
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
                  if (!form.title) setField('title', f.name.replace(/\.[^.]+$/, '').trim());
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
              <>
                <button
                  type="button"
                  className="lib-upload-btn-outline"
                  onClick={() => navigate('/library', { state: { fromUpload: true } })}
                >
                  View in Library
                </button>
                <button
                  type="button"
                  className="lib-upload-btn-outline"
                  onClick={handleAddAnother}
                >
                  Add Another
                </button>
              </>
            )}
            <button
              type="submit"
              className="lib-upload-btn-primary"
              disabled={!file || !form.title?.trim() || loading}
            >
              {loading ? 'Ingesting…' : 'Add to Library'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
