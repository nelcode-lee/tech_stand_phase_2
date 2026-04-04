import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowLeft } from 'lucide-react';
import { ingestFile, listDocuments } from '../api';
import PolicyRefSelect from '../components/PolicyRefSelect';
import SitesSelect from '../components/SitesSelect';
import { filterPolicyDocumentsForRef } from '../utils/policyDocuments';
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
  const [libraryDocs, setLibraryDocs] = useState([]);
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    title: '',
    category: 'upload',
    sites: [],
    policyRef: '',
  });

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  useEffect(() => {
    listDocuments()
      .then((data) => setLibraryDocs(data || []))
      .catch(() => setLibraryDocs([]));
  }, []);

  const policyDocsForRef = useMemo(() => filterPolicyDocumentsForRef(libraryDocs), [libraryDocs]);

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
              <PolicyRefSelect
                id="policy-ref"
                value={form.policyRef}
                onChange={(v) => setField('policyRef', v)}
                policyDocs={policyDocsForRef}
                disabled={loading}
                hint="Pick BRCGS, Cranswick MS, or another policy from the library — or type a document ID."
              />
            </div>
          </div>
        </section>

        {/* File upload */}
        <section className="lib-upload-section">
          <h2 className="lib-upload-section-title">File</h2>
          <label
            className={`lib-upload-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
            htmlFor="lib-upload-input"
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            style={{ cursor: 'pointer' }}
          >
            <Upload className="lib-upload-icon" size={36} />
            <p>Drag and drop, or click to browse</p>
            <span className="lib-upload-formats">PDF, DOCX, DOC</span>
            <input
              ref={fileInputRef}
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
            {file && <span className="lib-upload-filename">{file.name}</span>}
          </label>
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
