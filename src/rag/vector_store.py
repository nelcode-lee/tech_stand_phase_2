"""Supabase (pgvector via vecs) vector store. Writes chunks + embeddings; supports metadata filter for retrieval."""
import json
import os

import vecs

from src.rag.models import DocumentChunk

COLLECTION_NAME = "document_chunks"
# text-embedding-3-small dimension
EMBEDDING_DIMENSION = 1536

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")


def _chunk_to_metadata(chunk: DocumentChunk) -> dict:
    """vecs metadata: scalar or JSON string for lists."""
    return {
        "doc_layer": chunk.doc_layer.value,
        "sites": json.dumps(chunk.sites),
        "policy_ref": chunk.policy_ref or "",
        "document_id": chunk.document_id or "",
        "source_path": chunk.source_path or "",
        "title": chunk.title or "",
        "library": chunk.library or "",
        "chunk_index": chunk.chunk_index,
    }


def get_client() -> vecs.Client:
    """vecs client using Supabase Postgres connection string."""
    if not SUPABASE_DB_URL:
        raise ValueError("SUPABASE_DB_URL environment variable is required")
    return vecs.create_client(SUPABASE_DB_URL)


def get_collection(client: vecs.Client | None = None):
    """Get or create the document_chunks collection."""
    client = client or get_client()
    return client.get_or_create_collection(name=COLLECTION_NAME, dimension=EMBEDDING_DIMENSION)


def add_chunks(
    chunks: list[DocumentChunk],
    embeddings: list[list[float]],
    collection=None,
) -> None:
    """Insert chunks and their embeddings into Supabase (pgvector)."""
    if not chunks or len(chunks) != len(embeddings):
        return
    coll = collection or get_collection()
    records = [
        (
            f"{c.document_id or 'doc'}_{c.chunk_index}",
            emb,
            _chunk_to_metadata(c),
        )
        for c, emb in zip(chunks, embeddings)
    ]
    coll.upsert(records)


def delete_by_document_id(document_id: str, collection=None) -> None:
    """Remove all chunks for a document (e.g. before re-ingesting)."""
    if not document_id:
        return
    coll = collection or get_collection()
    coll.delete(filters={"document_id": {"$eq": document_id}})
