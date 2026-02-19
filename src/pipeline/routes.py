"""FastAPI routes for agent pipeline."""
from fastapi import APIRouter
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
    attached_doc_url: str | None = None
    content: str | None = None
    retrieved_chunks: list[dict] | None = None
    query: str | None = None  # Optional: semantic search query when using vector retrieval


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


@router.post("/analyse")
async def post_analyse(body: AnalyseRequest):
    """Run the agent pipeline. Accepts content or retrieved_chunks for testing."""
    chunks = _chunks_from_request(body)
    ctx = PipelineContext(
        tracking_id=body.tracking_id,
        request_type=_to_request_type(body.request_type),
        doc_layer=_to_doc_layer(body.doc_layer),
        sites=body.sites,
        policy_ref=body.policy_ref,
        attached_doc_url=body.attached_doc_url,
        retrieved_chunks=chunks,
    )
    router = PipelineRouter()
    ctx = await router.run(ctx)
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
        "sequencing_flags": [s.model_dump() for s in ctx.sequencing_flags],
        "formatting_flags": [f.model_dump() for f in ctx.formatting_flags],
        "compliance_flags": [c.model_dump() for c in ctx.compliance_flags],
        "warnings": ctx.warnings,
        "errors": [e.model_dump() for e in ctx.errors],
        "agents_run": ctx.agents_run,
    }
