"""FastAPI routes for RAG ingest (called by Workato)."""
from fastapi import APIRouter, HTTPException

from src.rag.models import (
    IngestDocumentRequest,
    IngestBatchRequest,
    IngestResponse,
    IngestBatchResponse,
)
from src.rag.ingest import ingest_document, ingest_batch as do_ingest_batch

router = APIRouter(prefix="/ingest", tags=["ingest"])


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
