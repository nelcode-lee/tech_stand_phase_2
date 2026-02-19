"""Agent 3: Conflict detection — identifies contradictions between documents."""
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, Conflict


CONFLICT_SYSTEM_PROMPT = """You are the Conflict Detection Analyst for Cranswick, a UK meat producer. Your job is to identify contradictions within and between documents. Operate with zero speculation and no interpretation beyond what is explicitly written.

CORE PRINCIPLES
- Find factual contradictions only. Do not infer meaning or intent.
- Conflicts must be observable in the text.
- Assume a regulated food safety environment.

IDENTIFY:
1. Internal contradictions: conflicting steps, frequencies (e.g. hourly vs every 30 min), limits (temps, weights, times), responsibilities
2. Cross-document contradictions: procedure conflicts, terminology differences, definitions differ, CCP/OPRP designations differ
3. Compliance contradictions: statements conflicting with BRC clauses, customer specs, Golden Template
4. Meat manufacturing: species segregation, temperature control, hygiene vs sanitation, CCP decision tree conflicts

RULES
- No guesses. No "probable" or "likely" language.
- If variance_type = sanctioned_variance, classify as SANCTIONED_VARIANCE, not a conflict.
- blocks_draft: true only for critical UNSANCTIONED_CONFLICT.

OUTPUT FORMAT
Return ONLY a JSON array. Each object: {"conflict_type": "UNSANCTIONED_CONFLICT|SANCTIONED_VARIANCE|PENDING_REVIEW|PARENT_BREACH", "severity": "info|low|medium|high|critical", "layer": "<doc layer>", "sites": [], "document_refs": [], "description": "<explicit contradiction>", "recommendation": "<required alignment>", "blocks_draft": false}

If none found, return []."""


class ConflictAgent(BaseAgent):
    name = "conflict"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.cleansed_content:
            return ctx

        parent_text = ctx.parent_policy.content if ctx.parent_policy else "(No parent policy provided)"
        prompt = f"DOCUMENTS:\n{ctx.cleansed_content[:12000]}\n\nPARENT POLICY:\n{parent_text[:4000]}"

        try:
            raw = await completion(prompt, system=CONFLICT_SYSTEM_PROMPT)
            items = parse_json_array(raw, max_items=20)
            if len(items) > 20:
                ctx.warnings.append("Conflict count truncated to 20")

            conflicts = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                desc = item.get("description") or item.get("issue", "")
                if not desc:
                    continue
                conflicts.append(
                    Conflict(
                        conflict_type=item.get("conflict_type", "PENDING_REVIEW"),
                        severity=item.get("severity", "medium"),
                        layer=item.get("layer", ctx.doc_layer.value),
                        sites=item.get("sites", ctx.sites),
                        document_refs=item.get("document_refs", []),
                        description=desc,
                        recommendation=item.get("recommendation", ""),
                        blocks_draft=bool(item.get("blocks_draft")),
                    )
                )
            ctx.conflicts = conflicts
            ctx.conflict_count = len(conflicts)
            ctx.blocker_count = len([c for c in conflicts if c.blocks_draft])
        except Exception as e:
            self._add_error(ctx, f"Conflict LLM failed: {e}", "high")

        return ctx
