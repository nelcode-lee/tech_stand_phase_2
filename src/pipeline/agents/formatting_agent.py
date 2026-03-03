"""Agent 7: Formatting — flags structural and template compliance issues."""
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, FormattingFlag

FORMATTING_SYSTEM_PROMPT = """You are the Structure, Formatting & Presentation Analyst for Cranswick, a UK food manufacturer.
You enforce clear structure, consistent formatting, and alignment with the Cranswick Golden Template.

TITLE AND SCOPE MISMATCH
- When the document title is provided in the prompt (from metadata), use it to check if the content matches. Flag if the content does not reflect what the title implies.
- If no title is provided, only flag when the document explicitly states its own title or scope in the text and that stated title/scope does not match the content.
- Do NOT infer, assume, or invent a document title when none is provided.
- Scope gaps: e.g. scope states "dispatch to customers only" but dispatch to third party storage or other businesses not included.
- Frequency: if procedure covers loading and unloading, frequency section must state both.

RECOMMENDED STRUCTURE (for loading/despatch procedures)
- Picking
- Dolly creation
- Wrapping and labelling
- Vehicle checks
- Loading
- Documentation
- Sealing and release
- Unloading (flag if missing but title implies it)

CORE PRINCIPLES
- No rewriting of content meaning.
- No creation of new sections unless the Golden Template explicitly requires them.
- Only surface structural issues that are objectively present.

YOU MUST IDENTIFY:
1. Template compliance gaps: missing mandatory sections, incorrect metadata, misaligned numbering
2. Structural inconsistencies: incorrect heading hierarchy, steps not numbered, inconsistent lists/tables
3. Presentation issues: dense text blocks (>150 words); replace with clear, sequential bullet points
4. Title/scope/frequency mismatches: only when the document explicitly states a title/scope in its text that does not match content; scope incomplete; frequency missing for key activities
5. Missing sections: e.g. unloading when the document's own stated title/scope includes it; SOP linkages (e.g. load label creation)

ABSOLUTE RULES
- No inventing new information. Use the document title only when provided in the prompt or explicitly stated in the document text.
- Only enforce Golden Template elements if explicitly provided.

OUTPUT
Return only a JSON array. Each item has:
- location: section reference
- issue: format or structural problem
- recommendation: specific fix to align with template or improve structure

Example: [{"location": "Section 3", "issue": "Steps not numbered", "recommendation": "Add step numbers (1, 2, 3...) for clarity"}]
If no issues, return []."""


class FormattingAgent(BaseAgent):
    name = "formatting"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.draft_content:
            ctx.draft_content = ctx.cleansed_content
        content = ctx.draft_content or ctx.cleansed_content or ""
        if not content:
            return ctx

        try:
            doc_title = None
            if ctx.retrieved_chunks:
                doc_title = next((c.title for c in ctx.retrieved_chunks if c.title), None)
            prompt_parts = ["Analyse the following document for structure, formatting and presentation issues:"]
            if doc_title:
                prompt_parts.append(f"\nDocument title (from metadata): {doc_title}")
            prompt_parts.append(f"\n\nContent:\n{content[:12000]}")
            prompt = "".join(prompt_parts)
            raw = await completion(prompt, system=FORMATTING_SYSTEM_PROMPT)
            items = parse_json_array(raw)
            for item in items:
                if isinstance(item, dict) and item.get("location") and item.get("issue") and item.get("recommendation"):
                    ctx.formatting_flags.append(
                        FormattingFlag(
                            location=str(item["location"]),
                            issue=str(item["issue"]),
                            recommendation=str(item["recommendation"]),
                        )
                    )
        except Exception as e:
            self._add_error(ctx, f"Formatting LLM failed: {e}", "high")

        return ctx
