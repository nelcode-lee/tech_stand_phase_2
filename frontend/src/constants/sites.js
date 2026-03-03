/**
 * Cranswick sites list. "All Sites" when selected means all remaining locations.
 */
export const SITES_OPTIONS = [
  { value: 'all', label: 'All Sites' },
  { value: 'Cranswick Country Foods - Preston, Hull', label: 'Cranswick Country Foods - Preston, Hull' },
  { value: 'Cranswick Country Foods - Riverside, Hull', label: 'Cranswick Country Foods - Riverside, Hull' },
  { value: 'Cranswick Country Foods - Watton', label: 'Cranswick Country Foods - Watton' },
  { value: 'Cranswick Country Foods - Fresh Poultry, Eye', label: 'Cranswick Country Foods - Fresh Poultry, Eye' },
  { value: 'Cranswick Convenience Foods, Sutton Fields, Hull', label: 'Cranswick Convenience Foods, Sutton Fields, Hull' },
  { value: "Cranswick Gourmet Sausage - Lazenby's, Hull", label: "Cranswick Gourmet Sausage - Lazenby's, Hull" },
  { value: 'Cranswick Gourmet Kitchen - Hull', label: 'Cranswick Gourmet Kitchen - Hull' },
  { value: 'Cranswick Country Foods - Poultry, Hull', label: 'Cranswick Country Foods - Poultry, Hull' },
  { value: 'Cranswick Convenience Foods - Milton Keynes', label: 'Cranswick Convenience Foods - Milton Keynes' },
  { value: 'Cranswick Convenience Foods - Barnsley', label: 'Cranswick Convenience Foods - Barnsley' },
  { value: 'Cranswick Continental Foods - Bury & Worlsey', label: 'Cranswick Continental Foods - Bury & Worlsey' },
  { value: 'Katsouris Brothers - Wembley', label: 'Katsouris Brothers - Wembley' },
  { value: 'Cranswick Gourmet Bacon - West Yorkshire', label: 'Cranswick Gourmet Bacon - West Yorkshire' },
  { value: 'Yorkshire Baker - North Yorkshire', label: 'Yorkshire Baker - North Yorkshire' },
  { value: 'Cranswick Pet Products - North Scarle', label: 'Cranswick Pet Products - North Scarle' },
  { value: 'Cranswick Prepared Poultry - Hull', label: 'Cranswick Prepared Poultry - Hull' },
  { value: 'Froch Foods - Leeds', label: 'Froch Foods - Leeds' },
];

/** Site values excluding "All Sites" — used when "All Sites" is selected. */
export const ALL_SITES_VALUES = SITES_OPTIONS.filter(s => s.value !== 'all').map(s => s.value);

/** Resolve selected sites for API: if "all" selected, return all site values. */
export function resolveSitesForApi(selected) {
  if (!selected || selected.length === 0) return [];
  if (selected.includes('all')) return ALL_SITES_VALUES;
  return selected;
}

/** Format sites for display: show "All Sites" when all locations are included. */
export function formatSitesForDisplay(sites) {
  if (!sites || (Array.isArray(sites) && sites.length === 0)) return null;
  const arr = Array.isArray(sites) ? sites : String(sites).split(/[,\s]+/).filter(Boolean);
  if (arr.length >= ALL_SITES_VALUES.length && ALL_SITES_VALUES.every(s => arr.includes(s))) {
    return 'All Sites';
  }
  return arr.join(', ');
}
