"""Ingest pipeline: chunk → embed → vector store. Used by POST /ingest."""
from src.rag.chunking import chunk_text
from src.rag.embedding import embed_chunks, get_embedding_client
from src.rag.models import IngestDocumentRequest
from src.rag.vector_store import add_chunks, delete_by_document_id, get_collection


def ingest_document(req: IngestDocumentRequest) -> tuple[int, str | None]:
    """
    Chunk document, embed, write to vector store. Optionally re-ingest (delete by document_id first).
    Returns (chunks_ingested, error_message).
    """
    try:
        metadata = req.metadata
        chunks = chunk_text(req.content, metadata)
        if not chunks:
            return 0, None

        # Re-ingest: remove existing chunks for this document
        if metadata.document_id:
            delete_by_document_id(metadata.document_id)

        embeddings = embed_chunks(chunks, client=get_embedding_client())
        collection = get_collection()
        add_chunks(chunks, embeddings, collection=collection)
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
