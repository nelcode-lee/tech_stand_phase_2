"""
Cranswick AI Agent Governance Standard (v1.0) — runtime helpers.

Canonical human-readable text: docs/CRANSWICK_AI_AGENT_GOVERNANCE_STANDARD.md

Optional: prepend AGENT_GOVERNANCE_PREAMBLE to agent system prompts for consistent
evidence hierarchy and HITL behaviour. Keep the preamble in sync with doc version bumps.
"""

GOVERNANCE_STANDARD_ID = "Cranswick AI Agent Governance Standard"
GOVERNANCE_STANDARD_VERSION = "1.0"

# Short block for injection; does not replace per-agent scope rules in prompts.
AGENT_GOVERNANCE_PREAMBLE = f"""
GOVERNANCE — {GOVERNANCE_STANDARD_ID} v{GOVERNANCE_STANDARD_VERSION} (summary)
- Single responsibility: defer adjacent concerns to the named agent; do not scope-creep.
- No tacit knowledge unless text-in-document or governed injected reference says so.
- Evidence-first: every finding needs what evidence, where it appears, and why it fails.
- No corrective invention; if not determinable from evidence → HITL (recommendation null, explicit bounded reason).
- Evidence order: (1) document-internal logic (2) injected governed references (3) explicitly cited mandatory standards.
- Scope leakage is a defect: own only your dimension (see project prompts for Cleanser / Sequencer / Risk / Conflict / Formatter / Terminology / Validator / others).
""".strip()
