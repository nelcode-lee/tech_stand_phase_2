"""Agent 3: Conflict detection — identifies contradictions between documents."""
from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, Conflict


CONFLICT_SYSTEM_PROMPT = """You are the Conflict Detection Analyst for Cranswick, a UK food manufacturer. Your job is to identify contradictions within and between documents. Operate with zero speculation and no interpretation beyond what is explicitly written.

DOCUMENT SCOPE — CRITICAL
Only flag conflicts that are explicitly present in the DOCUMENTS section below. Each conflict must relate to text that actually appears in the document. Do NOT invent or assume conflicts. Do NOT apply checks from one procedure type to another (e.g. do not flag vehicle-loading issues when the document is about X-ray, metal detection, goods in, or auditing).

CORE PRINCIPLES
- Find factual contradictions only. Do not infer meaning or intent.
- Conflicts must be observable in the text. Every conflict must cite or relate to content that appears in the DOCUMENTS section.
- Assume a regulated food safety environment.

IDENTIFY (only when the document actually contains the relevant content):
1. Internal contradictions: conflicting steps, frequencies, limits, responsibilities
2. Cross-document contradictions: procedure conflicts, terminology differences, definitions differ
3. Compliance contradictions: statements conflicting with BRC clauses, customer specs, Golden Template
4. Factual inaccuracies: misattribution, impractical rules, incorrect sequence — only when explicitly stated in the document

RULES
- No guesses. No "probable" or "likely" language.
- If variance_type = sanctioned_variance, classify as SANCTIONED_VARIANCE, not a conflict.
- blocks_draft: true only for critical UNSANCTIONED_CONFLICT.

OUTPUT FORMAT
Return ONLY a JSON array. Each object: {"conflict_type": "UNSANCTIONED_CONFLICT|SANCTIONED_VARIANCE|PENDING_REVIEW|PARENT_BREACH", "severity": "info|low|medium|high|critical", "layer": "<doc layer>", "sites": [], "document_refs": [], "description": "<explicit contradiction>", "recommendation": "<required alignment>", "blocks_draft": false}

If none found, return [].""" + DOCUMENT_REFERENCE_RULE


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

            # Known loading/despatch-specific conflicts — filter unless document clearly discusses loading/despatch
            content_lower = (ctx.cleansed_content or "").lower()
            doc_id = (ctx.document_id or "").lower()
            # Known non-loading procedure IDs — always filter loading conflicts for these
            non_loading_ids = ("fsp048", "x-ray", "xray", "metal detection", "goods in", "audit")
            doc_is_non_loading_by_id = any(nl in doc_id for nl in non_loading_ids)
            # Content-based: if doc is clearly about X-ray/metal detection, filter loading conflicts (fallback when document_id missing)
            doc_is_xray_or_metal = any(
                kw in content_lower for kw in ("x-ray", "xray", "metal detection", "x-ray inspection")
            )
            # Document is "about loading" only if: not non-loading by ID, not X-ray content, AND has 2+ loading terms
            loading_terms = ("pallet", "dolly", "vehicle", "trailer", "manifest", "despatch", "loading bay")
            loading_term_count = sum(1 for t in loading_terms if t in content_lower)
            doc_is_loading = (
                not doc_is_non_loading_by_id
                and not doc_is_xray_or_metal
                and loading_term_count >= 2
            )

            def is_loading_specific_conflict(desc: str) -> bool:
                d = desc.lower()
                return any(
                    kw in d for kw in (
                        "pallets", "dollies", "loads, trailers", "vehicles interchangeably",
                        "food cannot be carried", "empty dollies", "non food",
                        "load is free of", "debris", "glass", "misattribution",
                        "vehicle temperature can drop", "before loading",
                        "manifest signature", "driver should sign", "sign after loading",
                    )
                )

            conflicts = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                desc = item.get("description") or item.get("issue", "")
                if not desc:
                    continue
                # Filter known loading-specific conflicts when document is not about loading/despatch
                if is_loading_specific_conflict(desc) and not doc_is_loading:
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
