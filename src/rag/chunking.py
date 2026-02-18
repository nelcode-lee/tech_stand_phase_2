"""Chunk document text for embedding. Uses semantic boundaries (headings) with size fallback."""
import re
from src.rag.models import DocLayer, DocumentChunk, IngestDocumentMetadata

# ~400 tokens ≈ 300 words; overlap to avoid mid-sentence cuts
DEFAULT_CHUNK_SIZE = 1200
DEFAULT_OVERLAP = 200


def chunk_text(
    text: str,
    metadata: IngestDocumentMetadata,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_OVERLAP,
) -> list[DocumentChunk]:
    """
    Split document text into chunks with metadata. Prefer splitting on paragraph/heading boundaries.
    """
    text = (text or "").strip()
    if not text:
        return []

    # Normalise line breaks and split into segments (paragraphs / lines)
    segments = _split_into_segments(text)
    chunks: list[DocumentChunk] = []
    current: list[str] = []
    current_len = 0
    chunk_index = 0

    for seg in segments:
        seg_len = len(seg) + 1  # +1 for space
        if current_len + seg_len <= chunk_size and current:
            current.append(seg)
            current_len += seg_len
        else:
            if current:
                chunk_text_str = " ".join(current)
                chunks.append(
                    DocumentChunk(
                        text=chunk_text_str,
                        doc_layer=metadata.doc_layer,
                        sites=list(metadata.sites),
                        policy_ref=metadata.policy_ref,
                        document_id=metadata.document_id,
                        source_path=metadata.source_path,
                        title=metadata.title,
                        library=metadata.library,
                        chunk_index=chunk_index,
                    )
                )
                chunk_index += 1
                # Overlap: keep tail of current for next chunk
                overlap_segments = _take_from_end_for_overlap(current, overlap)
                current = overlap_segments
                current_len = sum(len(s) + 1 for s in current)
            current = [seg]
            current_len = seg_len

    if current:
        chunk_text_str = " ".join(current)
        chunks.append(
            DocumentChunk(
                text=chunk_text_str,
                doc_layer=metadata.doc_layer,
                sites=list(metadata.sites),
                policy_ref=metadata.policy_ref,
                document_id=metadata.document_id,
                source_path=metadata.source_path,
                title=metadata.title,
                library=metadata.library,
                chunk_index=chunk_index,
            )
        )

    return chunks


def _split_into_segments(text: str) -> list[str]:
    """Split on double newlines (paragraphs) or single newlines; trim each segment."""
    # Normalise
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    parts = text.split("\n\n")
    segments: list[str] = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # If a "paragraph" is still very long, split by single newlines
        if len(p) > DEFAULT_CHUNK_SIZE:
            for line in p.split("\n"):
                line = line.strip()
                if line:
                    segments.append(line)
        else:
            segments.append(p)
    return segments


def _take_from_end_for_overlap(segments: list[str], overlap_chars: int) -> list[str]:
    """Keep segments from the end that fit within overlap_chars."""
    result: list[str] = []
    total = 0
    for s in reversed(segments):
        if total + len(s) + 1 > overlap_chars:
            break
        result.append(s)
        total += len(s) + 1
    result.reverse()
    return result
