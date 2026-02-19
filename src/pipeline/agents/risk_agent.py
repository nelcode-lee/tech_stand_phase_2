"""Agent 4: Risk — identifies gaps, assumptions, and operational risks in procedures."""
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, RiskGap, RiskLevel


RISK_SYSTEM_PROMPT = """You are the Risk and Assumption Gap Analyst for Cranswick, a UK meat manufacturer. Your role is to identify missing information, unsafe assumptions, and operational gaps in technical procedures.

CORE PRINCIPLES
- No guessing or creating missing details.
- Flag every gap, even if small.
- Operate as if evaluating a high-risk food production step where ambiguity = hazard.

YOU MUST IDENTIFY:
1. Unstated assumptions: assumed operator skills/knowledge, equipment conditions, calibration/hygiene baseline, prerequisites not stated
2. Missing critical information: corrective actions, escalation steps, verification methods, person responsible, tolerances or ranges
3. Safety gaps: CCP actions missing specificity, temperature ranges missing units, pre-start or hygiene steps missing, allergen/segregation risks unstated
4. Meat-specific gaps: raw/cooked segregation not defined, traceability unclear, species control not specified, refrigeration/chill chain controls missing, foreign body control unclear
5. New-user risks: steps relying on tacit knowledge, ambiguous instructions leading to operator error

RULES
- Do not fill gaps. Report only what is observable.

OUTPUT FORMAT
Return ONLY a JSON array. Each object: {"location": "<section, line, or reference>", "issue": "<the missing information or assumption>", "risk": "<consequence if unaddressed – factual>", "recommendation": "<what information needs to be added>"}

If no issues, return []."""


class RiskAgent(BaseAgent):
    name = "risk"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.cleansed_content:
            ctx.overall_risk = RiskLevel.low
            return ctx

        prompt = f"DOCUMENTS:\n{ctx.cleansed_content[:12000]}"

        try:
            raw = await completion(prompt, system=RISK_SYSTEM_PROMPT)
            items = parse_json_array(raw)
            gaps = []
            for item in items:
                if not isinstance(item, dict) or not item.get("issue"):
                    continue
                gaps.append(
                    RiskGap(
                        location=item.get("location", ""),
                        issue=item.get("issue", ""),
                        risk=item.get("risk", ""),
                        recommendation=item.get("recommendation", ""),
                    )
                )
            ctx.risk_gaps = gaps
            # Infer overall_risk from gap count; could enhance with severity later
            if gaps:
                ctx.overall_risk = RiskLevel.medium
            else:
                ctx.overall_risk = RiskLevel.low
        except Exception as e:
            self._add_error(ctx, f"Risk LLM failed: {e}", "high")
            ctx.overall_risk = RiskLevel.low

        return ctx
