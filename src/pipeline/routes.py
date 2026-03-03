"""FastAPI routes for agent pipeline."""
import io
import logging
import re
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

log = logging.getLogger(__name__)
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
    requester: str | None = None  # Person who requested the analysis (logged with findings)
    attached_doc_url: str | None = None
    content: str | None = None
    retrieved_chunks: list[dict] | None = None
    query: str | None = None  # Optional: semantic search query when using vector retrieval
    agents: list[str] | None = None  # Optional: run only these agents (e.g. for targeted mode)


def _to_doc_layer(s: str) -> DocLayer:
    return DocLayer(s) if s in ("policy", "principle", "sop", "work_instruction") else DocLayer.sop


def _to_request_type(s: str) -> RequestType:
    valid = ("new_document", "update_existing", "contradiction_flag", "review_request",
             "single_document_review", "harmonisation_review", "principle_layer_review")
    return RequestType(s) if s in valid else RequestType.single_document_review


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
    # When document_id is provided, only chunks from that document are returned (scoped analysis)
    from src.rag.retriever import retrieve
    if req.document_id:
        log.info("Retrieving chunks for document_id=%s", req.document_id)
    else:
        log.warning("No document_id in request — retrieval will be unfiltered (all documents)")
    return retrieve(
        doc_layer=req.doc_layer,
        sites=req.sites or None,
        policy_ref=req.policy_ref,
        document_id=req.document_id,
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
    # Glossary candidates: vague terms to add to glossary (route to HITL)
    glossary_candidates = [
        {"term": t.term, "recommendation": t.recommendation}
        for t in ctx.terminology_flags
        if getattr(t, "glossary_candidate", False)
    ]

    analysis_date = datetime.now(timezone.utc).isoformat()
    requester = (body.requester or "").strip()

    response = {
        "tracking_id": ctx.tracking_id,
        "document_id": doc_id,
        "title": title,
        "requester": requester,
        "analysis_date": analysis_date,
        "draft_ready": ctx.draft_ready,
        "draft_content": ctx.draft_content,
        "overall_risk": ctx.overall_risk.value if ctx.overall_risk else None,
        "conflict_count": ctx.conflict_count,
        "blocker_count": ctx.blocker_count,
        "conflicts": [c.model_dump() for c in ctx.conflicts],
        "terminology_flags": [t.model_dump() for t in ctx.terminology_flags],
        "glossary_candidates": glossary_candidates,
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
    session_saved = False
    try:
        record_session(
            tracking_id=ctx.tracking_id,
            document_id=doc_id,
            title=title,
            requester=requester,
            doc_layer=ctx.doc_layer.value,
            sites=sites_str,
            overall_risk=ctx.overall_risk.value if ctx.overall_risk else None,
            total_findings=total_findings,
            agents_run=ctx.agents_run,
            agent_findings=agent_findings,
            workflow_type="review",
            result_json=response,
        )
        session_saved = True
    except Exception as e:
        log.warning("Failed to persist analysis session for dashboard: %s", e)

    response["session_saved"] = session_saved
    return response


class DraftRequest(BaseModel):
    content: str
    filename: str = "draft"


def _text_to_docx(content: str) -> bytes:
    """Convert plain text (with optional markdown headings) to DOCX bytes."""
    from docx import Document

    doc = Document()
    lines = content.split("\n")
    for line in lines:
        stripped = line.strip()
        if not stripped:
            doc.add_paragraph()
            continue
        # Markdown-style headings: # H1, ## H2, ### H3
        h1 = re.match(r"^#\s+(.+)$", stripped)
        h2 = re.match(r"^##\s+(.+)$", stripped)
        h3 = re.match(r"^###\s+(.+)$", stripped)
        if h1:
            doc.add_heading(h1.group(1).strip(), level=1)
        elif h2:
            doc.add_heading(h2.group(1).strip(), level=2)
        elif h3:
            doc.add_heading(h3.group(1).strip(), level=3)
        else:
            doc.add_paragraph(stripped)
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.getvalue()


@router.post("/draft")
async def post_draft(body: DraftRequest):
    """Generate a DOCX file from draft content. Returns the file for download."""
    try:
        docx_bytes = _text_to_docx(body.content or "")
    except Exception as e:
        log.warning("DOCX generation failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    filename = (body.filename or "draft").replace(".docx", "") + ".docx"
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/analysis/sessions")
async def get_analysis_sessions(limit: int = Query(50, ge=1, le=200)):
    """Return recent analysis sessions for dashboard metrics."""
    from src.rag.analysis_sessions import list_sessions
    return list_sessions(limit=limit)


@router.get("/analysis/sessions/{tracking_id}")
async def get_analysis_session(tracking_id: str):
    """Return a single analysis session with full result (findings, flags, etc.)."""
    from src.rag.analysis_sessions import get_session
    session = get_session(tracking_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


class GlossaryTermRequest(BaseModel):
    """Add a term to the standard glossary (from HITL when terminology is vague)."""
    abbreviation: str
    definition: str


@router.post("/glossary/terms")
async def add_glossary_term_route(body: GlossaryTermRequest):
    """Add a term to the standard glossary. Used when HITL reviewer approves a vague term for inclusion."""
    from src.pipeline.domain import add_glossary_term
    ok = add_glossary_term(body.abbreviation, body.definition)
    if ok:
        return {"ok": True, "message": f"Added '{body.abbreviation}' to glossary"}
    return {"ok": False, "message": f"Term '{body.abbreviation}' already exists in glossary"}


class SaveAnalysisRequest(BaseModel):
    """Save or update an analysis session (e.g. after user edits)."""
    tracking_id: str
    document_id: str = ""
    title: str = ""
    requester: str = ""
    doc_layer: str = "sop"
    sites: str = ""
    overall_risk: str | None = None
    total_findings: int = 0
    agents_run: list[str] = []
    agent_findings: dict = {}


@router.post("/analysis/save")
async def save_analysis_session(body: SaveAnalysisRequest):
    """Persist analysis session (captures user changes / ensures state is saved)."""
    from src.rag.analysis_sessions import record_session
    try:
        record_session(
            tracking_id=body.tracking_id,
            document_id=body.document_id or "",
            title=body.title or body.document_id or "Unnamed",
            requester=body.requester or "",
            doc_layer=body.doc_layer or "sop",
            sites=body.sites,
            overall_risk=body.overall_risk,
            total_findings=body.total_findings,
            agents_run=body.agents_run,
            agent_findings=body.agent_findings,
            workflow_type="review",
        )
        return {"ok": True, "message": "Changes saved"}
    except Exception as e:
        return {"ok": False, "message": str(e)}
