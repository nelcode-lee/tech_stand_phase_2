import { SITES_OPTIONS } from '../constants/sites';
import './SitesSelect.css';

/**
 * Multi-select for sites. "All Sites" when selected means all remaining locations.
 */
export default function SitesSelect({ value, onChange, id, className = '' }) {
  const selected = Array.isArray(value)
    ? value
    : value
      ? String(value).split(/[,\s]+/).filter(Boolean)
      : [];

  function toggle(siteValue) {
    if (siteValue === 'all') {
      onChange(selected.includes('all') ? [] : ['all']);
      return;
    }
    if (selected.includes('all')) {
      onChange([siteValue]);
      return;
    }
    const next = selected.includes(siteValue)
      ? selected.filter(v => v !== siteValue)
      : [...selected, siteValue];
    onChange(next);
  }

  function handleAllSitesChange(e) {
    if (e.target.checked) {
      onChange(['all']);
    } else {
      onChange([]);
    }
  }

  return (
    <div className={`sites-select ${className}`} id={id}>
      <div className="sites-select-option sites-select-all">
        <input
          type="checkbox"
          id={`${id || 'sites'}-all`}
          checked={selected.includes('all')}
          onChange={handleAllSitesChange}
        />
        <label htmlFor={`${id || 'sites'}-all`}>All Sites</label>
      </div>
      <div className="sites-select-list">
        {SITES_OPTIONS.filter(s => s.value !== 'all').map(s => (
          <div key={s.value} className="sites-select-option">
            <input
              type="checkbox"
              id={`${id || 'sites'}-${s.value.replace(/\s+/g, '-')}`}
              checked={selected.includes('all') || selected.includes(s.value)}
              disabled={selected.includes('all')}
              onChange={() => toggle(s.value)}
            />
            <label htmlFor={`${id || 'sites'}-${s.value.replace(/\s+/g, '-')}`}>{s.label}</label>
          </div>
        ))}
      </div>
    </div>
  );
}
