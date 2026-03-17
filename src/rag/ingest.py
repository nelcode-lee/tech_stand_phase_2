"""Ingest pipeline: chunk → embed → vector store + document registry. Used by POST /ingest."""
from src.rag.chunking import chunk_text
from src.rag.document_registry import (
    delete_policy_clauses,
    upsert_document,
    upsert_document_content,
    upsert_policy_clauses,
)
from src.rag.embedding import embed_chunks, get_embedding_client
from src.rag.models import IngestDocumentRequest
from src.rag.vector_store import add_chunks, delete_by_document_id, get_collection


def ingest_document(req: IngestDocumentRequest) -> tuple[int, str | None]:
    """
    Chunk document, embed, write to vector store and document registry.
    Optionally re-ingest (delete by document_id first).
    Returns (chunks_ingested, error_message).
    """
    try:
        metadata = req.metadata
        content_stored = False
        # Re-ingest: remove existing chunks for this document
        if metadata.document_id:
            delete_by_document_id(metadata.document_id)

        doc_layer = metadata.doc_layer.value if hasattr(metadata.doc_layer, "value") else str(metadata.doc_layer)

        # Stable policy standards such as BRCGS use structured clause storage instead of vector chunks.
        if doc_layer == "policy":
            upsert_document_content(metadata.document_id, req.content)
            content_stored = True
            clause_count = upsert_policy_clauses(
                metadata.document_id,
                metadata.title or metadata.document_id,
                req.content,
                source_path=metadata.source_path,
            )
            if clause_count > 0:
                upsert_document(
                    document_id=metadata.document_id,
                    title=metadata.title or metadata.document_id,
                    doc_layer=doc_layer,
                    sites=metadata.sites or [],
                    library=metadata.library or "Uploads",
                    chunk_count=0,
                    policy_ref=metadata.policy_ref,
                    source_path=metadata.source_path,
                )
                return 0, None

            # If this policy does not parse into structured clauses, clear stale clause rows and fall back.
            delete_policy_clauses(metadata.document_id)

        chunks = chunk_text(req.content, metadata)
        if not chunks:
            return 0, None

        embeddings = embed_chunks(chunks, client=get_embedding_client())
        collection = get_collection()
        add_chunks(chunks, embeddings, collection=collection)

        # Register document for reliable listing (no vector similarity needed)
        upsert_document(
            document_id=metadata.document_id,
            title=metadata.title or metadata.document_id,
            doc_layer=doc_layer,
            sites=metadata.sites or [],
            library=metadata.library or "Uploads",
            chunk_count=len(chunks),
            policy_ref=metadata.policy_ref,
            source_path=metadata.source_path,
        )
        # Store full text for cross-reference with findings (split view)
        if not content_stored:
            upsert_document_content(metadata.document_id, req.content)

        return len(chunks), None
    except Exception as e:
        return 0, str(e)


def ingest_batch(documents: list[IngestDocumentRequest]) -> tuple[int, int, list[str]]:
    """
    Ingest multiple documents. Returns (total_chunks, documents_processed, list of error messages).
    """
    total_chunks = 0
    errors: list[str] = []
    for i, req in enumerate(documents):
        n, err = ingest_document(req)
        if err:
            errors.append(f"doc {i} (id={req.metadata.document_id}): {err}")
        else:
            total_chunks += n
    return total_chunks, len(documents), errors
