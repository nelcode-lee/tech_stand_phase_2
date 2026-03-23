"""Base agent interface. All agents extend this."""
from abc import ABC, abstractmethod

from src.pipeline.context_limits import max_policy_context_per_doc_chars
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

    def _policy_documents(self, ctx: PipelineContext):
        docs = []
        if getattr(ctx, "parent_policy", None):
            docs.append(ctx.parent_policy)
        docs.extend(getattr(ctx, "higher_order_policies", None) or [])
        return docs

    def _policy_context_block(self, ctx: PipelineContext, *, max_chars_per_doc: int | None = None) -> str:
        docs = self._policy_documents(ctx)
        if not docs:
            return ""
        cap = max_chars_per_doc if max_chars_per_doc is not None else max_policy_context_per_doc_chars()
        blocks = []
        for i, doc in enumerate(docs):
            label = "DIRECT PARENT POLICY" if i == 0 else f"HIGHER-ORDER POLICY {i}"
            body = (doc.content or "").strip()
            if len(body) > cap:
                body = body[:cap]
            blocks.append(
                f"{label} - {doc.title} (cite as 'parent policy [{doc.title}]' when the finding relates to this):\n"
                f"{body}"
            )
        return "\n\n".join(blocks)
