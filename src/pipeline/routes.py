"""FastAPI routes for agent pipeline."""
from fastapi import APIRouter, Query
from pydantic import BaseModel

from src.pipeline.models import PipelineContext, RequestType, DocLayer
from src.pipeline.router import PipelineRouter
from src.rag.models import DocumentChunk

router = APIRouter(tags=["pipeline"])


class AnalyseRequest(BaseModel):
    tracking_id: str
    request_type: str
    doc_layer: str
    sites: list[str] = []
    policy_ref: str | None = None
    document_id: str | None = None  # Optional: from config for metrics
    title: str | None = None  # Optional: document title for metrics
    attached_doc_url: str | None = None
    content: str | None = None
    retrieved_chunks: list[dict] | None = None
    query: str | None = None  # Optional: semantic search query when using vector retrieval
    agents: list[str] | None = None  # Optional: run only these agents (e.g. for targeted mode)


def _to_doc_layer(s: str) -> DocLayer:
    return DocLayer(s) if s in ("policy", "principle", "sop", "work_instruction") else DocLayer.sop


def _to_request_type(s: str) -> RequestType:
    return RequestType(s) if s in ("new_document", "update_existing", "contradiction_flag", "review_request") else RequestType.new_document


def _chunks_from_request(req: AnalyseRequest) -> list[DocumentChunk]:
    if req.retrieved_chunks:
        return [
            DocumentChunk(
                text=c.get("text", ""),
                doc_layer=_to_doc_layer(c.get("doc_layer", req.doc_layer)),
                sites=c.get("sites", req.sites),
                policy_ref=c.get("policy_ref") or req.policy_ref,
                document_id=c.get("document_id"),
                source_path=c.get("source_path"),
                title=c.get("title"),
                library=c.get("library"),
                chunk_index=c.get("chunk_index", 0),
            )
            for c in req.retrieved_chunks
        ]
    if req.content:
        return [
            DocumentChunk(
                text=req.content,
                doc_layer=_to_doc_layer(req.doc_layer),
                sites=req.sites,
                policy_ref=req.policy_ref,
                chunk_index=0,
            )
        ]
    # Vector retrieval: fetch relevant chunks from Supabase
    from src.rag.retriever import retrieve
    return retrieve(
        doc_layer=req.doc_layer,
        sites=req.sites or None,
        policy_ref=req.policy_ref,
        query_text=req.query,
    )


# Map API result keys -> agent names for agent_findings
_FINDING_KEYS_TO_AGENT = {
    "risk_gaps": "risk",
    "content_integrity_flags": "cleansing",
    "structure_flags": "cleansing",
    "conflicts": "conflict",
    "specifying_flags": "specifying",
    "terminology_flags": "terminology",
    "compliance_flags": "validation",
    "formatting_flags": "formatting",
    "sequencing_flags": "sequencing",
}


@router.post("/analyse")
async def post_analyse(body: AnalyseRequest):
    """Run the agent pipeline. Accepts content or retrieved_chunks for testing."""
    chunks = _chunks_from_request(body)
    agents_override = body.agents if body.agents else None
    ctx = PipelineContext(
        tracking_id=body.tracking_id,
        request_type=_to_request_type(body.request_type),
        doc_layer=_to_doc_layer(body.doc_layer),
        sites=body.sites,
        policy_ref=body.policy_ref,
        attached_doc_url=body.attached_doc_url,
        retrieved_chunks=chunks,
    )
    router_instance = PipelineRouter(agents_override=agents_override)
    ctx = await router_instance.run(ctx)

    # Persist session for dashboard metrics
    from src.rag.analysis_sessions import record_session

    doc_id = body.document_id or (chunks[0].document_id if chunks else "") or ""
    title = body.title or (chunks[0].title if chunks else "") or doc_id or "Unnamed"
    sites_str = ",".join(body.sites) if body.sites else ""
    total_findings = (
        len(ctx.risk_gaps)
        + len(ctx.specifying_flags)
        + len(ctx.structure_flags)
        + len(ctx.content_integrity_flags)
        + len(ctx.sequencing_flags)
        + len(ctx.formatting_flags)
        + len(ctx.compliance_flags)
        + len(ctx.terminology_flags)
        + len(ctx.conflicts)
    )
    agent_findings = {}
    for key, agent in _FINDING_KEYS_TO_AGENT.items():
        val = getattr(ctx, key, None)
        count = len(val) if val else 0
        if count > 0:
            agent_findings[agent] = agent_findings.get(agent, 0) + count
    try:
        record_session(
            tracking_id=ctx.tracking_id,
            document_id=doc_id,
            title=title,
            doc_layer=ctx.doc_layer.value,
            sites=sites_str,
            overall_risk=ctx.overall_risk.value if ctx.overall_risk else None,
            total_findings=total_findings,
            agents_run=ctx.agents_run,
            agent_findings=agent_findings,
            workflow_type="review",
        )
    except Exception:
        pass  # Don't fail the request if metrics persistence fails

    return {
        "tracking_id": ctx.tracking_id,
        "draft_ready": ctx.draft_ready,
        "overall_risk": ctx.overall_risk.value if ctx.overall_risk else None,
        "conflict_count": ctx.conflict_count,
        "blocker_count": ctx.blocker_count,
        "conflicts": [c.model_dump() for c in ctx.conflicts],
        "terminology_flags": [t.model_dump() for t in ctx.terminology_flags],
        "risk_scores": [r.model_dump() for r in ctx.risk_scores],
        "risk_gaps": [g.model_dump() for g in ctx.risk_gaps],
        "specifying_flags": [s.model_dump() for s in ctx.specifying_flags],
        "structure_flags": [s.model_dump() for s in ctx.structure_flags],
        "content_integrity_flags": [c.model_dump() for c in ctx.content_integrity_flags],
        "sequencing_flags": [s.model_dump() for s in ctx.sequencing_flags],
        "formatting_flags": [f.model_dump() for f in ctx.formatting_flags],
        "compliance_flags": [c.model_dump() for c in ctx.compliance_flags],
        "warnings": ctx.warnings,
        "errors": [e.model_dump() for e in ctx.errors],
        "agents_run": ctx.agents_run,
    }


@router.get("/analysis/sessions")
async def get_analysis_sessions(limit: int = Query(50, ge=1, le=200)):
    """Return recent analysis sessions for dashboard metrics."""
    from src.rag.analysis_sessions import list_sessions
    return list_sessions(limit=limit)
