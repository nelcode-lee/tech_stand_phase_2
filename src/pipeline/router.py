"""Pipeline router: selects agents and runs the pipeline. Runs independent agents in parallel to reduce latency."""
import asyncio

from src.pipeline.models import (
    PipelineContext,
    RequestType,
    DocLayer,
    RiskLevel,
)
from src.pipeline.base_agent import BaseAgent
from src.pipeline.agents import (
    CleansingAgent,
    DraftLayoutAgent,
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
    "draft_layout": DraftLayoutAgent(),
    "terminology": TerminologyAgent(),
    "conflict": ConflictAgent(),
    "risk": RiskAgent(),
    "specifying": SpecifyingAgent(),
    "sequencing": SequencingAgent(),
    "formatting": FormattingAgent(),
    "validation": ValidationAgent(),
}

# Agents that can run in parallel after draft_layout (they only read cleansed/draft content; risk needs conflicts so runs after conflict)
PARALLEL_GROUP = {"terminology", "conflict", "specifying", "sequencing", "formatting"}
# Risk runs after conflict (uses ctx.conflicts); validation runs after all (uses other flags for summary)
RISK_AFTER = "conflict"
VALIDATION_LAST = "validation"


class PipelineRouter:
    def __init__(self, agents_override: list[str] | None = None):
        self.agents_override = agents_override

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        agents = self._select_agents(ctx)
        i = 0
        while i < len(agents):
            agent = agents[i]
            # Run a single agent
            ctx = await agent.run(ctx)
            ctx.agents_run.append(agent.name)
            blockers = [e for e in ctx.errors if e.severity == "critical"]
            if blockers:
                break
            i += 1
            # If next agents are in PARALLEL_GROUP, run them all in parallel
            wave = []
            while i < len(agents) and agents[i].name in PARALLEL_GROUP:
                wave.append(agents[i])
                i += 1
            if wave:
                results = await asyncio.gather(*[a.run(ctx) for a in wave])
                for a in wave:
                    ctx.agents_run.append(a.name)
                ctx = results[0]
                blockers = [e for e in ctx.errors if e.severity == "critical"]
                if blockers:
                    break
        # Continue with risk, then validation (sequential)
        while i < len(agents):
            agent = agents[i]
            ctx = await agent.run(ctx)
            ctx.agents_run.append(agent.name)
            blockers = [e for e in ctx.errors if e.severity == "critical"]
            if blockers:
                break
            i += 1
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
            # Full pipeline: cleansing → draft_layout → (terminology, conflict, specifying, sequencing, formatting in parallel) → risk → validation
            names = [
                "cleansing", "draft_layout",
                "terminology", "conflict", "specifying", "sequencing", "formatting",
                "risk", "validation",
            ]
        elif request_type == RequestType.harmonisation_review:
            names = ["cleansing", "draft_layout", "terminology", "conflict", "risk", "validation"]
        elif request_type == RequestType.principle_layer_review:
            names = [
                "cleansing", "draft_layout", "terminology", "conflict", "specifying", "formatting",
                "risk", "validation",
            ]
        else:  # contradiction_flag, review_request (legacy)
            names = ["cleansing", "draft_layout", "terminology", "conflict", "risk", "validation"]

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
