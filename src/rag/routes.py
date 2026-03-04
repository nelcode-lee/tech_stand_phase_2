"""FastAPI routes for RAG ingest (called by Workato) and document listing."""
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from src.rag.document_registry import (
    delete_document,
    get_document_content,
    update_document_metadata,
    update_vector_store_chunk_metadata,
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
    Return full document text for cross-reference with findings (split view).
    Stored at ingest, or reconstructed from chunks for older documents.
    """
    if not document_id:
        raise HTTPException(status_code=400, detail="document_id is required")
    content = get_document_content(document_id)
    if content is None:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found or has no content")
    return {"document_id": document_id, "content": content, "sections": []}


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
    if not file.filename or not file.filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail=f"Only {', '.join(ALLOWED_EXTENSIONS)} files are accepted",
        )

    raw = await file.read()
    content = extract_text(raw, file.filename)
    if not content or not content.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from file")

    site_list = [s.strip() for s in sites.split(",") if s.strip()] if sites else []
    metadata = IngestDocumentMetadata(
        doc_layer=_parse_doc_layer(doc_layer),
        sites=site_list,
        policy_ref=policy_ref if policy_ref else None,
        document_id=document_id,
        source_path=file.filename,
        title=title or file.filename,
        library=library or "Uploads",
    )
    req = IngestDocumentRequest(content=content, metadata=metadata)
    chunks_ingested, err = ingest_document(req)
    if err:
        raise HTTPException(status_code=500, detail=err)
    return IngestResponse(
        ok=True,
        chunks_ingested=chunks_ingested,
        document_id=document_id,
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
