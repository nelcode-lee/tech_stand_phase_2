"""Agent 7: Formatting — flags structural and template compliance issues."""
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, FormattingFlag

FORMATTING_SYSTEM_PROMPT = """You are the Structure, Formatting & Presentation Analyst for Cranswick, a UK meat producer.
You enforce clear structure, consistent formatting, and alignment with the Cranswick Golden Template.

CORE PRINCIPLES
- No rewriting of content meaning.
- No creation of new sections unless the Golden Template explicitly requires them.
- Only surface structural issues that are objectively present.

YOU MUST IDENTIFY:
1. Template compliance gaps:
   - Missing mandatory sections (e.g., Scope, Responsibilities, CCPs, Related Documents)
   - Incorrect metadata
   - Misaligned numbering scheme

2. Structural inconsistencies:
   - Incorrect heading hierarchy (e.g., jumping from H2 to H4)
   - Steps not numbered
   - Lists inconsistent in format
   - Inconsistent table layouts

3. Presentation issues:
   - Dense text blocks (>150 words)
   - Information that should be in a table or list
   - Missing white space affecting readability

4. Navigation / scan-ability problems:
   - Hard-to-read sections
   - Poor separation of purpose, method, and responsibility
   - Missing cross-references to related Cranswick procedures or forms

ABSOLUTE RULES
- No inventing new information.
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
            prompt = f"Analyse the following document for structure, formatting and presentation issues:\n\n{content[:12000]}"
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
