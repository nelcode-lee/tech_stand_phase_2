"""Shared rules applied across all pipeline agents."""

# Document reference rule — when procedures mention forms, logs, SOPs, schedules, or related documents:
# - If a child/supporting document is already referenced → allow for non-specificity (do not flag)
# - If no document reference is given → flag and ask for one (recommend adding the reference)
DOCUMENT_REFERENCE_RULE = """
DOCUMENT REFERENCE RULE (apply across all findings)
When procedures mention forms, logs, schedules, SOPs, summaries, or related documents:
- If a child/supporting document is already referred to (by name, code, or reference) → allow for non-specificity; do not flag.
- If no document reference is given → flag it and ask for one. Recommend adding the specific document name, code, or reference.
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
These are distinct. Do not flag a tolerance gap as a missing document, or vice versa.
"""

# Purpose/objective can be conveyed implicitly — don't require an explicit section
PURPOSE_OBJECTIVE_RULE = """
PURPOSE AND OBJECTIVE — IMPLICIT IS ACCEPTABLE
Purpose and objective are often conveyed by the document's title, introduction, or procedure content. Do NOT flag "purpose/objective missing" or "purpose/objective required" when the document clearly explains what it is for. Only flag if the document's intent is genuinely unclear.
"""
