import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { listInteractionLogs } from '../api';
import './LogsPage.css';

function formatMeta(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const entries = Object.entries(metadata).filter(([, value]) => value != null && value !== '');
  if (!entries.length) return '';
  return entries
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' | ');
}

/**
 * @param {{ embedded?: boolean }} props — when true, render for Settings (h2 + compact title styles)
 */
export function GovernanceLogsPanel({ embedded = false }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const data = await listInteractionLogs(300);
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err.message || 'Could not load interaction logs.';
      if (/not found/i.test(message)) {
        setError('Interaction log API not found. Restart the backend so the new /analysis/interaction-logs routes are available.');
      } else {
        setError(message);
      }
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
  }, []);

  const rootClass = embedded ? 'logs-embedded' : 'logs-page';

  return (
    <div className={rootClass}>
      <div className={`logs-header ${embedded ? 'logs-header--embedded-only' : ''}`}>
        {!embedded && (
          <div>
            <h1 className="logs-title">Governance Logs</h1>
            <p className="logs-subtitle">Recent user and workflow interactions captured for audit and oversight.</p>
          </div>
        )}
        {embedded && <span className="logs-embedded-toolbar-spacer" aria-hidden />}
        <button type="button" className="logs-refresh-btn" onClick={fetchLogs} disabled={loading}>
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
          Refresh
        </button>
      </div>

      {error && <div className="logs-error">{error}</div>}

      <div className="logs-table-wrap">
        <table className="logs-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Route</th>
              <th>Document</th>
              <th>Tracking</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan="7" className="logs-empty">No interaction logs found yet.</td>
              </tr>
            )}
            {logs.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}</td>
                <td>{entry.user_name || 'Unknown'}</td>
                <td>{entry.action_type || '—'}</td>
                <td>{entry.route || '—'}</td>
                <td>{entry.document_id || '—'}</td>
                <td>{entry.tracking_id || '—'}</td>
                <td>{formatMeta(entry.metadata) || entry.finding_id || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LogsPage() {
  return <GovernanceLogsPanel />;
}
