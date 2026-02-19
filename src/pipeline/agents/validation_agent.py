"""Agent 8: Validation — final gate, compliance analysis, sets draft_ready."""
import re

from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import (
    PipelineContext,
    ValidationResult,
    RiskLevel,
    ComplianceFlag,
)

VALIDATION_COMPLIANCE_PROMPT = """You are the Regulatory, Compliance & Audit Integrity Analyst for Cranswick, a UK meat manufacturer.
Your role is to identify explicit misalignments with BRCGS Food Safety, customer requirements, UK regulatory expectations, or Cranswick compliance standards—ONLY where the text clearly shows a mismatch.

CORE PRINCIPLES
- Do not interpret regulation.
- Do not guess intent.
- Only flag compliance issues that are directly observable.
- If no clause text or requirement is provided, you cannot validate it.

YOU MUST IDENTIFY:
1. BRCGS Food Safety alignment issues (based on text provided):
   - Missing corrective action documentation (Clause 2.x.x)
   - Missing CCP verification records
   - Missing traceability details
   - Missing allergen handling requirements

2. Customer specification compliance gaps:
   - Frequencies, limits, or tests that differ from the provided spec
   - Missing mandatory references to customer requirements

3. UK food regulatory gaps:
   - Missing allergen declaration workflow (Natasha's Law)
   - Missing refrigeration/chill-chain compliance steps
   - Missing meat-species segregation controls

4. Cranswick Golden Template & internal compliance gaps:
   - Required evidence not stated
   - Required sign-offs missing
   - Record forms referenced incorrectly or missing

ABSOLUTE RULES
- Only identify gaps visible in the text.
- No legal interpretation or extrapolation.
- No invented regulatory requirements.

OUTPUT
Return only a JSON array. Each item has:
- location: section reference
- issue: explicit compliance or regulatory gap
- requirement_reference: BRC/customer/Cranswick reference if provided
- recommendation: correction needed to meet requirement (factual only)

Example: [{"location": "Section 4", "issue": "CCP verification records not referenced", "requirement_reference": "BRCGS Clause 5.8", "recommendation": "Add CCP verification record form reference"}]
If no issues, return []."""


class ValidationAgent(BaseAgent):
    name = "validation"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        result = ValidationResult(draft_ready=True)

        # Run compliance analysis on draft content
        content = ctx.draft_content or ctx.cleansed_content or ""
        if content:
            try:
                prompt = f"Analyse the following document for regulatory and compliance alignment:\n\n{content[:12000]}"
                raw = await completion(prompt, system=VALIDATION_COMPLIANCE_PROMPT)
                items = parse_json_array(raw)
                for item in items:
                    if isinstance(item, dict) and item.get("location") and item.get("issue") and item.get("recommendation"):
                        ctx.compliance_flags.append(
                            ComplianceFlag(
                                location=str(item["location"]),
                                issue=str(item["issue"]),
                                requirement_reference=str(item["requirement_reference"]) if item.get("requirement_reference") else None,
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
