"""Agent 2: Terminology — flags inconsistent term usage across documents."""
from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.domain import get_glossary_block, load_domain_context
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, TerminologyFlag


TERMINOLOGY_SYSTEM_PROMPT = """You are a Terminology Consistency Analyst for Cranswick, a UK food manufacturer. You operate in a regulated technical-standards environment where accuracy, traceability, and compliance are mandatory.

Your work must be strictly evidence-based. If a document does not explicitly state a meaning or definition, do NOT infer, assume, or guess.

STANDARDISATION TARGETS
- Pallet vs dolly: use "dolly" unless product is genuinely shipped on pallets.

TERMS TO STANDARDISE (flag when used inconsistently):
- Dollies (vs pallet, dolav, rack — recommend "logistic unit" or define in glossary)
- Load sheet / manifest (are these synonymous?)
- Trailer vs vehicle (use consistently)
- SSCC label (Serial Shipping Container Code)
- TEL (Tray End Label)
- Pallet sheet / dolly sheet
- Stock rotation
- Load documents (clarify: are these synonymous with manifest?)

GLOSSARY CANDIDATES
Flag undefined or ambiguous terms for glossary addition: SSCC, dolly, load sheet, manifest, pallet sheet, dolly sheet, stock rotation. Set glossary_candidate: true for these.

GUARDRAILS — ABSOLUTE RULES
1. ONLY flag terms that APPEAR VERBATIM in the document text. Do NOT invent, infer, or assume terms.
2. NEVER flag terms that are not present in the document, even if they are common in the industry.
3. Each flag MUST include "location": the exact phrase or sentence from the document where the term appears (copy-paste from the text). If you cannot quote it, do NOT flag it.
4. Do NOT extrapolate from similar words.

OBJECTIVE
Identify terminology issues ONLY for terms that actually appear in the document. Flag terms that are:
- used inconsistently within the document
- defined differently in multiple places
- undefined or ambiguous (these will be routed to HITL for glossary addition)

CITATIONS — ALWAYS INCLUDE WHEN POSSIBLE
When a terminology issue relates to BRCGS, Cranswick standards, or glossary definitions, include a "citations" array. Format: "BRCGS Clause X.Y.Z" or "Cranswick Std §X.Y.Z". Use only exact structured citations shown in the provided parent policy context. Never cite broad section headers such as "BRCGS Clause 5.8" or "Cranswick Std §2.1". If no exact clause is shown, leave structured policy citations empty.

OUTPUT FORMAT
Return ONLY a JSON array. Each object: {"term": "<exact term as it appears>", "location": "<exact quote from document containing the term>", "issue": "<fact-based description>", "recommendation": "<precise correction>", "glossary_candidate": true/false, "citations": ["<BRCGS/Cranswick ref>"]}

RULES
- No prose outside JSON. No invented terms. No assumptions.
- If no terms need flagging, return [].""" + DOCUMENT_REFERENCE_RULE


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
        prompt_parts = [f"DOCUMENTS:\n{content}"]
        policy_block = self._policy_context_block(ctx, max_chars_per_doc=3000)
        if policy_block:
            prompt_parts.append(f"\n\nPARENT POLICY (use for citations when applicable):\n{policy_block[:6000]}")
        prompt = "".join(prompt_parts)

        glossary = (getattr(ctx, "glossary_block", None) or "").strip() or get_glossary_block(load_domain_context())
        system_prompt = f"{TERMINOLOGY_SYSTEM_PROMPT}\n\n{glossary}" if glossary else TERMINOLOGY_SYSTEM_PROMPT

        try:
            raw = await completion(prompt, system=system_prompt)
            items = parse_json_array(raw)
            flags = []
            for item in items:
                if not isinstance(item, dict) or not item.get("term"):
                    continue
                term = str(item.get("term", "")).strip()
                # Guardrail: reject flags where term does not appear in document
                if not _term_appears_in_content(term, content):
                    continue
                glossary_candidate = bool(item.get("glossary_candidate"))
                # Infer glossary candidate from issue text if LLM did not set it
                if not glossary_candidate and item.get("issue"):
                    issue_lower = str(item.get("issue", "")).lower()
                    vague_keywords = ("undefined", "not defined", "vague", "ambiguous", "unclear", "not explained")
                    glossary_candidate = any(kw in issue_lower for kw in vague_keywords)
                raw_citations = item.get("citations") or []
                citations = [str(x).strip() for x in (raw_citations if isinstance(raw_citations, list) else [raw_citations]) if x]
                flags.append(
                    TerminologyFlag(
                        term=term,
                        issue=item.get("issue", ""),
                        recommendation=item.get("recommendation", ""),
                        location=item.get("location") or None,
                        glossary_candidate=glossary_candidate,
                        citations=citations,
                    )
                )
            ctx.terminology_flags = flags
        except Exception as e:
            self._add_error(ctx, f"Terminology LLM failed: {e}", "high")

        return ctx
