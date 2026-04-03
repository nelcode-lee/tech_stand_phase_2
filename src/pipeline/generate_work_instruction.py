"""
Generate Work Instructions from qualifying questions + optional chat refinement.
Uses policy context (BRCGS, Cranswick MS) and reference docs when provided.
"""
import re

from src.pipeline.llm import completion_for_draft


WI_SYSTEM = """You are a Technical Standards Officer for a UK food manufacturer (Cranswick).
Your job is to write clear, step-by-step Work Instructions for the person doing the task.

Work Instructions are:
- Step-by-step guides for ONE specific task (the "YouTube tutorial" of process docs)
- Designed for the operator, not the approver
- Include measurements, timing, tolerances when relevant
- Include safety/PPE when relevant
- Use numbered steps; consider checklists or visuals where they help

Output a single Work Instruction document in plain text. Use:
- A clear title
- Scope (what this covers)
- Prerequisites (tools, PPE, training)
- Numbered procedure steps with enough detail to follow without guessing
- Any warnings or notes (e.g. "Don't forget to stir or it'll get lumpy")
- References to parent SOP or policy where relevant

Write in second person ("Ensure...", "Record..."). Be specific and measurable.
Do not use markdown headers (##). Use plain text with line breaks."""


def _slug(s: str) -> str:
    """Simple slug for suggested document ID."""
    if not s or not str(s).strip():
        return ""
    t = re.sub(r"[^a-zA-Z0-9\s-]", "", str(s).strip())
    return re.sub(r"\s+", "-", t)[:40].strip("-") or "wi"


def _build_policy_context(clauses: list[dict], limit_chars: int = 8000) -> str:
    """Format policy clauses for the prompt."""
    parts = []
    total = 0
    for row in clauses:
        cite = (row.get("canonical_citation") or "").strip()
        head = (row.get("heading") or "").strip()
        req = (row.get("requirement_text") or "").strip()
        if not req:
            continue
        block = f"[{cite}]"
        if head:
            block += f" {head}"
        block += f"\n{req[:600]}{'…' if len(req) > 600 else ''}\n"
        if total + len(block) > limit_chars:
            break
        parts.append(block)
        total += len(block)
    return "\n".join(parts) if parts else "(No policy clauses loaded)"


def _build_ref_docs_context(ref_contents: list[str], limit_chars: int = 4000) -> str:
    """Format reference document contents."""
    parts = []
    total = 0
    for c in ref_contents:
        if not c or not str(c).strip():
            continue
        block = str(c).strip()[:1500]
        if total + len(block) > limit_chars:
            break
        parts.append(block)
        total += len(block)
    return "\n\n---\n\n".join(parts) if parts else ""


async def generate_work_instruction(
    *,
    task_name: str,
    parent_sop: str | None = None,
    site: str | None = None,
    process_type: str | None = None,
    has_measurements: bool = False,
    measurements_detail: str | None = None,
    has_safety: bool = False,
    safety_detail: str | None = None,
    needs_visuals: bool = False,
    needs_checklist: bool = False,
    reference_doc_contents: list[str] | None = None,
    follow_up_message: str | None = None,
    previous_draft: str | None = None,
    policy_clauses: list[dict] | None = None,
) -> tuple[str, str]:
    """
    Generate or refine a Work Instruction.
    Returns (draft_text, suggested_document_id).
    """
    policy_block = _build_policy_context(policy_clauses or [])
    ref_block = _build_ref_docs_context(reference_doc_contents or [])

    if follow_up_message and previous_draft:
        # Refinement pass
        user = f"""CURRENT DRAFT:
{previous_draft[:12000]}{"…" if len(previous_draft) > 12000 else ""}

USER REFINEMENT REQUEST:
{follow_up_message}

Revise the Work Instruction above according to the user's request. Output the full revised document. Keep the same structure unless the user asks to change it. Return only the document text, no commentary."""

    else:
        # Initial generation from questionnaire
        reqs = []
        if has_measurements:
            reqs.append("Include measurements, tolerances, or timing where relevant.")
            if measurements_detail:
                reqs.append(f"Specifics: {measurements_detail}")
        if has_safety:
            reqs.append("Include PPE and safety precautions.")
            if safety_detail:
                reqs.append(f"Specifics: {safety_detail}")
        if needs_visuals:
            reqs.append("Include placeholders for diagrams or photos where they would help.")
        if needs_checklist:
            reqs.append("Include a verification checklist at the end.")

        req_block = "\n".join(f"- {r}" for r in reqs) if reqs else "- Be thorough and specific."

        user = f"""Create a Work Instruction for this task:

TASK: {task_name}
{f'SITE / AREA: {site}' if site else ''}
{f'PARENT SOP: {parent_sop}' if parent_sop else ''}
{f'PROCESS TYPE: {process_type}' if process_type else ''}

REQUIREMENTS:
{req_block}

POLICY CONTEXT (relevant BRCGS / Cranswick Manufacturing Standard clauses):
{policy_block}
"""

        if ref_block:
            user += f"""

REFERENCE MATERIAL (from Library):
{ref_block}
"""
        user += "\n\nOutput the Work Instruction now. Plain text only, no markdown."

    out = await completion_for_draft(user, system=WI_SYSTEM)
    draft = (out or "").strip()
    suggested_id = f"WI-{_slug(task_name)}" if task_name else "WI-unnamed"
    return draft, suggested_id
