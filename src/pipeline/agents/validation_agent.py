"""Agent 8: Validation — final gate, compliance analysis, sets draft_ready."""
import re

from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE, JOB_TITLE_RULE, TOLERANCE_VS_REFERENCE_RULE, PURPOSE_OBJECTIVE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.context_limits import slice_document_for_agent, slice_policy_appendix_for_agent
from src.pipeline.llm import completion, compliance_llm_temperature, parse_json_array
from src.pipeline.models import (
    PipelineContext,
    ValidationResult,
    RiskLevel,
    ComplianceFlag,
)

VALIDATION_COMPLIANCE_PROMPT = """You are the Regulatory, Compliance & Audit Integrity Analyst for Cranswick, a UK food manufacturer.
Your role is to identify explicit misalignments with BRCGS Food Safety, customer requirements, UK regulatory expectations, or Cranswick compliance standards—ONLY where the text clearly shows a mismatch.

CORE PRINCIPLES
- Do not interpret regulation.
- Do not guess intent.
- Only flag compliance issues that are directly observable.
- If no clause text or requirement is provided, you cannot validate it.
- Food safety: HACCP (Hazard Analysis and Critical Control Points) and CCP records are in scope when the text shows a gap vs BRCGS / regulatory expectation (aligned with Risk agent HACCP context and glossary).

BRC EXPECTATIONS (for loading/despatch procedures)
- Vehicle hygiene checks: vehicle "free from debris, glass, pests, signs of damp"
- Temperature monitoring: equipment must maintain temperature; site can only verify vehicle is at correct temperature at arrival
- Seal verification and documentation of checks (including record IDs)
- Food vs non-food segregation: reflect practical rules — empty dollies are permitted
- Load documents: must carry document control identifiers (version, date, reviewer)

YOU MUST IDENTIFY:
1. BRCGS Food Safety alignment: missing corrective action documentation, CCP verification records, traceability, allergen handling
2. Customer specification compliance: frequencies, limits, tests differing from spec; missing mandatory references
3. UK food regulatory gaps: allergen declaration (Natasha's Law), refrigeration/chill-chain, meat-species segregation
4. Cranswick Golden Template: required evidence not stated; sign-offs missing; record forms incorrect or missing
5. Document control: load documents without version, date, reviewer; vehicle seal tags without document control

ABSOLUTE RULES
- Only identify gaps visible in the text.
- No legal interpretation or extrapolation.
- No invented regulatory requirements.

OUTPUT
Return only a JSON array. Each item has:
- location: section reference
- excerpt: exact quote from document — the text that relates to this gap (copy-paste from source). Used to highlight the relevant passage.
- issue: explicit compliance or regulatory gap
- recommendation: correction needed to meet requirement (factual only)

Example: [{"location": "Section 4", "excerpt": "4. CCP verification: temperature recorded weekly.", "issue": "CCP verification records not referenced", "recommendation": "Add CCP verification record form reference"}]
If no issues, return [].""" + DOCUMENT_REFERENCE_RULE + JOB_TITLE_RULE + TOLERANCE_VS_REFERENCE_RULE + PURPOSE_OBJECTIVE_RULE


class ValidationAgent(BaseAgent):
    name = "validation"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        result = ValidationResult(draft_ready=True)

        # Compliance flags: prefer cleansed source text so harmonisation/sessions are stable vs draft/HITL edits.
        content = (ctx.cleansed_content or ctx.draft_content or "").strip()
        if content:
            try:
                doc_slice = slice_document_for_agent(content)
                prompt_parts = ["Analyse the following document for regulatory and compliance alignment:\n\n", doc_slice]
                policy_block = self._policy_context_block(ctx)
                if policy_block:
                    prompt_parts.append(f"\n\nPARENT POLICY (context):\n{slice_policy_appendix_for_agent(policy_block)}")
                prompt = "".join(prompt_parts)
                system = VALIDATION_COMPLIANCE_PROMPT
                if getattr(ctx, "glossary_block", None) and (ctx.glossary_block or "").strip():
                    system += "\n\n" + (ctx.glossary_block or "").strip()
                raw = await completion(prompt, system=system, temperature=compliance_llm_temperature())
                items = parse_json_array(raw)
                for item in items:
                    if isinstance(item, dict) and item.get("location") and item.get("issue") and item.get("recommendation"):
                        excerpt = (item.get("excerpt") or "").strip() or None
                        ctx.compliance_flags.append(
                            ComplianceFlag(
                                location=str(item["location"]),
                                excerpt=excerpt,
                                issue=str(item["issue"]),
                                recommendation=str(item["recommendation"]),
                            )
                        )
            except Exception as e:
                self._add_error(ctx, f"Validation compliance analysis failed: {e}", "high")

        # Count flags from agents
        result.specifying_flags_count = len(ctx.specifying_flags)
        result.sequencing_flags_count = len(ctx.sequencing_flags)

        # Count placeholders in draft
        if ctx.draft_content:
            result.placeholder_count = len(
                re.findall(r"\[TBC\]|\[PLACEHOLDER\]", ctx.draft_content, re.I)
            )

        # Vague terminology: route to HITL and surface for glossary addition (advisory, do not block)
        glossary_candidates = [t for t in ctx.terminology_flags if getattr(t, "glossary_candidate", False)]
        if glossary_candidates:
            terms_list = ", ".join(f'"{t.term}"' for t in glossary_candidates[:5])
            if len(glossary_candidates) > 5:
                terms_list += f" (+{len(glossary_candidates) - 5} more)"
            result.advisory_issues.append(
                f"Vague terminology detected — route to HITL and add to glossary: {terms_list}"
            )

        # Block on critical errors
        critical = [e for e in ctx.errors if e.severity == "critical"]
        unsanctioned = [
            c for c in ctx.conflicts
            if c.conflict_type == "UNSANCTIONED_CONFLICT"
            and c.severity in ("critical", "high")
        ]
        if critical:
            result.draft_ready = False
            result.blocking_issues.extend([e.message for e in critical])
        if unsanctioned:
            result.draft_ready = False
            result.blocking_issues.append(
                f"{len(unsanctioned)} unsanctioned conflict(s) require resolution"
            )
        if not ctx.policy_ref and ctx.doc_layer.value in ("principle", "sop", "work_instruction"):
            result.draft_ready = False
            result.parent_ref_valid = False
            result.blocking_issues.append("Missing parent policy reference")

        result.validation_summary = _build_summary(ctx, result)
        ctx.validation_result = result
        ctx.draft_ready = result.draft_ready
        return ctx


def _build_summary(ctx: PipelineContext, result: ValidationResult) -> str:
    if result.draft_ready:
        return "Draft passed validation and is ready for review."
    return (
        f"Draft has {len(result.blocking_issues)} blocking issue(s): "
        + "; ".join(result.blocking_issues[:3])
    )
