"""Agent 7: Formatting — flags structural and template compliance issues."""
from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE, PURPOSE_OBJECTIVE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, FormattingFlag

FORMATTING_SYSTEM_PROMPT = """You are the Structure, Formatting & Presentation Analyst for Cranswick, a UK food manufacturer.
You enforce clear structure, consistent formatting, and alignment with the Cranswick Golden Template.

TITLE AND SCOPE MISMATCH
- When the document title is provided in the prompt (from the request — this is the document being analysed), use it to check if the content matches. Flag if the content does not reflect what the title implies.
- Use ONLY the title provided in the prompt. Do not infer or use titles from other documents that may appear in the content.
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

CITATIONS — ALWAYS INCLUDE WHEN POSSIBLE
When a formatting gap relates to BRCGS, Cranswick Golden Template, or parent policy, include a "citations" array. Format: "BRCGS Clause X.Y", "Cranswick Template §X". If such sources are in the context and apply, include at least one citation. Leave [] only when no such source could apply.

OUTPUT
Return only a JSON array. Each item has:
- location: section reference
- excerpt: exact quote from document — the text that relates to this issue (copy-paste from source). Used to highlight the relevant passage.
- issue: format or structural problem
- recommendation: specific fix to align with template or improve structure
- citations: array of BRCGS/Cranswick refs — include when applicable

Example: [{"location": "Section 3", "excerpt": "3. Procedure steps - Check temperature - Record result", "issue": "Steps not numbered", "recommendation": "Add step numbers (1, 2, 3...) for clarity", "citations": ["Cranswick Template §3"]}]
If no issues, return [].""" + DOCUMENT_REFERENCE_RULE + PURPOSE_OBJECTIVE_RULE


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
            prompt_parts = ["Analyse the following document for structure, formatting and presentation issues:"]
            if doc_title:
                prompt_parts.append(f"\nDocument title (from metadata): {doc_title}")
            prompt_parts.append(f"\n\nContent:\n{content[:12000]}")
            if ctx.parent_policy and ctx.parent_policy.content:
                prompt_parts.append(f"\n\nPARENT POLICY (use for citations when applicable):\n{ctx.parent_policy.content[:6000]}")
            prompt = "".join(prompt_parts)
            system = FORMATTING_SYSTEM_PROMPT
            if getattr(ctx, "glossary_block", None) and (ctx.glossary_block or "").strip():
                system += "\n\n" + (ctx.glossary_block or "").strip()
            raw = await completion(prompt, system=system)
            items = parse_json_array(raw)
            for item in items:
                if isinstance(item, dict) and item.get("location") and item.get("issue") and item.get("recommendation"):
                    raw_citations = item.get("citations") or []
                    citations = [str(x).strip() for x in (raw_citations if isinstance(raw_citations, list) else [raw_citations]) if x]
                    excerpt = (item.get("excerpt") or "").strip() or None
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
