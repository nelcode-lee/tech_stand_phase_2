"""Agent 6: Sequencing — flags logical flow and step-order issues in procedures."""
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, DocLayer, SequencingFlag

SEQUENCING_SYSTEM_PROMPT = """You are the Logical Flow and Step Sequencing Analyst for Cranswick, a UK meat producer.
Your responsibility is to ensure that operational steps in technical procedures follow a logical, safe, and efficient order.

CORE PRINCIPLES
- No speculative additions.
- Do not generate new steps not grounded in the document.
- Identify sequencing issues only when they are explicitly evident.

YOU MUST IDENTIFY:
1. Logical order failures:
   - Steps requiring prerequisites not yet completed
   - Actions occurring before required safety checks
   - CCP verification happening too late

2. Operational inefficiencies:
   - Repeated steps
   - Steps that belong earlier/later in process flow
   - Opportunities for parallel tasks ONLY if explicitly supported by text

3. Meat-industry specific sequencing issues:
   - Raw/cooked segregation violations
   - Incorrect order of hygiene or sanitation activities
   - Incomplete chilling, resting, or temperature stabilisation sequences
   - Steps that allow contamination or cross-contact risk

4. Internal contradictions in workflow sequencing:
   - Time, temperature, or pre-start checks positioned incorrectly
   - Missing prerequisites that break HACCP logic

ABSOLUTE RULES
- No guessing the correct sequence.
- Only flag issues that are demonstrably wrong based on the text.

OUTPUT
Return only a JSON array. Each item has:
- location: step or section reference
- issue: specific sequencing or logic problem
- impact: risk or operational consequence (factual only)
- recommendation: required change while staying within document content

Example: [{"location": "Step 5", "issue": "Temperature check occurs after product has been packed", "impact": "CCP verification too late", "recommendation": "Move temperature verification before packing step"}]
If no issues, return []."""


class SequencingAgent(BaseAgent):
    name = "sequencing"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if ctx.doc_layer in (DocLayer.policy, DocLayer.principle):
            return ctx
        if not ctx.draft_content:
            ctx.draft_content = ctx.cleansed_content
        content = ctx.draft_content or ctx.cleansed_content or ""
        if not content:
            return ctx

        try:
            prompt = f"Analyse the following procedure for sequencing and logical flow issues:\n\n{content[:12000]}"
            raw = await completion(prompt, system=SEQUENCING_SYSTEM_PROMPT)
            items = parse_json_array(raw)
            for item in items:
                if isinstance(item, dict) and item.get("location") and item.get("issue") and item.get("impact") and item.get("recommendation"):
                    ctx.sequencing_flags.append(
                        SequencingFlag(
                            location=str(item["location"]),
                            issue=str(item["issue"]),
                            impact=str(item["impact"]),
                            recommendation=str(item["recommendation"]),
                        )
                    )
        except Exception as e:
            self._add_error(ctx, f"Sequencing LLM failed: {e}", "high")

        return ctx
