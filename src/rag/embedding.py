"""Embed text using OpenAI text-embedding-3-small (or Azure OpenAI via env)."""
import os
from openai import OpenAI
from src.rag.models import DocumentChunk

# Model: same as Architecture (dev text-embedding-3-small; prod Azure OpenAI same model)
EMBEDDING_MODEL = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")


def get_embedding_client() -> OpenAI:
    """OpenAI client; set OPENAI_API_BASE for Azure."""
    api_base = os.environ.get("OPENAI_API_BASE")
    kwargs = {}
    if api_base:
        kwargs["base_url"] = api_base
    return OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""), **kwargs)


def embed_chunks(chunks: list[DocumentChunk], client: OpenAI | None = None) -> list[list[float]]:
    """
    Embed all chunk texts; returns list of vectors in same order as chunks.
    """
    if not chunks:
        return []
    client = client or get_embedding_client()
    texts = [c.text for c in chunks]
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    # Preserve order by index
    by_index = {e.index: e.embedding for e in response.data}
    return [by_index[i] for i in range(len(chunks))]
