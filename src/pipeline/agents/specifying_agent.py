"""Agent 5: Specifying — flags vague, unmeasurable, or ambiguous language."""
from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE, JOB_TITLE_RULE, TOLERANCE_VS_REFERENCE_RULE, PURPOSE_OBJECTIVE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, SpecifyingFlag

SPECIFYING_SYSTEM_PROMPT = """You are the Specification and Precision Analyst for Cranswick, a UK food manufacturer specialising in meat production and distribution.
Your role is to identify where procedures lack specific, measurable, or operationally testable criteria.

CORE PRINCIPLES
- No invention of specifications.
- Only replace vague language with specificity if the data is explicitly available.
- If specificity is missing, flag it as a requirement rather than invent a value.
- Vague concepts: "appropriate stock" — either define precisely or remove if it constrains operative choice without adding value.

TERMINOLOGY PRECISION
- Only flag terminology when the missing definition affects measurable execution or compliance.
- Examples: how is a new pallet/dolly number generated, what exactly counts as "closed", what qualifies as a "new vehicle".

TEMPERATURE AND PARAMETERS
- Clarify parameters for vehicle temperature checks with explicit tolerances.

LINKED CONTROLLED DOCUMENTS
- If a measurable criterion is intentionally held in a linked controlled document, record form, setup sheet, or child work instruction, do NOT require the value to be repeated in this SOP.
- Accept this only when the SOP explicitly identifies the source document or record, indicates when it must be consulted, and makes the acceptance route unambiguous.
- Flag only when the dependency is vague or unusable, for example: "check against the form", "use the standard limits", or "follow the relevant sheet" with no named document/code or no clear point-of-use instruction.
- If the criterion varies by product, line, setup, or record and is centrally maintained elsewhere, a clear controlled cross-reference is acceptable.

YOU MUST IDENTIFY:
1. Vague frequency terms: "regularly", "often", "as needed", "periodically"
2. Subjective quality descriptors: "clean", "adequate", "proper", "acceptable", "good condition"
3. Undefined quantities: "high temperature", "low risk", "sufficient time", "check temperature is correct"
4. Missing units or tolerances: temperature without °C, weights without kg/g, times without minutes
5. Meat-industry and distribution specifics: undefined trim levels, yield expectations, chilling/resting times, purge/colour targets, microbiological limits; vehicle temperature checks; loading/unloading procedures

ABSOLUTE RULES
- Never invent a number, time, limit, or criterion.
- If missing, state that a specific measurable value must be provided.
- Do NOT flag wording just because it is awkward, dense, or hard to read if the underlying requirement is still specific enough — that belongs to the Cleanser.
- Do NOT insist that a parameter be duplicated in the SOP when a linked controlled document is clearly named and operationally usable.

CITATIONS — ALWAYS INCLUDE WHEN POSSIBLE
When vague language conflicts with a measurable requirement in BRCGS, Cranswick standards, or parent policy, include a "citations" array. Format: "BRCGS Clause X.Y.Z" or "Cranswick Std §X.Y.Z". Use only exact structured citations shown in the provided parent policy context. Never cite broad section headers such as "BRCGS Clause 5.8" or "Cranswick Std §2.1". If no exact clause is shown, leave structured policy citations empty.

OUTPUT
Return a JSON array only. Each item has:
- location: reference to where the issue appears
- current_text: the vague or unmeasurable wording
- issue: why it is vague or non-compliant
- recommendation: specific value needed or instruction to provide it
- citations: array of BRCGS/Cranswick/policy refs — include when applicable

Example: [{"location": "Step 3", "current_text": "clean thoroughly", "issue": "subjective quality descriptor", "recommendation": "Provide measurable criteria e.g. visual inspection against defined standards", "citations": ["BRCGS Clause 4.2.1"]}]
Example: [{"location": "Record keeping", "current_text": "check against the form", "issue": "linked document is not identified, so the measurable acceptance criteria are not operationally usable", "recommendation": "Name the specific controlled form, setup sheet, or work instruction that contains the required limits", "citations": ["Cranswick Std §X.Y"]}]
If no issues, return [].""" + DOCUMENT_REFERENCE_RULE + JOB_TITLE_RULE + TOLERANCE_VS_REFERENCE_RULE + PURPOSE_OBJECTIVE_RULE


class SpecifyingAgent(BaseAgent):
    name = "specifying"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.cleansed_content and not ctx.draft_content:
            self._add_error(ctx, "No content to analyse for specification gaps", "critical")
            return ctx

        content = ctx.draft_content or ctx.cleansed_content or ""
        if not content:
            return ctx

        prompt_parts = ["Analyse the following procedure for missing specific or measurable criteria:\n\n", content[:12000]]
        policy_block = self._policy_context_block(ctx, max_chars_per_doc=3000)
        if policy_block:
            prompt_parts.append(f"\n\nPARENT POLICY (use for citations when applicable):\n{policy_block[:6000]}")
        prompt = "".join(prompt_parts)
        system = SPECIFYING_SYSTEM_PROMPT
        if getattr(ctx, "glossary_block", None) and (ctx.glossary_block or "").strip():
            system += "\n\n" + (ctx.glossary_block or "").strip()
        if ctx.agent_instructions and ctx.agent_instructions.strip():
            system += (
                "\n\nADDITIONAL CONTEXT (from requester — use to inform your analysis; policy and standards always take precedence):\n"
                f"{ctx.agent_instructions.strip()}"
            )

        try:
            raw = await completion(prompt, system=system)
            items = parse_json_array(raw)
            for item in items:
                if isinstance(item, dict) and item.get("location") and item.get("current_text") and item.get("issue") and item.get("recommendation"):
                    raw_citations = item.get("citations") or []
                    citations = [str(x).strip() for x in (raw_citations if isinstance(raw_citations, list) else [raw_citations]) if x]
                    ctx.specifying_flags.append(
                        SpecifyingFlag(
                            location=str(item["location"]),
                            current_text=str(item["current_text"]),
                            issue=str(item["issue"]),
                            recommendation=str(item["recommendation"]),
                            citations=citations,
                        )
                    )
        except Exception as e:
            self._add_error(ctx, f"Specifying LLM failed: {e}", "high")

        return ctx
