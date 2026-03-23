import './PolicyRefSelect.css';

/**
 * Dropdown of ingested policy/standards (BRCGS, Cranswick MS, generic policy) + text field for any document ID.
 */
export default function PolicyRefSelect({
  id,
  value,
  onChange,
  policyDocs,
  disabled,
  hint,
}) {
  const list = policyDocs || [];
  const ids = new Set(list.map((d) => d.document_id).filter(Boolean));
  const selectValue = value && ids.has(value) ? value : '';

  return (
    <div className="policy-ref-select-wrap">
      <label htmlFor={id ? `${id}-select` : undefined} className="policy-ref-sr-label">
        Choose from library
      </label>
      <select
        id={id ? `${id}-select` : undefined}
        className="policy-ref-select"
        value={selectValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">— None —</option>
        {list.map((d) => (
          <option key={d.document_id} value={d.document_id}>
            {d.title || d.document_id}
            {d.title && d.document_id !== d.title ? ` — ${d.document_id}` : ''}
          </option>
        ))}
      </select>
      <span className="policy-ref-field-label">Or enter document ID</span>
      <input
        id={id}
        type="text"
        className="policy-ref-custom-input"
        placeholder="e.g. local-Cranswick-Manufacturing-Standard-v2"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {hint ? <span className="form-hint policy-ref-hint">{hint}</span> : null}
    </div>
  );
}
