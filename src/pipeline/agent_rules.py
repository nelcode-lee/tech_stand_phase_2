"""Shared rules applied across all pipeline agents."""

# Document reference rule — when procedures mention forms, logs, SOPs, schedules, or related documents:
# - If a child/supporting document is already referenced → allow for non-specificity (do not flag)
# - If no document reference is given → flag and ask for one (recommend adding the reference)
DOCUMENT_REFERENCE_RULE = """
DOCUMENT REFERENCE RULE (apply across all findings)
When procedures mention forms, logs, schedules, SOPs, summaries, or related documents:
- If a child/supporting document is already referred to (by name, code, or reference) → allow for non-specificity; do not flag.
- If no document reference is given → flag it and ask for one. Recommend adding the specific document name, code, or reference.

CONTROLLED CHILD / SUPPORTING DOCUMENTS
If a measurable parameter, limit, tolerance, or acceptance criterion is held in a linked controlled document, record form, setup sheet, or work instruction:
- Do NOT require the value to be repeated in the SOP when the SOP explicitly identifies the source document and makes clear when it must be consulted.
- Accept this only when the dependency is unambiguous at point of use (e.g. the document or record is named or coded, and the operator can tell what it is for).
- Flag only when the reference is generic, unnamed, inaccessible, or leaves the user guessing where the criterion comes from or when to check it.
"""

# Job title vs named individual — controlled procedures must use roles, not person names
JOB_TITLE_RULE = """
RESPONSIBILITIES — JOB TITLE, NOT NAMED INDIVIDUAL
For controlled procedures, job titles or roles (e.g. "Quality Manager", "Site Supervisor", "Despatch Operative") are appropriate.
Do NOT flag or require named individuals (e.g. "John Smith"). Named individuals are inappropriate for controlled procedures because people change; jobs do not.
"""

# Distinguish tolerance/parameter gaps from missing document references (especially in intake/specification sections)
TOLERANCE_VS_REFERENCE_RULE = """
TOLERANCE CHECKS vs MISSING REFERENCE DOCUMENTS (do not confuse)
When reviewing intake, specification, or reference sections:
- TOLERANCE/PARAMETER GAP: missing numeric limits, units, or ranges (e.g. "check temperature" without °C; "verify weight" without kg). Flag as missing tolerance or parameter.
- MISSING REFERENCE DOCUMENT: mentions a form, procedure, or document without naming it (e.g. "as per the procedure", "complete the check"). Flag as missing document reference.
- LINKED CONTROLLED DOCUMENT: if the SOP clearly names the controlled source for the parameter (e.g. a setup sheet, form, or work instruction), do NOT flag the SOP just for not repeating the value. Flag only if the linkage is unclear or unusable.
These are distinct. Do not flag a tolerance gap as a missing document, or vice versa.
"""

# Purpose/objective can be conveyed implicitly — don't require an explicit section
PURPOSE_OBJECTIVE_RULE = """
PURPOSE AND OBJECTIVE — IMPLICIT IS ACCEPTABLE
Purpose and objective are often conveyed by the document's title, introduction, or procedure content. Do NOT flag "purpose/objective missing" or "purpose/objective required" when the document clearly explains what it is for. Only flag if the document's intent is genuinely unclear.
"""

# Corrective actions can be described in narrative form — do not flag when already present
CORRECTIVE_ACTIONS_RULE = """
CORRECTIVE ACTIONS — NARRATIVE FORM IS ACCEPTABLE
Corrective actions (what to do when something goes wrong) may be described in narrative prose within the same paragraph or section as the failure scenario. They do NOT require a separate "Corrective Actions" heading or numbered list.
Do NOT flag "corrective actions missing" or "no specific corrective actions" when the document describes specific actions in the same paragraph or nearby text, such as: who to inform, what to do (e.g. keep doors closed, call engineering, transfer product), timeframes (e.g. within an hour), escalation steps, or product handling (e.g. quarantine).
Only flag when a failure scenario is mentioned but NO actionable steps are given (e.g. only "inform X" with no further guidance on what happens next).
"""
