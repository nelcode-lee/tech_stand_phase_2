/**
 * Epic B — visible scope: document identity, layer, sites, policy reference, tracking id.
 */
export function AnalysisScopeStrip({
  documentId,
  title,
  docLayer,
  sitesLabel,
  policyRef,
  onPolicyRefChange,
  trackingId,
  readOnlyPolicy = false,
}) {
  return (
    <div className="analysis-scope-strip" role="region" aria-label="Analysis scope">
      <div className="analysis-scope-strip-inner">
        <div className="analysis-scope-field">
          <span className="analysis-scope-label">Document</span>
          <span className="analysis-scope-value" title={documentId || ''}>
            {documentId || '—'}
            {title && title !== documentId ? (
              <span className="analysis-scope-title"> — {title}</span>
            ) : null}
          </span>
        </div>
        <div className="analysis-scope-field">
          <span className="analysis-scope-label">Layer</span>
          <span className="analysis-scope-value">{docLayer || '—'}</span>
        </div>
        <div className="analysis-scope-field">
          <span className="analysis-scope-label">Sites</span>
          <span className="analysis-scope-value">{sitesLabel || '—'}</span>
        </div>
        <div className="analysis-scope-field analysis-scope-field-grow">
          <label className="analysis-scope-label" htmlFor="analysis-policy-ref-input">Policy reference</label>
          {readOnlyPolicy ? (
            <span className="analysis-scope-value">{policyRef || '—'}</span>
          ) : (
            <input
              id="analysis-policy-ref-input"
              type="text"
              className="analysis-scope-policy-input"
              value={policyRef}
              onChange={(e) => onPolicyRefChange?.(e.target.value)}
              placeholder="e.g. library policy id or standard clause set"
              autoComplete="off"
            />
          )}
        </div>
        {trackingId ? (
          <div className="analysis-scope-field analysis-scope-tracking">
            <span className="analysis-scope-label">Session</span>
            <code className="analysis-scope-tracking-id" title={trackingId}>{trackingId}</code>
          </div>
        ) : null}
      </div>
    </div>
  );
}
