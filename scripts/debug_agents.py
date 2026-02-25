"""Debug script: run agents and log raw LLM output to see why no flags are returned."""
import asyncio
import json
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.pipeline.llm import completion, parse_json_array

# Same prompts as the agents
SPECIFYING_PROMPT = """You are the Specification and Precision Analyst for Cranswick, a UK meat producer.
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


def main():
    sample = Path(__file__).resolve().parent.parent / "sample_docs" / "forignbodyprevention.txt"
    content = sample.read_text(encoding="utf-8")

    # Use first 8000 chars (enough to include "low risk", "Regular checks", "At all times")
    content_sample = content[:8000]
    prompt = f"Analyse the following procedure for vague or unmeasurable language:\n\n{content_sample}"

    print("Calling LLM (Specifying agent prompt)...")
    raw = asyncio.run(completion(prompt, system=SPECIFYING_PROMPT))

    print("\n" + "=" * 60)
    print("RAW LLM RESPONSE (first 2000 chars):")
    print("=" * 60)
    print(raw[:2000])
    if len(raw) > 2000:
        print("...[truncated]")

    parsed = parse_json_array(raw)
    print("\n" + "=" * 60)
    print(f"PARSED RESULT: {len(parsed)} items")
    print("=" * 60)
    print(json.dumps(parsed, indent=2))

    # Check which items would pass validation (need location, current_text, issue, recommendation)
    valid = [
        p for p in parsed
        if isinstance(p, dict) and p.get("location") and p.get("current_text") and p.get("issue") and p.get("recommendation")
    ]
    print(f"\nItems passing validation: {len(valid)}")


if __name__ == "__main__":
    main()
