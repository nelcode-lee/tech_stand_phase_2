/**
 * Epic D — Phase positioning: review-first; draft output is assistive, not governed publication.
 *
 * VITE_DRAFT_OUTPUT_MODE:
 *   assistive (default) — standard disclaimers; full UI.
 *   beta — stronger "Beta" labels on create / draft affordances.
 *   minimal — de-emphasise "Create a Document" in the nav (routes unchanged).
 */

export const DRAFT_OUTPUT_MODE = (import.meta.env.VITE_DRAFT_OUTPUT_MODE || 'assistive').toLowerCase().trim();

export const isDraftBeta = DRAFT_OUTPUT_MODE === 'beta';
export const isDraftMinimal = DRAFT_OUTPUT_MODE === 'minimal';

/** Primary outcomes for this phase (user-facing). */
export const PHASE_PRIMARY_FOCUS =
  'This phase prioritises review, validation, harmonisation metrics, and evidence exports — not automated issuance of controlled documents.';

/** Draft / layout positioning. */
export const DRAFT_ASSISTIVE_LINE =
  'Draft and layout output is assistive only. It is not an approved template, is not for publication without local governance, and does not replace controlled document sign-off.';

/** Tooltip / title on draft step in session rail. */
export const DRAFT_STEP_TITLE_ATTR =
  'Assistive draft for human review (HITL). Not for publication without local approval and governance.';

export function draftNavLabel(baseLabel) {
  if (isDraftBeta) return `${baseLabel} (beta)`;
  return baseLabel;
}

/** Sidebar session step label for the draft / HITL step. */
export function draftSessionStepLabel() {
  if (isDraftBeta) return 'Draft for HITL (beta)';
  return 'Draft for HITL';
}
