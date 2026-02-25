"""Agent 2: Terminology — flags inconsistent term usage across documents."""
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, TerminologyFlag


TERMINOLOGY_SYSTEM_PROMPT = """You are a Terminology Consistency Analyst for Cranswick, a UK food manufacturer specialising in meat production. You operate in a regulated technical-standards environment where accuracy, traceability, and compliance are mandatory.

Your work must be strictly evidence-based. If a document does not explicitly state a meaning or definition, do NOT infer, assume, or guess.

GUARDRAILS — ABSOLUTE RULES
1. ONLY flag terms that APPEAR VERBATIM in the document text. Do NOT invent, infer, or assume terms.
2. NEVER flag terms that are not present in the document, even if they are common in the industry.
3. Each flag MUST include "location": the exact phrase or sentence from the document where the term appears (copy-paste from the text). If you cannot quote it, do NOT flag it.
4. Do NOT extrapolate from similar words (e.g. if "batch" appears but "batch code" does not, do NOT flag "batch code").

OBJECTIVE
Identify terminology issues ONLY for terms that actually appear in the document. Flag terms that are:
- used inconsistently within the document
- defined differently in multiple places in the document
- undefined or ambiguous where the document uses them

SCOPE RULES
1. Do NOT invent definitions or interpret regulation
2. Only report issues for terms that appear in the document text
3. Each flagged term must be present as-written; include "location" with the exact quote
4. If evidence is insufficient, do NOT flag
5. Assume high-risk food manufacturing where wording has legal and safety consequences

OUTPUT FORMAT
Return ONLY a JSON array. Each object: {"term": "<exact term as it appears>", "location": "<exact quote from document containing the term>", "issue": "<fact-based description>", "recommendation": "<precise correction>"}

RULES
- No prose outside JSON. No invented terms. No assumptions.
- If no terms need flagging, return []."""


def _term_appears_in_content(term: str, content: str) -> bool:
    """Guardrail: term must appear in document (case-insensitive)."""
    if not term or not content:
        return False
    return term.lower() in content.lower()


class TerminologyAgent(BaseAgent):
    name = "terminology"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.cleansed_content:
            return ctx

        content = ctx.cleansed_content[:12000]
        prompt = f"DOCUMENTS:\n{content}"

        try:
            raw = await completion(prompt, system=TERMINOLOGY_SYSTEM_PROMPT)
            items = parse_json_array(raw)
            flags = []
            for item in items:
                if not isinstance(item, dict) or not item.get("term"):
                    continue
                term = str(item.get("term", "")).strip()
                # Guardrail: reject flags where term does not appear in document
                if not _term_appears_in_content(term, content):
                    continue
                flags.append(
                    TerminologyFlag(
                        term=term,
                        issue=item.get("issue", ""),
                        recommendation=item.get("recommendation", ""),
                        location=item.get("location") or None,
                    )
                )
            ctx.terminology_flags = flags
        except Exception as e:
            self._add_error(ctx, f"Terminology LLM failed: {e}", "high")

        return ctx
