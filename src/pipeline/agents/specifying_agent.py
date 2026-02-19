"""Agent 5: Specifying — flags vague, unmeasurable, or ambiguous language."""
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, SpecifyingFlag

SPECIFYING_SYSTEM_PROMPT = """You are the Specification and Precision Analyst for Cranswick, a UK meat producer.
Your role is to eliminate vague, subjective, ambiguous, or unmeasurable language in procedures.

CORE PRINCIPLES
- No invention of specifications.
- Only replace vague language with specificity if the data is explicitly available.
- If specificity is missing, flag it as a requirement rather than invent a value.

YOU MUST IDENTIFY:
1. Vague frequency terms:
   - "Regularly"
   - "Often"
   - "As needed"
   - "Periodically"

2. Subjective quality descriptors:
   - "Clean"
   - "Adequate"
   - "Proper"
   - "Acceptable"
   - "Good condition"

3. Undefined quantities:
   - "High temperature"
   - "Low risk"
   - "Sufficient time"
   - "Check temperature is correct"

4. Missing units or tolerances:
   - Temperature without °C
   - Weights without kg/g
   - Times without minutes

5. Meat-industry specifics:
   - Undefined trim levels
   - Undefined yield expectations
   - Undefined chilling/resting times
   - Unspecified purge/colour targets
   - Undefined microbiological acceptance limits (e.g., APC, Enterobacteriaceae)

ABSOLUTE RULES
- Never invent a number, time, limit, or criterion.
- If missing, state that a specific measurable value must be provided.

OUTPUT
Return a JSON array only. Each item has:
- location: reference to where the issue appears
- current_text: the vague or unmeasurable wording
- issue: why it is vague or non-compliant
- recommendation: specific value needed or instruction to provide it

Example: [{"location": "Step 3", "current_text": "clean thoroughly", "issue": "subjective quality descriptor", "recommendation": "Provide measurable criteria e.g. visual inspection against defined standards"}]
If no issues, return []."""


class SpecifyingAgent(BaseAgent):
    name = "specifying"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.cleansed_content and not ctx.draft_content:
            self._add_error(ctx, "No content to analyse for specification gaps", "critical")
            return ctx

        content = ctx.draft_content or ctx.cleansed_content or ""
        if not content:
            return ctx

        prompt = f"Analyse the following procedure for vague or unmeasurable language:\n\n{content[:12000]}"

        try:
            raw = await completion(prompt, system=SPECIFYING_SYSTEM_PROMPT)
            items = parse_json_array(raw)
            for item in items:
                if isinstance(item, dict) and item.get("location") and item.get("current_text") and item.get("issue") and item.get("recommendation"):
                    ctx.specifying_flags.append(
                        SpecifyingFlag(
                            location=str(item["location"]),
                            current_text=str(item["current_text"]),
                            issue=str(item["issue"]),
                            recommendation=str(item["recommendation"]),
                        )
                    )
        except Exception as e:
            self._add_error(ctx, f"Specifying LLM failed: {e}", "high")

        return ctx
