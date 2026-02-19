"""Agent 1: Cleansing — normalises document content and flags vague language."""
import re

from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, SpecifyingFlag

CLEANSING_SPEC_PROMPT = """You are the Specification and Precision Analyst for Cranswick, a UK meat producer.
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


class CleansingAgent(BaseAgent):
    name = "cleansing"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.retrieved_chunks:
            self._add_error(ctx, "No retrieved chunks to cleanse", "critical")
            return ctx

        parts: list[str] = []
        for chunk in ctx.retrieved_chunks:
            text = _cleanse_text(chunk.text)
            if text:
                parts.append(text)

        ctx.cleansed_content = "\n\n".join(parts) if parts else None
        if not ctx.cleansed_content:
            self._add_error(ctx, "Cleansed content is empty", "critical")
            return ctx

        # Run specification analysis on cleansed content
        try:
            prompt = f"Analyse the following procedure for vague or unmeasurable language:\n\n{ctx.cleansed_content[:12000]}"
            raw = await completion(prompt, system=CLEANSING_SPEC_PROMPT)
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
            self._add_error(ctx, f"Cleansing specification analysis failed: {e}", "high")

        return ctx


def _cleanse_text(text: str) -> str:
    """Strip HTML, normalise whitespace, fix encoding."""
    if not text:
        return ""
    # Strip HTML/XML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Normalise quotes and dashes
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    return text.strip()
