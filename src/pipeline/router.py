"""Pipeline router: selects agents and runs the pipeline."""
from src.pipeline.models import (
    PipelineContext,
    RequestType,
    DocLayer,
    RiskLevel,
)
from src.pipeline.base_agent import BaseAgent
from src.pipeline.agents import (
    CleansingAgent,
    TerminologyAgent,
    ConflictAgent,
    RiskAgent,
    SpecifyingAgent,
    SequencingAgent,
    FormattingAgent,
    ValidationAgent,
)

AGENTS = {
    "cleansing": CleansingAgent(),
    "terminology": TerminologyAgent(),
    "conflict": ConflictAgent(),
    "risk": RiskAgent(),
    "specifying": SpecifyingAgent(),
    "sequencing": SequencingAgent(),
    "formatting": FormattingAgent(),
    "validation": ValidationAgent(),
}


class PipelineRouter:
    def __init__(self, agents_override: list[str] | None = None):
        self.agents_override = agents_override

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        agents = self._select_agents(ctx)
        for agent in agents:
            ctx = await agent.run(ctx)
            ctx.agents_run.append(agent.name)
            blockers = [e for e in ctx.errors if e.severity == "critical"]
            if blockers:
                break
        ctx = self._build_summary(ctx)
        return ctx

    def _select_agents(self, ctx: PipelineContext) -> list[BaseAgent]:
        # Explicit agent list (Targeted mode or Quick Check)
        if self.agents_override:
            names = [n for n in self.agents_override if n in AGENTS]
            return [AGENTS[n] for n in names] if names else list(AGENTS.values())

        request_type = ctx.request_type
        doc_layer = ctx.doc_layer

        # Base set by request type
        if request_type in (RequestType.new_document, RequestType.update_existing, RequestType.single_document_review):
            # Full pipeline: all 8 agents
            names = [
                "cleansing", "terminology", "conflict", "risk",
                "specifying", "sequencing", "formatting", "validation",
            ]
        elif request_type == RequestType.harmonisation_review:
            # Alignment with existing policies: conflict, compliance, terminology
            names = ["cleansing", "terminology", "conflict", "risk", "validation"]
        elif request_type == RequestType.principle_layer_review:
            # Principle layer: capture enough of the What (intent, rationale, requirements)
            # Specifying + formatting; skip sequencing (not step logic)
            names = [
                "cleansing", "terminology", "conflict", "risk",
                "specifying", "formatting", "validation",
            ]
        else:  # contradiction_flag, review_request (legacy)
            names = ["cleansing", "terminology", "conflict", "risk", "validation"]

        # Skip Sequencing for policy/principle
        if doc_layer in (DocLayer.policy, DocLayer.principle) and "sequencing" in names:
            names.remove("sequencing")

        # Risk only if conflicts exist (we run conflict first, so check after)
        # Router selects upfront; risk agent no-ops if no conflicts
        # So we keep risk in the list

        return [AGENTS[n] for n in names if n in AGENTS]

    def _build_summary(self, ctx: PipelineContext) -> PipelineContext:
        ctx.conflict_count = len(ctx.conflicts)
        ctx.blocker_count = len([c for c in ctx.conflicts if c.blocks_draft])
        if ctx.risk_scores:
            bands = [r.band for r in ctx.risk_scores]
            if "critical" in bands:
                ctx.overall_risk = RiskLevel.critical
            elif "high" in bands:
                ctx.overall_risk = RiskLevel.high
            elif "medium" in bands:
                ctx.overall_risk = RiskLevel.medium
            else:
                ctx.overall_risk = RiskLevel.low
        return ctx
