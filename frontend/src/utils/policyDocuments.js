/**
 * Library documents that are policy / standards (BRCGS, Cranswick MS, generic policy).
 * Used for Policy Reference dropdowns — same list for all policy types.
 */
export function filterPolicyDocumentsForRef(docs) {
  if (!Array.isArray(docs)) return [];
  return docs
    .filter((d) => {
      const layer = String(d.doc_layer || '').toLowerCase();
      return layer === 'policy' || layer === 'policy_brcgs' || layer === 'policy_cranswick';
    })
    .slice()
    .sort((a, b) =>
      String(a.title || a.document_id || '').localeCompare(
        String(b.title || b.document_id || ''),
        undefined,
        { sensitivity: 'base' }
      )
    );
}
