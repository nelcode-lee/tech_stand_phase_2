"""FastAPI routes for RAG ingest (called by Workato) and document listing."""
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from src.rag.document_registry import (
    delete_document,
    delete_site_standard_link,
    delete_vector_chunks_document_id_like,
    get_document_content,
    get_source_file,
    list_site_standard_links,
    purge_documents_by_doc_layers,
    update_document_metadata,
    update_vector_store_chunk_metadata,
    upsert_site_standard_link,
    upsert_source_file,
)
from src.rag.vector_store import delete_by_document_id
from src.rag.models import (
    DocLayer,
    IngestDocumentMetadata,
    IngestDocumentRequest,
    IngestBatchRequest,
    IngestResponse,
    IngestBatchResponse,
)
from src.rag.ingest import ingest_document, ingest_batch as do_ingest_batch
from src.rag.file_extract import extract_text, supported_extensions

router = APIRouter(prefix="/ingest", tags=["ingest"])


# ---------------------------------------------------------------------------
# GET /documents — list documents from the document registry
# ---------------------------------------------------------------------------

class DocumentSummary(BaseModel):
    document_id: str
    title: str
    doc_layer: str
    sites: list[str]
    library: str
    source_path: str | None = None
    chunk_count: int = 0


@router.get("/documents", tags=["documents"])
def list_documents() -> list[DocumentSummary]:
    """
    Return all documents from the document registry.
    If registry is empty but vector store has chunks, backfill from vector store and return.
    """
    import logging
    log = logging.getLogger(__name__)
    try:
        from src.rag.document_registry import list_documents as registry_list, fetch_all_from_vector_store, upsert_document
        rows = registry_list()
        # Fallback: if registry empty but vector store has docs, backfill and return
        if not rows:
            from_vec = fetch_all_from_vector_store()
            if from_vec:
                for d in from_vec:
                    try:
                        upsert_document(
                            document_id=d["document_id"],
                            title=d["title"],
                            doc_layer=d["doc_layer"],
                            sites=d["sites"],
                            library=d["library"],
                            chunk_count=d["chunk_count"],
                            policy_ref=d.get("policy_ref"),
                            source_path=d.get("source_path"),
                        )
                    except Exception as ex:
                        log.warning("Backfill upsert failed for %s: %s", d.get("document_id"), ex)
                rows = registry_list()
        return [DocumentSummary(**r) for r in rows]
    except Exception as e:
        log.warning("list_documents failed: %s", e)
        # Last resort: try returning directly from vector store
        try:
            from src.rag.document_registry import fetch_all_from_vector_store
            from_vec = fetch_all_from_vector_store()
            if from_vec:
                return [DocumentSummary(**r) for r in from_vec]
        except Exception:
            pass
        return []


class DocumentUpdateBody(BaseModel):
    """Body for PATCH /documents/{document_id}."""
    sites: list[str] | None = None
    title: str | None = None
    doc_layer: str | None = None
    library: str | None = None
    policy_ref: str | None = None


@router.get("/documents/{document_id}/content", tags=["documents"])
def get_document_content_route(document_id: str):
    """
    Return full document text and sections for cross-reference with findings (split view).
    Stored at ingest, or reconstructed from chunks for older documents.
    """
    if not document_id:
        raise HTTPException(status_code=400, detail="document_id is required")
    content, sections = get_document_content(document_id)
    if content is None:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found or has no content")
    return {"document_id": document_id, "content": content, "sections": sections}


