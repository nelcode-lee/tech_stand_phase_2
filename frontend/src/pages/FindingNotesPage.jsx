import { useState, useEffect } from 'react';
import { listFindingNotes } from '../api';
import { StickyNote } from 'lucide-react';
import './FindingNotesPage.css';

export default function FindingNotesPage() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listFindingNotes(200)
      .then((data) => {
        if (!cancelled) setNotes(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Failed to load notes');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }

  function findingSummaryText(summary) {
    if (!summary || typeof summary !== 'object') return '';
    const parts = [];
    if (summary.issue) parts.push(summary.issue);
    if (summary.excerpt) parts.push(summary.excerpt.slice(0, 80) + (summary.excerpt.length > 80 ? '…' : ''));
    if (summary.location) parts.push(`Location: ${summary.location}`);
    return parts.slice(0, 2).join(' · ') || JSON.stringify(summary).slice(0, 100);
  }

  return (
    <div className="finding-notes-page">
      <header className="finding-notes-header">
        <h1 className="finding-notes-title">
          <StickyNote size={24} />
          Notes & Logs
        </h1>
        <p className="finding-notes-subtitle">
          User notes added to findings. Logged with user, finding, note, and datetime.
        </p>
      </header>

      {loading && <div className="finding-notes-loading">Loading notes…</div>}
      {error && <div className="finding-notes-error">{error}</div>}

      {!loading && !error && notes.length === 0 && (
        <div className="finding-notes-empty">
          <p>No notes yet. Use Agent Feedback on the Analyse page to see notes here.</p>
        </div>
      )}

      {!loading && !error && notes.length > 0 && (
        <div className="finding-notes-list">
          {notes.map((n) => (
            <article key={n.id} className="finding-note-card">
              <div className="finding-note-meta">
                <span className="finding-note-user">{n.user_name || 'Unknown user'}</span>
                <span className="finding-note-date">{formatDate(n.created_at)}</span>
              </div>
              <div className="finding-note-context">
                <span className="finding-note-doc">{n.document_id || '—'}</span>
                {n.agent_key && <span className="finding-note-agent">{n.agent_key}</span>}
              </div>
              {n.finding_summary && Object.keys(n.finding_summary).length > 0 && (
                <div className="finding-note-finding">
                  <span className="finding-note-finding-label">Finding:</span>{' '}
                  {findingSummaryText(n.finding_summary)}
                </div>
              )}
              <div className="finding-note-body">{n.note}</div>
              {n.attachments?.length > 0 && (
                <div className="finding-note-attachments">
                  <span className="finding-note-attachments-label">Attachments:</span>{' '}
                  {n.attachments.map((a, i) => (
                    <span key={i} className="finding-note-attachment-tag">{a.name}</span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
