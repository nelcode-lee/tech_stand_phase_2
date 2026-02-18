"""Shared models for RAG ingestion and retrieval. Aligns with PipelineContext (DocumentChunk, DocLayer)."""
from enum import Enum
from pydantic import BaseModel, Field


class DocLayer(str, Enum):
    """Document layer in the standards hierarchy."""
    policy = "policy"
    principle = "principle"
    sop = "sop"
    work_instruction = "work_instruction"


class DocumentChunk(BaseModel):
    """A single chunk of document content with metadata for retrieval filtering."""
    text: str
    doc_layer: DocLayer
    sites: list[str] = Field(default_factory=list)
    policy_ref: str | None = None
    document_id: str | None = None
    source_path: str | None = None
    title: str | None = None
    library: str | None = None
    chunk_index: int = 0


# --- Ingest API: payload from Workato ---


class IngestDocumentMetadata(BaseModel):
    """Metadata Workato sends with each document (from SharePoint)."""
    doc_layer: DocLayer
    sites: list[str] = Field(default_factory=list)
    policy_ref: str | None = None
    document_id: str
    source_path: str | None = None
    title: str | None = None
    library: str | None = None


class IngestDocumentRequest(BaseModel):
    """Single document payload for POST /ingest (or batch item for POST /ingest/batch)."""
    content: str = Field(..., description="Plain text body of the document")
    metadata: IngestDocumentMetadata


class IngestBatchRequest(BaseModel):
    """Batch of documents for POST /ingest/batch."""
    documents: list[IngestDocumentRequest]


class IngestResponse(BaseModel):
    """Response from ingest endpoint."""
    ok: bool = True
    chunks_ingested: int = 0
    document_id: str | None = None
    message: str = ""


class IngestBatchResponse(BaseModel):
    """Response from batch ingest."""
    ok: bool = True
    total_chunks: int = 0
    documents_processed: int = 0
    errors: list[str] = Field(default_factory=list)