@router.get("/documents/{document_id}/file", tags=["documents"])
def get_document_file_route(document_id: str):
    """
    Return original DOCX file bytes for procedures (sop, work_instruction).
    Used by the Analyse page to render the document as HTML via mammoth.js.
    """
    if not document_id:
        raise HTTPException(status_code=400, detail="document_id is required")
    file_bytes, content_type = get_source_file(document_id)
    if not file_bytes:
        raise HTTPException(status_code=404, detail=f"Source file not stored for document '{document_id}'")
    return Response(content=file_bytes, media_type=content_type or "application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@router.patch("/documents/{document_id}", tags=["documents"])
def patch_document(document_id: str, body: DocumentUpdateBody):
    """
    Update document metadata in the registry and vector store chunks.
    Only provided fields are updated.
    """
    if not document_id:
        raise HTTPException(status_code=400, detail="document_id is required")
    ok = update_document_metadata(
        document_id,
        sites=body.sites,
        title=body.title,
        doc_layer=body.doc_layer,
        library=body.library,
        policy_ref=body.policy_ref,
    )
    if not ok:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found")
    # Also update vector store chunk metadata so retrieval is consistent
    update_vector_store_chunk_metadata(
        document_id,
        sites=body.sites,
        title=body.title,
        doc_layer=body.doc_layer,
        library=body.library,
        policy_ref=body.policy_ref,
    )
    return {"ok": True, "message": "Document metadata updated"}


@router.delete("/documents/{document_id}", tags=["documents"])
def delete_document_route(document_id: str):
    """
    Delete a document from the registry and vector store.
    Removes all chunks and the registry entry.
    """
    if not document_id:
        raise HTTPException(status_code=400, detail="document_id is required")
    try:
        delete_by_document_id(document_id)
        delete_document(document_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "message": f"Document '{document_id}' deleted"}


ALLOWED_EXTENSIONS = tuple(f".{ext}" for ext in supported_extensions() if ext)

def _parse_doc_layer(s: str) -> DocLayer:
    if s and s in ("policy", "principle", "sop", "work_instruction"):
        return DocLayer(s)
    return DocLayer.sop


@router.post("/file", response_model=IngestResponse)
async def post_ingest_file(
    file: UploadFile = File(..., description="DOCX or PDF file to ingest"),
    document_id: str = Form(..., description="Unique document ID"),
    doc_layer: str = Form("sop", description="Document layer: policy, principle, sop, work_instruction"),
    sites: str = Form("", description="Comma-separated site codes"),
    policy_ref: str | None = Form(None),
    title: str | None = Form(None),
    library: str | None = Form(None),
) -> IngestResponse:
    """
    Ingest a DOCX or PDF file. Extracts plain text and processes via the standard ingest pipeline.
    """
    doc_id = (document_id or "").strip()
    if not doc_id:
        raise HTTPException(
            status_code=400,
            detail="document_id is required and cannot be empty. Use a short title or identifier.",
        )
    if not file.filename or not file.filename.lower().endswith(ALLOWED_EXTENSIONS):
        allowed = ", ".join(ALLOWED_EXTENSIONS)
        name = file.filename or "(no filename)"
        raise HTTPException(
            status_code=400,
            detail=f"File '{name}' is not allowed. Only {allowed} files are accepted.",
        )

    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e!s}")

    content = extract_text(raw, file.filename)
    if not content or not content.strip():
        raise HTTPException(
            status_code=400,
            detail="Could not extract text from file. Check that the file is a valid DOCX or PDF and not password-protected.",
        )

    site_list = [s.strip() for s in sites.split(",") if s.strip()] if sites else []
    metadata = IngestDocumentMetadata(
        doc_layer=_parse_doc_layer(doc_layer),
        sites=site_list,
        policy_ref=policy_ref if policy_ref else None,
        document_id=doc_id,
        source_path=file.filename,
        title=title or file.filename,
        library=library or "Uploads",
    )
    req = IngestDocumentRequest(content=content, metadata=metadata)
    try:
        chunks_ingested, err = ingest_document(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingest failed: {e!s}")
    if err:
        raise HTTPException(status_code=500, detail=err)
    # Store original DOCX for procedures (sop, work_instruction) — enables HTML display with highlights
    is_docx = file.filename and file.filename.lower().endswith(".docx")
    is_procedure = doc_layer.lower() in ("sop", "work_instruction")
    if is_docx and is_procedure and raw:
        try:
            upsert_source_file(
                doc_id,
                raw,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        except Exception:
            pass
    return IngestResponse(
        ok=True,
        chunks_ingested=chunks_ingested,
        document_id=doc_id,
        message=f"Ingested {chunks_ingested} chunks from {file.filename}",
    )


@router.post("", response_model=IngestResponse)
def post_ingest(body: IngestDocumentRequest) -> IngestResponse:
    """
    Ingest a single document from Workato.
    Workato sends: content (plain text) + metadata (doc_layer, sites, policy_ref, document_id, etc.).
    """
    chunks_ingested, err = ingest_document(body)
    if err:
        raise HTTPException(status_code=500, detail=err)
    return IngestResponse(
        ok=True,
        chunks_ingested=chunks_ingested,
        document_id=body.metadata.document_id,
        message=f"Ingested {chunks_ingested} chunks",
    )


@router.post("/batch", response_model=IngestBatchResponse)
def post_ingest_batch(body: IngestBatchRequest) -> IngestBatchResponse:
    """Ingest multiple documents in one request."""
    total_chunks, docs_processed, errors = do_ingest_batch(body.documents)
    return IngestBatchResponse(
        ok=len(errors) == 0,
        total_chunks=total_chunks,
        documents_processed=docs_processed,
        errors=errors,
    )


# ---------------------------------------------------------------------------
# POST /ingest/admin/reset-metrics-and-library — reset dashboard & keep only 2 docs
# ---------------------------------------------------------------------------

KEEP_LIBRARY_TITLES = {
    "local-Cranswick Manufacturing Standard v2",
    "BRCGS - Food Safety Standard - V9",
}


@router.post("/admin/reset-metrics-and-library")
def post_reset_metrics_and_library():
    """
    Delete all analysis sessions (reset metrics / Attention Required) and remove all
    library documents except those with title in KEEP_LIBRARY_TITLES.
    Returns counts so the UI can clear local session log and refetch.
    """
    from src.rag.analysis_sessions import delete_all_sessions
    from src.rag.document_registry import list_documents, fetch_all_from_vector_store

    sessions_deleted = delete_all_sessions()

    docs = list_documents()
    if not docs:
        docs = fetch_all_from_vector_store()

    to_keep = [d for d in docs if (d.get("title") or "").strip() in KEEP_LIBRARY_TITLES]
    to_remove = [d for d in docs if (d.get("title") or "").strip() not in KEEP_LIBRARY_TITLES]

    documents_removed = 0
    for d in to_remove:
        doc_id = d.get("document_id", "")
        if not doc_id:
            continue
        try:
            delete_by_document_id(doc_id)
            delete_document(doc_id)
            documents_removed += 1
        except Exception:
            pass

    return {
        "ok": True,
        "sessions_deleted": sessions_deleted,
        "documents_removed": documents_removed,
        "documents_kept": [d.get("title") or d.get("document_id") for d in to_keep],
    }


# ---------------------------------------------------------------------------
# POST /ingest/admin/clear-sops-and-reset-metrics — SOP/WI only + all metrics
# ---------------------------------------------------------------------------


@router.post("/admin/clear-sops-and-reset-metrics")
def post_clear_sops_and_reset_metrics():
    """
    Delete all analysis sessions, all finding notes, user-note vectors, and every ingested
    document with doc_layer sop or work_instruction. Policy / principle documents are kept.
    """
    from src.rag.analysis_sessions import delete_all_sessions
    from src.rag.finding_notes import USER_NOTES_DOC_PREFIX, delete_all_finding_notes

    sessions_deleted = delete_all_sessions()
    finding_notes_deleted = delete_all_finding_notes()
    user_note_chunks_deleted = delete_vector_chunks_document_id_like(f"{USER_NOTES_DOC_PREFIX}%")
    purge = purge_documents_by_doc_layers()

    return {
        "ok": True,
        "sessions_deleted": sessions_deleted,
        "finding_notes_deleted": finding_notes_deleted,
        "user_note_vector_chunks_deleted": user_note_chunks_deleted,
        "procedure_documents_removed": purge["removed_count"],
        "procedure_document_ids_removed": purge["removed_ids"],
    }


# ---------------------------------------------------------------------------
# Site ↔ Standard links  (governance graph edges)
# ---------------------------------------------------------------------------

class SiteStandardLinkBody(BaseModel):
    site_id: str
    standard_name: str
    standard_document_id: str | None = None
    standard_type: str = "universal"   # universal | cranswick | customer
    notes: str | None = None


@router.get("/site-standard-links", tags=["governance"])
def get_site_standard_links(site_id: str | None = None):
    """
    List all site ↔ standard links, optionally filtered to one site.
    These edges answer: "which standards apply to site X?" and (inverted)
    "which sites must comply with standard Y?" — used for site_scope on findings.
    """
    try:
        rows = list_site_standard_links(site_id=site_id)
        for r in rows:
            if hasattr(r.get("created_at"), "isoformat"):
                r["created_at"] = r["created_at"].isoformat()
        return {"links": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/site-standard-links", tags=["governance"], status_code=201)
def post_site_standard_link(body: SiteStandardLinkBody):
    """
    Add or update a site ↔ standard link (upsert on site_id + standard_name).
    """
    try:
        upsert_site_standard_link(
            site_id=body.site_id,
            standard_name=body.standard_name,
            standard_document_id=body.standard_document_id,
            standard_type=body.standard_type,
            notes=body.notes,
        )
        return {"ok": True, "site_id": body.site_id, "standard_name": body.standard_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/site-standard-links", tags=["governance"])
def delete_site_standard_link_route(site_id: str, standard_name: str):
    """
    Remove a specific site ↔ standard link.
    """
    try:
        deleted = delete_site_standard_link(site_id=site_id, standard_name=standard_name)
        if not deleted:
            raise HTTPException(status_code=404, detail="Link not found")
        return {"ok": True, "site_id": site_id, "standard_name": standard_name}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
