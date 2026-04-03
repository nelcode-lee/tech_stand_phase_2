"""Shared rules applied across all pipeline agents."""

# Document reference rule (v2.1) — operator reference usability only; not document-control / QMS auditing.
DOCUMENT_REFERENCE_RULE = """
DOCUMENT REFERENCE HANDLING (v2.1 — RE-SCOPED)
Retain **reference usability only** at point of use. This is **not** a document-control audit, **not** a QMS or records-management audit, and **not** a test of whether every cross-reference in a quality system is perfect.

Use only these checks:
1. Can the operator tell **which** document, form, record, or procedure to use when the step depends on it (name, code, or other clear pointer)?
2. Can they tell **where to find it** or how to retrieve it in normal work — or is the pointer so generic that they would not know what to open?

When procedures mention forms, logs, schedules, SOPs, summaries, or related documents:
- If (1) and (2) are satisfied for the operative → **do not** flag for “more” referencing or document-control completeness.
- If a step depends on another document but **no** usable reference is given (e.g. “as per the procedure”, “the form”, “complete the check” with no identifier) → flag; recommend the **minimum** the operator needs to identify and find the item. Do **not** prescribe a full document-management workflow.

LINKED LIMITS IN OTHER DOCUMENTS (usability — not auditing)
If a measurable parameter, limit, tolerance, or acceptance criterion is held in a linked document, record, setup sheet, or work instruction:
- Do **not** require the numeric value to be copied into this document when the **source is named** and it is clear **when** the operator must consult it — provided the operator can tell **which** document to open.
- Flag only when the operator **cannot** tell which linked document applies, **when** to use it, or what to open — not to enforce document-control matrices or revision rules.
- Missing **numbers** or pass/fail criteria (tolerance gaps) are handled under the tolerance / Specifier rules; do not treat them as “missing reference” unless the issue is truly “no pointer to any source”.
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
