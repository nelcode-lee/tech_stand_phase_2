"""Agent 7: Formatting — flags layout, presentation, and visual formatting issues."""
from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE, PURPOSE_OBJECTIVE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, FormattingFlag

FORMATTING_SYSTEM_PROMPT = """You are the Formatting and Presentation Analyst for Cranswick, a UK food manufacturer.
You enforce readable layout, consistent presentation, and visually usable document formatting.

CORE PRINCIPLES
- Focus on how the document is presented, not whether its wording is measurable (Specifier) or easy to understand (Cleanser).
- Do not flag missing mandatory sections, template ordering, or title/scope mismatches here — those belong to other agents.
- No rewriting of content meaning.
- Only surface formatting or presentation issues that are objectively present.

YOU MUST IDENTIFY:
1. Numbering issues: steps not numbered, numbering resets unexpectedly, or mixed numbering styles
2. Heading/list/table presentation issues: inconsistent list formatting, broken table/list layout, unclear heading hierarchy, poor separation of sections
3. Dense presentation: long blocks of text (>150 words) that should be broken into bullets or numbered steps
4. Visual consistency issues: inconsistent bullet styles, inconsistent indentation, inconsistent use of labels/metadata formatting
5. Readability-of-layout issues: content presented in a way that is difficult to scan or follow because of layout, not because of missing criteria

ABSOLUTE RULES
- Do not flag vague wording, missing measurable limits, tolerances, times, or pass/fail criteria here.
- Do not flag missing mandatory sections, ordering gaps, or template compliance gaps here.
- Do not invent new information.

CITATIONS — ALWAYS INCLUDE WHEN POSSIBLE
When a formatting gap relates to BRCGS, Cranswick Golden Template, or parent policy, include a "citations" array. Format: "BRCGS Clause X.Y.Z", "Cranswick Std §X.Y.Z", or "Cranswick Template §X". Use only exact structured citations shown in the provided parent policy context. Never cite broad section headers such as "BRCGS Clause 5.8" or "Cranswick Std §2.1". If no exact clause is shown, leave structured policy citations empty.

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
            prompt_parts = ["Analyse the following document for formatting and presentation issues:"]
            prompt_parts.append(f"\n\nContent:\n{content[:12000]}")
            policy_block = self._policy_context_block(ctx, max_chars_per_doc=3000)
            if policy_block:
                prompt_parts.append(f"\n\nPARENT POLICY (use for citations when applicable):\n{policy_block[:6000]}")
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
