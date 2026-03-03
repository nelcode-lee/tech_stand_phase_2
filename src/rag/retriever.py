"""RAG retriever: queries Supabase vector store for relevant document chunks."""
import logging
from src.rag.embedding import embed_text, get_embedding_client

log = logging.getLogger(__name__)
from src.rag.models import DocumentChunk, DocLayer
from src.rag.vector_store import query_chunks

DEFAULT_LIMIT = 20
# Fallback query when no user query is provided — broad enough to return relevant chunks
FALLBACK_QUERIES = {
    DocLayer.policy: "policy document governance",
    DocLayer.principle: "principle intent rationale",
    DocLayer.sop: "SOP procedure operational",
    DocLayer.work_instruction: "work instruction step",
}


def retrieve(
    doc_layer: str | DocLayer,
    sites: list[str] | None = None,
    policy_ref: str | None = None,
    document_id: str | None = None,
    query_text: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[DocumentChunk]:
    """
    Retrieve relevant chunks from the vector store.
    Uses query_text for semantic search; falls back to layer-specific query if not provided.
    Filters by doc_layer, policy_ref, document_id (when provided), and optionally sites.
    When document_id is set, returns only chunks from that document, sorted by chunk_index.
    """
    layer = DocLayer(doc_layer) if isinstance(doc_layer, str) and doc_layer in ("policy", "principle", "sop", "work_instruction") else DocLayer.sop
    q = (query_text or "").strip() or FALLBACK_QUERIES.get(layer, "procedure policy document")
    embedding = embed_text(q, client=get_embedding_client())
    if not embedding:
        return []
    chunks = query_chunks(
        embedding=embedding,
        doc_layer=layer.value,
        policy_ref=policy_ref,
        sites=sites,
        document_id=document_id,
        limit=limit,
    )
    if document_id and not chunks:
        log.warning("Retrieved 0 chunks for document_id=%s — document may not exist or filter may be too strict", document_id)
    return chunks
