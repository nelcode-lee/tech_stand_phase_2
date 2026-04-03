"""Agent: Draft layout — restructure cleansed content into FSP003-style draft (sections, numbered steps, History of Change)."""
from src.pipeline.base_agent import BaseAgent
from src.pipeline.context_limits import slice_document_for_agent
from src.pipeline.domain import load_domain_context
from src.pipeline.llm import completion_for_draft
from src.pipeline.models import PipelineContext

DRAFT_LAYOUT_SYSTEM = """You are restructuring a procedure document into the Cranswick FSP003-style draft layout for human-in-the-loop review.

MANDATORY SOP STRUCTURE (use this order; place content under these headings):
1. Scope — applicability, what the procedure covers and where it applies.
2. Reference documents — related documents, standards, forms, or other SOPs that are referenced.
3. Responsibility — who is accountable (roles/job titles); who does what.
4. Frequency — how often the activity is done (schedule, periodicity).
5. Procedure — the steps/method (numbered 1. 2. 2a. 2b. etc.).

After these five sections, include any other sections that fit the content: Definitions, Record Keeping, Corrective Actions, Review Schedule, Approval / Sign-off. If the source has revision history or "History of Change", put it at the end under a section heading "History of Change". Do NOT invent revision history if absent.

FORMATTING RULES:
- PLAIN TEXT only: no markdown (no ## or **).
- Section headings: one per line, on their own line, no leading symbols. Use exact headings: "Scope", "Reference documents", "Responsibility", "Frequency", "Procedure" for the core five.
- Numbered steps: "1." "2." "3." for main steps; "2a." "2b." "2c." for sub-steps under step 2.
- Bullet lists: " - " at the start of each line.
- Preserve all substantive content; only restructure for clarity and this layout.
- Within Procedure, where the source has clear sub-topics (e.g. vehicle temperature, load cleanliness, product security, product returns), use sub-section headings on their own line, then the content: e.g. "Picking orders", "Loading Procedure", "Trailer information", "Vehicle Temperature", "Load cleanliness", "Product Security", "Product Returns".

Output only the restructured plain text. No preamble, no explanation."""


def _get_section_names_for_prompt() -> str:
    """Build section list: core five (Scope, Reference documents, Responsibility, Frequency, Procedure) then domain template then procedure sub-headings."""
    core_five = ["Scope", "Reference documents", "Responsibility", "Frequency", "Procedure"]
    ctx = load_domain_context()
    template = ctx.get("standard_document_sections", {}).get("template", [])
    names = [t.get("name", "").strip() for t in template if isinstance(t, dict) and t.get("name")]
    extra = [
        "Picking orders", "Loading Procedure", "Trailer information",
        "Vehicle Temperature", "Load cleanliness", "Product Security", "Product Returns",
    ]
    seen = {n.lower(): n for n in core_five}
    for n in names:
        if n and n.lower() not in seen:
            seen[n.lower()] = n
    for e in extra:
        if e.lower() not in seen:
            seen[e.lower()] = e
    return ", ".join(seen.values())


class DraftLayoutAgent(BaseAgent):
    """Restructures cleansed_content into FSP003-style draft with section headings and numbered steps."""

    name = "draft_layout"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.cleansed_content or not ctx.cleansed_content.strip():
            return ctx

        section_names = _get_section_names_for_prompt()
        system = DRAFT_LAYOUT_SYSTEM + "\n\nStandard section names (use where content fits): " + section_names

        content = slice_document_for_agent(ctx.cleansed_content)
        prompt = (
            "Restructure the following procedure content into the FSP003-style draft layout. "
            "Output plain text only: section headings on their own line, numbered steps (1. 2. 2a. 2b. etc.), "
            "bullets with \" - \". Preserve all content; add History of Change only if present in the source.\n\n"
            f"Content:\n{content}"
        )

        try:
            raw = await completion_for_draft(prompt, system=system)
            if raw and raw.strip():
                ctx.draft_content = raw.strip()
            else:
                ctx.draft_content = ctx.cleansed_content
        except Exception as e:
            self._add_error(ctx, f"Draft layout LLM failed: {e}", "medium")
            ctx.draft_content = ctx.cleansed_content

        return ctx
