"""Agent 6: Sequencing — flags logical flow and step-order issues in procedures."""
from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, DocLayer, SequencingFlag

SEQUENCING_SYSTEM_PROMPT = """You are the Logical Flow and Step Sequencing Analyst for Cranswick, a UK food manufacturer.
Your responsibility is to ensure that operational steps in technical procedures follow a logical, safe, and efficient order.

PRODUCT DISPATCH FLOW (reference for loading/despatch procedures)
Logical sequence: demand → picking → dolly building → wrapping → labelling → quality checks → loading → documentation.
Flag any deviation from this flow or steps that appear out of order.

VEHICLE CHECKS SEQUENCE
Correct order: (1) Vehicle condition & suitability and cleanliness, (2) Removal of debris if required, (3) Temperature validation, (4) Loading.
Labels and TELs should be checked at picking, not at loading.

CRITICAL CONTRADICTIONS TO FLAG
- Manifest signed before loading (driver should sign after loading; all three documents should be signed).
- Temperature checks only on the "last dolly" — this would require full unloading if out of specification. Recommend: "Ensure three dollies/pallets are checked before loading begins and record temperature."
- Complex steps that do not clearly explain intent — simplify and clarify.

SOP LINKAGES
- Flag missing links to related SOPs (e.g. load label creation process).

CORE PRINCIPLES
- No speculative additions.
- Do not generate new steps not grounded in the document.
- Identify sequencing issues only when they are explicitly evident.

YOU MUST IDENTIFY:
1. Logical order failures: steps requiring prerequisites not yet completed; actions before safety checks; CCP verification too late
2. Operational inefficiencies: repeated steps; steps belonging earlier/later; opportunities for parallel tasks only if explicitly supported
3. Meat-industry and distribution sequencing: raw/cooked segregation; hygiene order; chilling/temperature sequences; vehicle checks before loading
4. Internal contradictions: time/temperature/pre-start checks positioned incorrectly; manifest signature sequence; temperature check timing

ABSOLUTE RULES
- No guessing the correct sequence.
- Only flag issues that are demonstrably wrong based on the text.

CITATIONS — ALWAYS INCLUDE WHEN POSSIBLE
When a sequencing issue relates to BRCGS, Cranswick standards, or parent policy, include a "citations" array. Format: "BRCGS Clause X.Y.Z" or "Cranswick Std §X.Y.Z". Use only exact structured citations shown in the provided parent policy context. Never cite broad section headers such as "BRCGS Clause 5.8" or "Cranswick Std §2.1". If no exact clause is shown, leave structured policy citations empty.

OUTPUT
Return only a JSON array. Each item has:
- location: step or section reference
- excerpt: exact quote from document — the text that relates to this issue (copy-paste from source). Used to highlight the relevant passage.
- issue: specific sequencing or logic problem
- impact: risk or operational consequence (factual only)
- recommendation: required change while staying within document content
- citations: array of BRCGS/Cranswick/policy refs — include when applicable

Example: [{"location": "Step 5", "excerpt": "5. Pack product into boxes. 6. Record temperature.", "issue": "Temperature check occurs after product has been packed", "impact": "CCP verification too late", "recommendation": "Move temperature verification before packing step", "citations": []}]
If no issues, return [].""" + DOCUMENT_REFERENCE_RULE


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
            prompt_parts = ["Analyse the following procedure for sequencing and logical flow issues:\n\n", content[:12000]]
            policy_block = self._policy_context_block(ctx, max_chars_per_doc=3000)
            if policy_block:
                prompt_parts.append(f"\n\nPARENT POLICY (use for citations when applicable):\n{policy_block[:6000]}")
            prompt = "".join(prompt_parts)
            system = SEQUENCING_SYSTEM_PROMPT
            if getattr(ctx, "glossary_block", None) and (ctx.glossary_block or "").strip():
                system += "\n\n" + (ctx.glossary_block or "").strip()
            raw = await completion(prompt, system=system)
            items = parse_json_array(raw)
            for item in items:
                if isinstance(item, dict) and item.get("location") and item.get("issue") and item.get("impact") and item.get("recommendation"):
                    raw_citations = item.get("citations") or []
                    citations = [str(x).strip() for x in (raw_citations if isinstance(raw_citations, list) else [raw_citations]) if x]
                    excerpt = (item.get("excerpt") or "").strip() or None
                    ctx.sequencing_flags.append(
                        SequencingFlag(
                            location=str(item["location"]),
                            excerpt=excerpt,
                            issue=str(item["issue"]),
                            impact=str(item["impact"]),
                            recommendation=str(item["recommendation"]),
                            citations=citations,
                        )
                    )
        except Exception as e:
            self._add_error(ctx, f"Sequencing LLM failed: {e}", "high")

        return ctx
