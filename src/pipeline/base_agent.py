"""Base agent interface. All agents extend this."""
from abc import ABC, abstractmethod

from src.pipeline.models import PipelineContext, PipelineError


class BaseAgent(ABC):
    name: str = ""

    @abstractmethod
    async def run(self, ctx: PipelineContext) -> PipelineContext:
        """
        Receives context, performs analysis, enriches context, returns it.
        Never raises — append to ctx.errors instead.
        """
        pass

    def _add_error(self, ctx: PipelineContext, message: str, severity: str) -> None:
        ctx.errors.append(
            PipelineError(agent=self.name, message=message, severity=severity)
        )
