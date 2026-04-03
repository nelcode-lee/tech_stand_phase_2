"""Agent 7: Formatting — flags layout, presentation, and visual formatting issues."""
from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE, PURPOSE_OBJECTIVE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.context_limits import slice_document_for_agent, slice_policy_appendix_for_agent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, FormattingFlag

FORMATTING_SYSTEM_PROMPT = """You are a document formatting and presentation analyst working for Cranswick Group.

You operate in a FTSE250 PLC with formal document control governance across multiple sites.
Documents you analyse are used operationally by production operatives and supervisors, and are subject to audit.
Your findings should reflect that documents must be usable on factory floor environments and auditable against the governing template.

----------------------------------------------------

SCOPE BOUNDARY — STRUCTURE vs CONTENT

FLAG HERE (STRUCTURE / PRESENTATION):
- Missing required SECTIONS or structural elements (e.g. headings, version block, scope statement, related documents list).
- Heading hierarchy problems (unclear levels, inconsistent numbering, broken nesting).
- Numbering/list consistency problems.
- Structural mismatch between the nature of content and its presentation format (see rules below).

DO NOT FLAG HERE (CONTENT):
- Missing required content within a section (limits, tolerances, named roles, corrective actions).
  Those belong to the Risk Assessor or Specifier.

----------------------------------------------------

DO NOT FLAG (belongs to Cleanser)
- Sentence length, word choice, style, tone, or readability of individual sentences.
- Grammar improvements, rewriting, or “make it clearer” unless it is a structural/presentation change (lists/tables/headings).

----------------------------------------------------

STRUCTURAL MISMATCH RULES

Flag when content is presented in a format that does not match its nature:
- Sequential steps presented as prose (should be a numbered list).
- Parallel items presented as a run-on sentence (should be a bullet list).
- Decision logic presented as a paragraph (should be a table or decision tree).

----------------------------------------------------

LIST FORMAT RULES (apply consistently across the document)

NUMBERED LISTS — required when:
- Steps must be performed in sequence.
- Order affects outcome or safety.
- Steps are referenced elsewhere by number (e.g. “see Step 4”).
- A process has a defined start and end.

BULLET POINTS — appropriate when:
- Items are parallel but unordered (e.g. list of required equipment).
- Multiple considerations apply simultaneously (e.g. what to check, not how to check it).
- Reference information without a sequence.

FLAG when:
- A sequential process uses bullet points.
- A non-sequential list uses numbers (implies false order dependency).
- Both formats are mixed within a single equivalent list without a structural reason.

----------------------------------------------------

CITATIONS

- Include citations ONLY when a structural gap relates to a mandatory requirement in the governing template, a BRCGS document control clause, or an explicitly-provided parent policy requirement.
- Do NOT cite standards for presentation style preferences.
- If no mandatory requirement applies, leave citations as an empty array.

----------------------------------------------------

OUTPUT FORMAT — STRICT

Return ONLY a JSON array. Each object must follow this structure:

{
  "location": "<section reference or nearby heading>",
  "excerpt": "<exact quote from the document that shows the issue (copy-paste)>",
  "issue": "<purely factual description of the structural/presentation issue>",
  "recommendation": "<specific fix (e.g. convert prose to numbered steps; fix heading hierarchy; add missing required section heading/block)>",
  "citations": []
}

RULES
- No prose outside JSON.
- Do not invent requirements, headings, or template rules.
- Do not invent citations.
- If no issues exist, return [].
""" + DOCUMENT_REFERENCE_RULE + PURPOSE_OBJECTIVE_RULE


class FormattingAgent(BaseAgent):
    name = "formatting"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.draft_content:
            ctx.draft_content = ctx.cleansed_content
        content = ctx.draft_content or ctx.cleansed_content or ""
        if not content:
            return ctx

        try:
            # Use document_title from request (authoritative) — avoids cross-doc contamination when chunks are mixed
            doc_title = ctx.document_title
            if not doc_title and ctx.retrieved_chunks:
                doc_title = next((c.title for c in ctx.retrieved_chunks if c.title), None)
            prompt_parts = ["Analyse the following document for formatting and presentation issues:"]
            prompt_parts.append(f"\n\nContent:\n{slice_document_for_agent(content)}")
            policy_block = self._policy_context_block(ctx)
            if policy_block:
                prompt_parts.append(f"\n\nPARENT POLICY (context):\n{slice_policy_appendix_for_agent(policy_block)}")
            prompt = "".join(prompt_parts)
            system = FORMATTING_SYSTEM_PROMPT
            if getattr(ctx, "glossary_block", None) and (ctx.glossary_block or "").strip():
                system += "\n\n" + (ctx.glossary_block or "").strip()
            raw = await completion(prompt, system=system)
            items = parse_json_array(raw)
            for item in items:
                if isinstance(item, dict) and item.get("location") and item.get("issue") and item.get("recommendation"):
                    excerpt = (item.get("excerpt") or "").strip() or None
                    citations_raw = item.get("citations")
                    citations: list[str] = []
                    if isinstance(citations_raw, list):
                        citations = [str(c).strip() for c in citations_raw if str(c).strip()]
                    ctx.formatting_flags.append(
                        FormattingFlag(
                            location=str(item["location"]),
                            excerpt=excerpt,
                            issue=str(item["issue"]),
                            recommendation=str(item["recommendation"]),
                            citations=citations,
                        )
                    )
        except Exception as e:
            self._add_error(ctx, f"Formatting LLM failed: {e}", "high")

        return ctx
