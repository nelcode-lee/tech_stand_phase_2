"""Supabase (pgvector via vecs) vector store. Writes chunks + embeddings; supports metadata filter for retrieval."""
import json
import os

import vecs

from src.rag.models import DocumentChunk, DocLayer

COLLECTION_NAME = "document_chunks"
# text-embedding-3-small dimension
EMBEDDING_DIMENSION = 1536

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")


def _chunk_to_metadata(chunk: DocumentChunk) -> dict:
    """vecs metadata: scalar or JSON string for lists. Includes text for retrieval."""
    return {
        "text": chunk.text,
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


def _metadata_to_chunk(record_id: str, metadata: dict) -> DocumentChunk | None:
    """Convert vecs record metadata back to DocumentChunk."""
    text = metadata.get("text", "")
    if not text:
        return None
    try:
        sites_raw = metadata.get("sites", "[]")
        sites = json.loads(sites_raw) if isinstance(sites_raw, str) else (sites_raw or [])
    except (json.JSONDecodeError, TypeError):
        sites = []
    layer_val = metadata.get("doc_layer", "sop")
    return DocumentChunk(
        text=text,
        doc_layer=DocLayer(layer_val) if layer_val in ("policy", "principle", "sop", "work_instruction") else DocLayer.sop,
        sites=sites,
        policy_ref=metadata.get("policy_ref") or None,
        document_id=metadata.get("document_id") or None,
        source_path=metadata.get("source_path") or None,
        title=metadata.get("title") or None,
        library=metadata.get("library") or None,
        chunk_index=int(metadata.get("chunk_index", 0)),
    )


def query_chunks(
    embedding: list[float],
    doc_layer: str | None = None,
    policy_ref: str | None = None,
    sites: list[str] | None = None,
    limit: int = 20,
    collection=None,
) -> list[DocumentChunk]:
    """
    Query the vector store for similar chunks. Returns DocumentChunks with metadata.
    Filters by doc_layer, policy_ref; sites filter uses $contains on stored JSON string.
    """
    if not embedding:
        return []
    coll = collection or get_collection()
    # Skip vecs filters (vecs has "max 1 entry per filter" constraint); filter in Python
    fetch_limit = limit * 3 if (doc_layer or policy_ref or sites) else limit
    results = coll.query(
        data=embedding,
        limit=fetch_limit,
        filters=None,
        include_value=True,
        include_metadata=True,
    )
    chunks: list[DocumentChunk] = []
    for rec in results:
        if isinstance(rec, tuple):
            # (id, value, metadata) when include_metadata and include_value
            rec_id = rec[0]
            metadata = rec[2] if len(rec) > 2 else {}
        elif hasattr(rec, "id"):
            rec_id = rec.id
            metadata = getattr(rec, "metadata", {}) or {}
        else:
            continue
        chunk = _metadata_to_chunk(rec_id, metadata)
        if chunk:
            if doc_layer and (chunk.doc_layer.value if hasattr(chunk.doc_layer, "value") else str(chunk.doc_layer)) != doc_layer:
                continue
            if policy_ref and (chunk.policy_ref or "") != policy_ref:
                continue
            if sites and chunk.sites and not any(s in chunk.sites for s in sites):
                continue
            chunks.append(chunk)
            if len(chunks) >= limit:
                break
    return chunks
