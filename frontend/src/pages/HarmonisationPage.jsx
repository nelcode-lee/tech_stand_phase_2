import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getHarmonisationScorecard, listDocuments } from '../api';
import './HarmonisationPage.css';

const STANDARD_FILTER_OPTIONS = [
  { value: 'all', label: 'All standards (combined)' },
  { value: 'brcgs', label: 'BRCGS' },
  { value: 'cranswick_ms', label: 'Cranswick MS' },
  { value: 'supermarket', label: 'Supermarket / customer' },
  { value: 'other', label: 'Other' },
];

const STANDARD_ORDER = ['brcgs', 'cranswick_ms', 'supermarket', 'other'];

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function bucketLabel(scorecard, key) {
  const row = scorecard?.by_standard?.[key];
  return row?.label || key;
}

function HarmonisationPage() {
  const location = useLocation();
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [scorecard, setScorecard] = useState(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [loadingScorecard, setLoadingScorecard] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [standardFilter, setStandardFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [docLayerFilter, setDocLayerFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadDocuments() {
      setLoadingDocs(true);
      setError('');
      try {
        const rows = await listDocuments();
        if (cancelled) return;
        const docs = Array.isArray(rows) ? rows : [];
        setDocuments(docs);
        if (docs.length > 0) {
          const prefStr = location.state?.documentId ? String(location.state.documentId) : '';
          if (prefStr && docs.some((d) => String(d.document_id) === prefStr)) {
            setSelectedDocumentId(prefStr);
          } else {
            setSelectedDocumentId(String(docs[0].document_id || ''));
          }
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Could not load documents.');
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    }
    loadDocuments();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const preferred = location.state?.documentId;
    if (!preferred) return;
    const id = String(preferred);
    const match = documents.some((d) => String(d.document_id) === id);
    if (match) setSelectedDocumentId(id);
  }, [location.state, documents]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedDocumentId) {
      setScorecard(null);
      return () => {
        cancelled = true;
      };
    }
    async function loadScorecard() {
      setLoadingScorecard(true);
      setError('');
      try {
        const data = await getHarmonisationScorecard(selectedDocumentId, { site: siteFilter, docLayer: docLayerFilter });
        if (!cancelled) setScorecard(data);
      } catch (e) {
        if (!cancelled) {
          setScorecard(null);
          setError(e?.message || 'Could not load harmonisation scorecard.');
        }
      } finally {
        if (!cancelled) setLoadingScorecard(false);
      }
    }
    loadScorecard();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId, siteFilter, docLayerFilter]);

  const availableSites = useMemo(() => {
    const values = new Set();
    documents.forEach((d) => {
      const raw = String(d?.sites || '').trim();
      if (!raw) return;
      raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => values.add(s));
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [documents]);

  const availableDocLayers = useMemo(() => {
    const values = new Set();
    documents.forEach((d) => {
      const raw = String(d?.doc_layer || '').trim();
      if (raw) values.add(raw);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [documents]);

  const activeSummary = useMemo(() => {
    if (!scorecard) return {};
    if (standardFilter === 'all') return scorecard.summary || {};
    const row = scorecard.by_standard?.[standardFilter];
    if (!row) {
      return {
        total_clauses: 0,
        covered: 0,
        partial: 0,
        missing: 0,
        conflict: 0,
        not_applicable: 0,
        harmonisation_score: 0,
        gate_passed: true,
      };
    }
    return {
      total_clauses: row.total_clauses ?? 0,
      covered: row.covered ?? 0,
      partial: row.partial ?? 0,
      missing: row.missing ?? 0,
      conflict: row.conflict ?? 0,
      not_applicable: row.not_applicable ?? 0,
      harmonisation_score: row.harmonisation_score ?? 0,
      gate_passed: row.gate_passed ?? true,
    };
  }, [scorecard, standardFilter]);

  const topGaps = useMemo(() => {
    const base = Array.isArray(scorecard?.top_gaps) ? scorecard.top_gaps : [];
    const q = searchText.trim().toLowerCase();
    return base.filter((g) => {
      if (standardFilter !== 'all' && (g.standard_bucket || '') !== standardFilter) return false;
      if (statusFilter !== 'all' && (g.status || '') !== statusFilter) return false;
      if (!q) return true;
      const bag = `${g.citation || ''} ${g.clause_id || ''} ${g.standard_name || ''} ${g.issue || ''} ${g.recommended_action || ''}`.toLowerCase();
      return bag.includes(q);
    });
  }, [scorecard, searchText, statusFilter, standardFilter]);

  function handleExportCsv() {
    if (!scorecard) return;
    const summary = activeSummary;
    const stdNote = standardFilter === 'all' ? 'all standards' : bucketLabel(scorecard, standardFilter);
    const rows = [
      ['document_id', 'title', 'tracking_id', 'view', 'harmonisation_score', 'total_clauses', 'covered', 'partial', 'missing', 'conflict'],
      [
        scorecard.document_id || '',
        scorecard.title || '',
        scorecard.tracking_id || '',
        stdNote,
        summary.harmonisation_score ?? 0,
        summary.total_clauses ?? 0,
        summary.covered ?? 0,
        summary.partial ?? 0,
        summary.missing ?? 0,
        summary.conflict ?? 0,
      ],
      [],
      ['standard_bucket', 'standard_name', 'status', 'citation', 'clause_id', 'issue', 'recommended_action'],
      ...topGaps.map((g) => [
        g.standard_bucket || '',
        g.standard_name || '',
        g.status || '',
        g.citation || '',
        g.clause_id || '',
        g.issue || '',
        g.recommended_action || '',
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\n');
    downloadTextFile(`harmonisation-${selectedDocumentId || 'scorecard'}.csv`, csv, 'text/csv;charset=utf-8;');
  }

  function handleExportMarkdown() {
    if (!scorecard) return;
    const summary = activeSummary;
    const viewLabel = standardFilter === 'all' ? 'All standards (combined)' : bucketLabel(scorecard, standardFilter);
    const md = [
      `# Harmonisation Scorecard`,
      ``,
      `- Document: ${scorecard.title || scorecard.document_id || '-'}`,
      `- Document ID: ${scorecard.document_id || '-'}`,
      `- Tracking ID: ${scorecard.tracking_id || '-'}`,
      `- View: ${viewLabel}`,
      `- Harmonisation Score: ${summary.harmonisation_score ?? 0}%`,
      `- Total Clauses: ${summary.total_clauses ?? 0}`,
      `- Covered: ${summary.covered ?? 0}, Partial: ${summary.partial ?? 0}, Missing: ${summary.missing ?? 0}, Conflict: ${summary.conflict ?? 0}`,
      ``,
      `## Top Gaps`,
      ``,
      `| Standard | Status | Clause | Issue | Recommended action |`,
      `|---|---|---|---|---|`,
      ...topGaps.map(
        (g) =>
          `| ${(g.standard_name || g.standard_bucket || '-').replace(/\|/g, '\\|')} | ${g.status || '-'} | ${(g.citation || g.clause_id || '-').replace(/\|/g, '\\|')} | ${(g.issue || '-').replace(/\|/g, '\\|')} | ${(g.recommended_action || '-').replace(/\|/g, '\\|')} |`,
      ),
    ].join('\n');
    downloadTextFile(`harmonisation-${selectedDocumentId || 'scorecard'}.md`, md, 'text/markdown;charset=utf-8;');
  }

  const summary = activeSummary;

  return (
    <div className="harmonisation-page">
      <header className="harmonisation-header">
        <div>
          <h1>Harmonisation Scorecard</h1>
          <p>
            Clause alignment across BRCGS, Cranswick Manufacturing Standard, and supermarket / customer requirements. Metrics
            come from the latest saved analysis session for this document.
          </p>
        </div>
        <div className="harmonisation-controls">
          <label htmlFor="harmonisation-document">Document</label>
          <select
            id="harmonisation-document"
            value={selectedDocumentId}
            onChange={(e) => setSelectedDocumentId(e.target.value)}
            disabled={loadingDocs || documents.length === 0}
          >
            {documents.map((doc) => (
              <option key={doc.document_id} value={doc.document_id}>
                {doc.title || doc.document_id}
              </option>
            ))}
          </select>
        </div>
      </header>
      <section className="harmonisation-toolbar">
        <div className="harmonisation-filter-group">
          <label htmlFor="harmonisation-standard-filter">Standard</label>
          <select
            id="harmonisation-standard-filter"
            value={standardFilter}
            onChange={(e) => setStandardFilter(e.target.value)}
          >
            {STANDARD_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="harmonisation-filter-group">
          <label htmlFor="harmonisation-site-filter">Site</label>
          <select id="harmonisation-site-filter" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
            <option value="">All sites</option>
            {availableSites.map((site) => (
              <option key={site} value={site}>
                {site}
              </option>
            ))}
          </select>
        </div>
        <div className="harmonisation-filter-group">
          <label htmlFor="harmonisation-doc-layer-filter">Document layer</label>
          <select id="harmonisation-doc-layer-filter" value={docLayerFilter} onChange={(e) => setDocLayerFilter(e.target.value)}>
            <option value="">All layers</option>
            {availableDocLayers.map((layer) => (
              <option key={layer} value={layer}>
                {layer}
              </option>
            ))}
          </select>
        </div>
        <div className="harmonisation-filter-group">
          <label htmlFor="harmonisation-status-filter">Gap status</label>
          <select id="harmonisation-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="missing">Missing</option>
            <option value="conflict">Conflict</option>
            <option value="partial">Partial</option>
          </select>
        </div>
        <div className="harmonisation-filter-group grow">
          <label htmlFor="harmonisation-search">Search gaps</label>
          <input
            id="harmonisation-search"
            type="text"
            placeholder="Clause, standard, issue, or recommendation"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <div className="harmonisation-actions">
          <button type="button" onClick={handleExportCsv} disabled={!scorecard}>
            Export CSV
          </button>
          <button type="button" onClick={handleExportMarkdown} disabled={!scorecard}>
            Export Markdown
          </button>
        </div>
      </section>

      {error && <div className="harmonisation-error">{error}</div>}
      {(loadingDocs || loadingScorecard) && <div className="harmonisation-loading">Loading scorecard...</div>}

      {!loadingScorecard && scorecard && (
        <>
          {standardFilter !== 'all' && (summary.total_clauses ?? 0) === 0 && (
            <div className="harmonisation-empty harmonisation-inline-hint">
              No compliance clause checks were attributed to this standard in the latest session. Try &quot;All standards&quot; or
              run a harmonisation analysis with the relevant policy documents in scope.
            </div>
          )}

          <section className="harmonisation-cards">
            <article className="harmonisation-card highlight">
              <span>{standardFilter === 'all' ? 'Harmonisation score' : `Score (${STANDARD_FILTER_OPTIONS.find((x) => x.value === standardFilter)?.label || standardFilter})`}</span>
              <strong>{summary.harmonisation_score ?? 0}%</strong>
            </article>
            <article className="harmonisation-card">
              <span>Total clauses</span>
              <strong>{summary.total_clauses ?? 0}</strong>
            </article>
            <article className="harmonisation-card">
              <span>Covered</span>
              <strong>{summary.covered ?? 0}</strong>
            </article>
            <article className="harmonisation-card">
              <span>Partial</span>
              <strong>{summary.partial ?? 0}</strong>
            </article>
            <article className="harmonisation-card">
              <span>Missing</span>
              <strong>{summary.missing ?? 0}</strong>
            </article>
            <article className="harmonisation-card">
              <span>Conflicts</span>
              <strong>{summary.conflict ?? 0}</strong>
            </article>
          </section>

          {standardFilter === 'all' && scorecard.by_standard && (
            <section className="harmonisation-by-standard">
              <div className="harmonisation-table-header">
                <h2>By standard</h2>
                <span>Scores from the same session, split by standard family</span>
              </div>
              <div className="harmonisation-standard-grid">
                {STANDARD_ORDER.map((key) => {
                  const row = scorecard.by_standard[key];
                  if (!row || (row.total_clauses ?? 0) === 0) return null;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="harmonisation-standard-tile"
                      onClick={() => setStandardFilter(key)}
                    >
                      <span className="harmonisation-standard-tile-label">{row.label}</span>
                      <strong className="harmonisation-standard-tile-score">{row.harmonisation_score ?? 0}%</strong>
                      <span className="harmonisation-standard-tile-meta">
                        {row.total_clauses ?? 0} checks · {row.missing ?? 0} missing · {row.conflict ?? 0} conflict
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="harmonisation-table-wrap">
            <div className="harmonisation-table-header">
              <h2>Top gaps</h2>
              <span>{topGaps.length} items</span>
            </div>
            {topGaps.length === 0 ? (
              <div className="harmonisation-empty">No gaps match the current filters for this session.</div>
            ) : (
              <table className="harmonisation-table">
                <thead>
                  <tr>
                    <th>Standard</th>
                    <th>Status</th>
                    <th>Clause</th>
                    <th>Issue</th>
                    <th>Recommended action</th>
                  </tr>
                </thead>
                <tbody>
                  {topGaps.map((gap, idx) => (
                    <tr key={`${gap.clause_id || 'gap'}-${gap.standard_bucket || ''}-${idx}`}>
                      <td>{gap.standard_name || bucketLabel(scorecard, gap.standard_bucket) || gap.standard_bucket || '—'}</td>
                      <td>{gap.status || '-'}</td>
                      <td>{gap.citation || gap.clause_id || '-'}</td>
                      <td>{gap.issue || '-'}</td>
                      <td>{gap.recommended_action || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default HarmonisationPage;
