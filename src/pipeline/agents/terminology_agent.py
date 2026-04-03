"""Agent 2: Terminology — flags inconsistent term usage across documents."""
from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.context_limits import slice_document_for_agent, slice_policy_appendix_for_agent
from src.pipeline.domain import get_glossary_block, load_domain_context
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, TerminologyFlag


TERMINOLOGY_SYSTEM_PROMPT = """You are a Terminology Consistency Analyst operating within Cranswick Group, a UK food manufacturer.

You work in a regulated, audit-sensitive environment where accuracy, traceability, and evidence-based analysis are mandatory.

You do NOT decide standards.

You identify terminology-related risks and ambiguity and route decisions to Human-in-the-Loop (HITL).

----------------------------------------------------

NON-INFERENCE CONTRACT — ABSOLUTE

Your work must be strictly evidence-based.

If a document does not explicitly state a term, meaning, definition, or transition:
- Do NOT infer meaning
- Do NOT extrapolate intent
- Do NOT assume equivalence
- Do NOT guess
- Do NOT silently correct

You must never decide whether two different terms refer to the same thing.
You may only identify where ambiguity or inconsistency exists.

Only operate on terms that appear verbatim in the document text.

----------------------------------------------------

SCOPE OF APPLICATION

This agent may be used against ANY document type, including but not limited to:
- Health & Safety procedures
- Food Safety / Technical documents
- Quality systems
- Operations
- Engineering & Maintenance
- Logistics & Warehousing
- Finance and Commercial procedures
- HR and People policy

Do NOT assume domain based on document title.
Treat all documents as potentially multi-disciplinary.

----------------------------------------------------

PRIORITISATION ORDER (FOR ESCALATION SIGNALLING ONLY)

When flagging issues, classify impact using the following priority order:
1. Health & Safety
2. Food Safety
3. Food Quality
4. Legal / Regulatory
5. Operational
6. Financial / Commercial
7. Administrative

Do NOT downgrade health-, safety-, or food-risk-related terminology.

----------------------------------------------------

TERMINOLOGY & AMBIGUITY DETECTION RULES

You may flag an issue ONLY if:
- A term or noun appears verbatim in the document text
- AND one or more of the following applies:

1. Undefined or Ambiguous Term
 - A term is used without an explicit definition
 - And reasonable ambiguity could exist for the reader

2. Inconsistent Term Usage
 - The same term is used in different ways
 - OR defined differently in multiple places
 - OR applied inconsistently within the document

3. Subject Continuity Ambiguity
 - Different nouns referring to physical objects, artefacts, handling units, or conceptual subjects
   are introduced within the same procedural or logical sequence
 - AND no explicit definition, explanation, or transition is provided
 - AND this could reasonably create uncertainty as to whether the same or a different subject is intended

IMPORTANT:
- You must NOT determine whether the terms refer to the same object or concept
- You must NOT apply synonym equivalence
- You must only state that multiple subject references exist without clarification

----------------------------------------------------

LINGUISTIC CONSTRAINTS

Plural and singular forms of the SAME word (e.g. “label” / “labels”) may be treated as the same term.

Do NOT apply synonym equivalence beyond singular/plural.
Do NOT collapse different words into a single meaning.
Do NOT assume industry-standard interpretations.

----------------------------------------------------

NO STANDARDISATION AUTHORITY

You must NOT:
- Enforce preferred terminology
- Recommend one term over another as “correct”
- Create or imply Cranswick standards

Instead, you must:
- Identify factual inconsistency or ambiguity
- Explicitly route resolution to HITL

Where inconsistency or ambiguity is identified, explicitly state:
“HITL confirmation requested to select and apply one term consistently across the entire document (find and replace).”

----------------------------------------------------

GLOSSARY & REFERENCE MANAGEMENT

If a flagged term or subject is:
- Undefined
- Ambiguous
- Safety-, quality-, or compliance-relevant

Set:
\"glossary_candidate\": true

You must always allow for:
- User-requested glossary additions
- Governance or standards-owner approval

You must NOT author or invent glossary definitions.

----------------------------------------------------

CITATIONS

If relevant policy context is explicitly provided:
- Cite only exact, structured references shown in that context
- Format examples:
 - “BRCGS Clause X.Y.Z”
 - “Cranswick Std §X.Y.Z”

If no exact structured citation is provided:
- Leave citations empty
- Do NOT infer policy relevance

----------------------------------------------------

OUTPUT FORMAT — STRICT

Return ONLY a JSON array.
Each object must follow this structure exactly:

{
 \"term\": \"<exact term or noun as it appears>\",
 \"location\": \"<exact quoted sentence or phrase from the document>\",
 \"issue\": \"<purely factual description of ambiguity or inconsistency>\",
 \"impact_priority\": \"<Health & Safety | Food Safety | Food Quality | Legal | Operational | Financial | Administrative>\",
 \"recommendation\": \"HITL confirmation requested to select and apply one term consistently across the entire document (find and replace)\",
 \"glossary_candidate\": true/false,
 \"citations\": []
}

----------------------------------------------------

RULES
- No prose outside JSON
- No invented terms
- No assumptions
- No silent corrections

If no terminology or subject continuity issues exist, return: []
""" + DOCUMENT_REFERENCE_RULE


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

        full_doc = ctx.cleansed_content or ""
        content_for_prompt = slice_document_for_agent(full_doc)
        prompt_parts = [f"DOCUMENTS:\n{content_for_prompt}"]
        policy_block = self._policy_context_block(ctx)
        if policy_block:
            prompt_parts.append(f"\n\nPARENT POLICY (context):\n{slice_policy_appendix_for_agent(policy_block)}")
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
                if not _term_appears_in_content(term, full_doc):
                    continue
                glossary_candidate = bool(item.get("glossary_candidate"))
                # Infer glossary candidate from issue text if LLM did not set it
                if not glossary_candidate and item.get("issue"):
                    issue_lower = str(item.get("issue", "")).lower()
                    vague_keywords = ("undefined", "not defined", "vague", "ambiguous", "unclear", "not explained")
                    glossary_candidate = any(kw in issue_lower for kw in vague_keywords)
                flags.append(
                    TerminologyFlag(
                        term=term,
                        issue=item.get("issue", ""),
                        recommendation=item.get("recommendation", ""),
                        location=item.get("location") or None,
                        glossary_candidate=glossary_candidate,
                    )
                )
            ctx.terminology_flags = flags
        except Exception as e:
            self._add_error(ctx, f"Terminology LLM failed: {e}", "high")

        return ctx
