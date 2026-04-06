"""Pipeline router: selects agents and runs the pipeline."""
import asyncio
import os
import time
from collections.abc import Awaitable, Callable

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

# Sequential by default for clearer progress/trust in review workflows.
# Set PIPELINE_PARALLEL_SPECIALISTS=true to re-enable parallel specialist wave.
ENABLE_PARALLEL_SPECIALISTS = os.environ.get("PIPELINE_PARALLEL_SPECIALISTS", "false").strip().lower() in (
    "1",
    "true",
    "yes",
)

# Stable order for progress UI when emitting parallel specialist agents (matches typical pipeline order)
_PARALLEL_PROGRESS_ORDER = {
    "conflict": 0,
    "specifying": 1,
    "sequencing": 2,
    "terminology": 3,
    "formatting": 4,
}

ProgressCallback = Callable[[str], Awaitable[None]]

# List fields each agent in PARALLEL_GROUP may append to (same baseline ctx; merge after gather).
_PARALLEL_MERGE_FIELDS = (
    "terminology_flags",
    "conflicts",
    "specifying_flags",
    "sequencing_flags",
    "formatting_flags",
)


def _merge_parallel_agent_results(results: list[PipelineContext]) -> PipelineContext:
    """
    Parallel agents each run from the same pre-wave ctx and return separate copies with only
    their own outputs filled. Without merging, keeping only results[0] drops every other
    specialist's findings (e.g. terminology, specifying) and breaks risk/validation.
    """
    if not results:
        raise ValueError("merge_parallel_agent_results: empty results")
    if len(results) == 1:
        return results[0]
    merged = results[0].model_copy(deep=True)
    for res in results[1:]:
        for fname in _PARALLEL_MERGE_FIELDS:
            left = list(getattr(merged, fname) or [])
            left.extend(getattr(res, fname) or [])
            setattr(merged, fname, left)
        merged.errors = list(merged.errors) + list(res.errors or [])
    return merged


class PipelineRouter:
    def __init__(self, agents_override: list[str] | None = None):
        self.agents_override = agents_override

    async def run(
        self,
        ctx: PipelineContext,
        progress_callback: ProgressCallback | None = None,
    ) -> PipelineContext:
        agents = self._select_agents(ctx)

        async def emit(agent_name: str) -> None:
            if progress_callback:
                await progress_callback(agent_name)

        i = 0
        while i < len(agents):
            agent = agents[i]
            await emit(agent.name)
            # Run a single agent
            started = time.perf_counter()
            ctx = await agent.run(ctx)
            duration_ms = int((time.perf_counter() - started) * 1000)
            ctx.agents_run.append(agent.name)
            ctx.agent_timings.append({"agent": agent.name, "duration_ms": duration_ms})
            blockers = [e for e in ctx.errors if e.severity == "critical"]
            if blockers:
                break
            i += 1
            # If enabled, run eligible specialist agents in parallel.
            wave = []
            while ENABLE_PARALLEL_SPECIALISTS and i < len(agents) and agents[i].name in PARALLEL_GROUP:
                wave.append(agents[i])
                i += 1
            if wave:
                wave_sorted = sorted(
                    wave,
                    key=lambda a: _PARALLEL_PROGRESS_ORDER.get(a.name, 99),
                )
                for a in wave_sorted:
                    await emit(a.name)
                async def run_with_timing(a: BaseAgent) -> tuple[BaseAgent, PipelineContext, int]:
                    started = time.perf_counter()
                    out = await a.run(ctx)
                    duration_ms = int((time.perf_counter() - started) * 1000)
                    return a, out, duration_ms

                timed_results = await asyncio.gather(*[run_with_timing(a) for a in wave])
                results = [res for _, res, _ in timed_results]
                for a in wave:
                    ctx.agents_run.append(a.name)
                for a, _, duration_ms in timed_results:
                    ctx.agent_timings.append({"agent": a.name, "duration_ms": duration_ms})
                ctx = _merge_parallel_agent_results(results)
                blockers = [e for e in ctx.errors if e.severity == "critical"]
                if blockers:
                    break
        # Continue with risk, then validation (sequential)
        while i < len(agents):
            agent = agents[i]
            await emit(agent.name)
            started = time.perf_counter()
            ctx = await agent.run(ctx)
            duration_ms = int((time.perf_counter() - started) * 1000)
            ctx.agents_run.append(agent.name)
            ctx.agent_timings.append({"agent": agent.name, "duration_ms": duration_ms})
            blockers = [e for e in ctx.errors if e.severity == "critical"]
            if blockers:
                break
            i += 1
        ctx = self._build_summary(ctx)
        return ctx

    async def run_step_at(
        self,
        ctx: PipelineContext,
        step_index: int,
        progress_callback: ProgressCallback | None = None,
    ) -> PipelineContext:
        """
        Run exactly one agent by index in the pipeline order (sequential list from _select_agents).
        Used for stepped / HITL flows. Does not run the parallel specialist wave.
        On the last agent, applies _build_summary.
        """
        agents = self._select_agents(ctx)
        if step_index < 0 or step_index >= len(agents):
            raise ValueError(
                f"step_index {step_index} out of range; pipeline has {len(agents)} agent step(s)"
            )
        agent = agents[step_index]
        if progress_callback:
            await progress_callback(agent.name)
        started = time.perf_counter()
        ctx = await agent.run(ctx)
        duration_ms = int((time.perf_counter() - started) * 1000)
        ctx.agents_run.append(agent.name)
        ctx.agent_timings.append({"agent": agent.name, "duration_ms": duration_ms})
        blockers = [e for e in ctx.errors if e.severity == "critical"]
        if blockers:
            return ctx
        if step_index == len(agents) - 1:
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
