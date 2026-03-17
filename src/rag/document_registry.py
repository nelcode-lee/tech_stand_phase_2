"""Document registry: SQL table for listing documents without vector similarity search."""
import json
import os
import re
from contextlib import contextmanager

import psycopg2
from psycopg2.extras import RealDictCursor

from src.rag.policy_clauses import build_clause_context_block, parse_policy_clauses

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
TABLE_NAME = "documents"
CONTENT_TABLE_NAME = "document_content"
SOURCE_FILE_TABLE_NAME = "document_source_files"
POLICY_CLAUSE_TABLE_NAME = "policy_clause_records"


def _get_conn():
    """Create a connection using SUPABASE_DB_URL."""
    if not SUPABASE_DB_URL:
        raise ValueError("SUPABASE_DB_URL environment variable is required")
    return psycopg2.connect(SUPABASE_DB_URL)


@contextmanager
def _cursor():
    """Context manager for a database cursor."""
    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ensure_table():
    """
    Create the documents table if it does not exist.
    Idempotent; safe to call on every startup.
    Uses public schema explicitly for Supabase compatibility.
    """
    with _cursor() as cur:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS public.{TABLE_NAME} (
                document_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                doc_layer TEXT NOT NULL DEFAULT 'sop',
                sites JSONB NOT NULL DEFAULT '[]',
                library TEXT NOT NULL DEFAULT 'Uploads',
                policy_ref TEXT,
                source_path TEXT,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)


# Regex to detect section headings (numbered, ALL CAPS, or Title Case)
_SECTION_HEADING_RE = re.compile(
    r"^(?:"
    r"\d[\d\.]*\s+[A-Za-z]"       # "1. Purpose" or "1.2 Scope"
    r"|[A-Z][A-Z0-9 /\-]{2,80}$"   # ALL CAPS headings
    r"|[A-Z][a-zA-Z0-9 /\-&]{2,80}:?\s*$"  # Title Case headings
    r")",
    re.MULTILINE,
)


def _parse_sections(content: str) -> list[dict]:
    """
    Parse document into sections: [{ heading, content, start_char, end_char }].
    Reconfigurable structure for cross-reference and export.
    """
    if not content or not content.strip():
        return []
    lines = content.split("\n")
    sections: list[dict] = []
    current_heading: str | None = None
    current_content: list[str] = []
    current_start = 0
    pos = 0

    for line in lines:
        line_stripped = line.strip()
        is_heading = (
            line_stripped
            and len(line_stripped) <= 80
            and not re.search(r"[.!?]\s+[a-z]", line_stripped)
            and _SECTION_HEADING_RE.match(line_stripped)
        )

        if is_heading and current_heading is not None:
            # Flush previous section
            section_text = "\n".join(current_content).strip()
            if section_text or current_heading:
                sections.append({
                    "heading": current_heading,
                    "content": section_text,
                    "start_char": current_start,
                    "end_char": pos,
                })
            current_heading = line_stripped
            current_content = []
            current_start = pos
        elif is_heading:
            current_heading = line_stripped
            current_content = []
            current_start = pos
        elif current_heading is not None:
            current_content.append(line)
        else:
            # Content before first heading — treat as intro
            if not sections and current_content:
                current_content.append(line)
            elif not sections:
                current_heading = "(Introduction)"
                current_content = [line]
                current_start = 0

        pos += len(line) + 1  # +1 for newline

    if current_heading is not None:
        section_text = "\n".join(current_content).strip()
        sections.append({
            "heading": current_heading,
            "content": section_text,
            "start_char": current_start,
            "end_char": pos,
        })

    return sections


def ensure_document_content_table():
    """
    Create the document_content table if it does not exist.
    Stores full text and sections for cross-reference with findings (Phase 1/2).
    """
    with _cursor() as cur:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS public.{CONTENT_TABLE_NAME} (
                document_id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                sections JSONB DEFAULT '[]',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Add sections column if table existed without it
        try:
            cur.execute(f"""
                ALTER TABLE public.{CONTENT_TABLE_NAME}
                ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]'
            """)
        except Exception:
            pass


def ensure_source_file_table():
    """Create document_source_files table for storing original DOCX bytes (procedures only)."""
    with _cursor() as cur:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS public.{SOURCE_FILE_TABLE_NAME} (
                document_id TEXT PRIMARY KEY,
                file_bytes BYTEA NOT NULL,
                content_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)


def ensure_policy_clause_table():
    """Create the structured policy clause table for stable standards docs like BRCGS."""
    with _cursor() as cur:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS public.{POLICY_CLAUSE_TABLE_NAME} (
                document_id TEXT NOT NULL,
                standard_name TEXT NOT NULL,
                version TEXT,
                clause_id TEXT NOT NULL,
                heading TEXT,
                requirement_text TEXT NOT NULL,
                keywords JSONB NOT NULL DEFAULT '[]',
                canonical_citation TEXT NOT NULL,
                source_title TEXT,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (document_id, clause_id)
            )
        """)


def upsert_policy_clauses(document_id: str, title: str | None, content: str, *, source_path: str | None = None) -> int:
    """Parse and store structured clause records for a policy/standards document. Returns clauses upserted."""
    if not document_id or not content:
        return 0
    rows = parse_policy_clauses(document_id, title, content, source_path=source_path)
    if not rows:
        return 0
    try:
        ensure_policy_clause_table()
    except Exception:
        return 0
    with _cursor() as cur:
        cur.execute(f"DELETE FROM public.{POLICY_CLAUSE_TABLE_NAME} WHERE document_id = %s", (document_id,))
        for row in rows:
            cur.execute(
                f"""
                INSERT INTO public.{POLICY_CLAUSE_TABLE_NAME} (
                    document_id, standard_name, version, clause_id, heading,
                    requirement_text, keywords, canonical_citation, source_title,
                    active, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, NOW())
                ON CONFLICT (document_id, clause_id) DO UPDATE SET
                    standard_name = EXCLUDED.standard_name,
                    version = EXCLUDED.version,
                    heading = EXCLUDED.heading,
                    requirement_text = EXCLUDED.requirement_text,
                    keywords = EXCLUDED.keywords,
                    canonical_citation = EXCLUDED.canonical_citation,
                    source_title = EXCLUDED.source_title,
                    active = EXCLUDED.active,
                    updated_at = NOW()
                """,
                (
                    row["document_id"],
                    row["standard_name"],
                    row["version"],
                    row["clause_id"],
                    row["heading"],
                    row["requirement_text"],
                    json.dumps(row["keywords"]),
                    row["canonical_citation"],
                    row["source_title"],
                    bool(row.get("active", True)),
                ),
            )
    return len(rows)


def get_policy_clauses(
    *,
    document_id: str | None = None,
    standard_name: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Return structured policy clauses filtered by document_id and/or standard_name."""
    if not SUPABASE_DB_URL:
        return []
    try:
        ensure_policy_clause_table()
    except Exception:
        return []
    where = []
    params: list = []
    if document_id:
        where.append("document_id = %s")
        params.append(document_id)
    if standard_name:
        where.append("LOWER(standard_name) = LOWER(%s)")
        params.append(standard_name)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    with _cursor() as cur:
        cur.execute(
            f"""
            SELECT document_id, standard_name, version, clause_id, heading, requirement_text,
                   keywords, canonical_citation, source_title, active
            FROM public.{POLICY_CLAUSE_TABLE_NAME}
            {where_sql}
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    out = []
    for row in rows:
        keywords = row.get("keywords")
        if isinstance(keywords, str):
            try:
                keywords = json.loads(keywords) if keywords else []
            except json.JSONDecodeError:
                keywords = []
        out.append({**row, "keywords": keywords or []})
    out.sort(key=lambda row: _clause_sort_key(row.get("clause_id") or ""))
    if limit and limit > 0:
        return out[:limit]
    return out


def query_policy_clauses(
    query_text: str,
    *,
    document_id: str | None = None,
    standard_name: str | None = None,
    limit: int = 25,
) -> list[dict]:
    """Return the most relevant structured policy clauses using lightweight keyword overlap."""
    rows = get_policy_clauses(document_id=document_id, standard_name=standard_name)
    if not rows:
        return []
    query_words = re.findall(r"[A-Za-z][A-Za-z0-9\-]{3,}", (query_text or "").lower())
    query_terms = {w for w in query_words if w not in {
        "shall", "must", "with", "that", "this", "from", "there", "their", "where", "when",
        "procedure", "document", "process", "record", "check", "checks", "using", "used",
    }}
    scored: list[tuple[int, dict]] = []
    for row in rows:
        haystack = " ".join(
            [
                row.get("clause_id") or "",
                row.get("heading") or "",
                row.get("requirement_text") or "",
                " ".join(row.get("keywords") or []),
            ]
        ).lower()
        score = 0
        for term in query_terms:
            if term in haystack:
                score += 1
        if score > 0 or not query_terms:
            scored.append((score, row))
    scored.sort(key=lambda item: (-item[0], item[1].get("clause_id") or ""))
    return [row for _, row in scored[:limit]]


def get_policy_citation_set(*, document_id: str | None = None, standard_name: str | None = None) -> set[str]:
    """Return canonical citations for structured policy clauses."""
    rows = get_policy_clauses(document_id=document_id, standard_name=standard_name)
    return {str(r.get("canonical_citation") or "").strip() for r in rows if (r.get("canonical_citation") or "").strip()}


def get_policy_context_block(
    *,
    document_id: str | None = None,
    standard_name: str | None = None,
    query_text: str = "",
    limit: int = 25,
    max_chars: int = 12000,
) -> tuple[str, list[dict]]:
    """Return a rendered policy clause block plus the underlying clause rows."""
    rows = query_policy_clauses(query_text, document_id=document_id, standard_name=standard_name, limit=limit)
    return build_clause_context_block(rows, max_chars=max_chars), rows


def _clause_sort_key(clause_id: str) -> tuple:
    parts = re.findall(r"\d+|[A-Za-z]+", clause_id or "")
    key: list[int | str] = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part.lower())
    return tuple(key)


def upsert_source_file(document_id: str, file_bytes: bytes, content_type: str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document") -> None:
    """Store or update original file bytes for a document (procedures: DOCX)."""
    if not document_id or not file_bytes:
        return
    try:
        ensure_source_file_table()
        with _cursor() as cur:
            cur.execute(f"""
                INSERT INTO public.{SOURCE_FILE_TABLE_NAME} (document_id, file_bytes, content_type, created_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (document_id) DO UPDATE SET
                    file_bytes = EXCLUDED.file_bytes,
                    content_type = EXCLUDED.content_type,
                    created_at = NOW()
            """, (document_id, psycopg2.Binary(file_bytes), content_type))
    except Exception:
        pass


def get_source_file(document_id: str) -> tuple[bytes | None, str | None]:
    """Return (file_bytes, content_type) for a document. Returns (None, None) if not stored."""
    if not document_id:
        return None, None
    try:
        ensure_source_file_table()
        with _cursor() as cur:
            cur.execute(
                f"SELECT file_bytes, content_type FROM public.{SOURCE_FILE_TABLE_NAME} WHERE document_id = %s",
                (document_id,),
            )
            row = cur.fetchone()
        if row and row.get("file_bytes"):
            return bytes(row["file_bytes"]), row.get("content_type") or "application/octet-stream"
    except Exception:
        pass
    return None, None


def upsert_document_content(document_id: str, content: str) -> None:
    """Store or update full document text and parsed sections for cross-reference with findings."""
    if not document_id or not content:
        return
    try:
        ensure_document_content_table()
    except Exception:
        return
    sections = _parse_sections(content)
    sections_json = json.dumps(sections)
    with _cursor() as cur:
        cur.execute(f"""
            INSERT INTO public.{CONTENT_TABLE_NAME} (document_id, content, sections, updated_at)
            VALUES (%s, %s, %s::jsonb, NOW())
            ON CONFLICT (document_id) DO UPDATE SET
                content = EXCLUDED.content,
                sections = EXCLUDED.sections,
                updated_at = NOW()
        """, (document_id, content, sections_json))


def _fetch_chunks_via_vector_store(document_id: str) -> list[dict]:
    """Reconstruct chunks list from vector store query when raw SQL fails. Returns list of {text}."""
    try:
        from src.rag.vector_store import query_chunks
        from src.rag.embedding import embed_text, get_embedding_client
        emb = embed_text("document content sections", client=get_embedding_client())
        if not emb:
            return []
        chunks = query_chunks(
            embedding=emb,
            document_id=document_id,
            limit=200,
        )
        return [{"text": (c.text or "").strip()} for c in chunks if (c.text or "").strip()]
    except Exception:
        return []


def get_document_content(document_id: str) -> tuple[str | None, list[dict]]:
    """
    Return (content, sections). First checks document_content table.
    If not stored (e.g. pre-split-view ingest), reconstructs from vector store chunks.
    Sections are parsed on the fly when content comes from chunks.
    """
    if not document_id:
        return None, []
    # 1. Try stored content
    try:
        ensure_document_content_table()
        with _cursor() as cur:
            cur.execute(
                f"SELECT content, sections FROM public.{CONTENT_TABLE_NAME} WHERE document_id = %s",
                (document_id,),
            )
            row = cur.fetchone()
        if row and row.get("content"):
            sections = row.get("sections")
            if isinstance(sections, str):
                try:
                    sections = json.loads(sections) if sections else []
                except json.JSONDecodeError:
                    sections = []
            elif sections is None:
                sections = []
            return row["content"], sections
    except Exception:
        pass
    # 2. Fallback: reconstruct from chunks (raw SQL on vecs/public document_chunks)
    chunks = _fetch_chunks_for_document(document_id)
    if not chunks:
        # 3. Fallback: get chunks via vector store query (e.g. when SQL table name differs)
        chunks = _fetch_chunks_via_vector_store(document_id)
    if not chunks:
        return None, []
    if isinstance(chunks[0], dict):
        content = "\n\n".join((c.get("text") or "").strip() for c in chunks if c.get("text"))
    else:
        content = "\n\n".join((getattr(c, "text", "") or "").strip() for c in chunks)
    content = content.strip() or None
    if not content:
        return None, []
    sections = _parse_sections(content)
    return content, sections


def _fetch_chunks_for_document(document_id: str) -> list[dict]:
    """Fetch all chunks for a document from vector store via raw SQL. Returns list of {text}."""
    if not document_id or not SUPABASE_DB_URL:
        return []
    for table in ("vecs.document_chunks", "public.document_chunks", "document_chunks"):
        try:
            with _cursor() as cur:
                cur.execute(f"""
                    SELECT metadata->>'text' AS text, (metadata->>'chunk_index')::int AS chunk_index
                    FROM {table}
                    WHERE metadata->>'document_id' = %s
                    ORDER BY chunk_index
                """, (document_id,))
                rows = cur.fetchall()
                return [{"text": r["text"] or ""} for r in rows if r.get("text")]
        except Exception:
            continue
    return []


def delete_document_content(document_id: str) -> None:
    """Remove stored content when document is deleted."""
    if not document_id:
        return
    try:
        with _cursor() as cur:
            cur.execute(
                f"DELETE FROM public.{CONTENT_TABLE_NAME} WHERE document_id = %s",
                (document_id,),
            )
    except Exception:
        pass


def delete_source_file(document_id: str) -> None:
    """Remove stored source file when document is deleted."""
    if not document_id:
        return
    try:
        ensure_source_file_table()
        with _cursor() as cur:
            cur.execute(
                f"DELETE FROM public.{SOURCE_FILE_TABLE_NAME} WHERE document_id = %s",
                (document_id,),
            )
    except Exception:
        pass


def delete_policy_clauses(document_id: str) -> None:
    """Remove structured policy clauses when the source document is deleted."""
    if not document_id:
        return
    try:
        ensure_policy_clause_table()
        with _cursor() as cur:
            cur.execute(
                f"DELETE FROM public.{POLICY_CLAUSE_TABLE_NAME} WHERE document_id = %s",
                (document_id,),
            )
    except Exception:
        pass


def upsert_document(
    document_id: str,
    title: str,
    doc_layer: str,
    sites: list[str],
    library: str,
    chunk_count: int,
    policy_ref: str | None = None,
    source_path: str | None = None,
) -> None:
    """
    Insert or update a document in the registry.
    Called at ingest time (after chunking, so chunk_count is known).
    """
    if not document_id:
        return
    ensure_table()
    sites_json = json.dumps(sites) if isinstance(sites, list) else "[]"
    with _cursor() as cur:
        cur.execute(f"""
            INSERT INTO public.{TABLE_NAME} (
                document_id, title, doc_layer, sites, library,
                policy_ref, source_path, chunk_count, created_at, updated_at
            ) VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (document_id) DO UPDATE SET
                title = EXCLUDED.title,
                doc_layer = EXCLUDED.doc_layer,
                sites = EXCLUDED.sites,
                library = EXCLUDED.library,
                policy_ref = EXCLUDED.policy_ref,
                source_path = EXCLUDED.source_path,
                chunk_count = EXCLUDED.chunk_count,
                updated_at = NOW()
        """, (
            document_id,
            title or document_id,
            doc_layer or "sop",
            sites_json,
            library or "Uploads",
            policy_ref,
            source_path,
            chunk_count,
        ))


def get_document_policy_ref(document_id: str) -> str | None:
    """Return policy_ref for a document, or None if not found/not set."""
    if not document_id:
        return None
    try:
        ensure_table()
    except Exception:
        return None
    with _cursor() as cur:
        cur.execute(
            f"SELECT policy_ref FROM public.{TABLE_NAME} WHERE document_id = %s",
            (document_id,),
        )
        row = cur.fetchone()
    return (row.get("policy_ref") or "").strip() or None if row else None


def list_documents() -> list[dict]:
    """
    Return all documents from the registry, sorted by title.
    Each dict has: document_id, title, doc_layer, sites, library, source_path, chunk_count.
    """
    try:
        ensure_table()
    except Exception:
        return []

    with _cursor() as cur:
        cur.execute(f"""
            SELECT document_id, title, doc_layer, sites, library,
                   source_path, chunk_count
            FROM public.{TABLE_NAME}
            ORDER BY LOWER(title)
        """)
        rows = cur.fetchall()

    result = []
    for r in rows:
        sites = r.get("sites")
        if isinstance(sites, str):
            try:
                sites = json.loads(sites) if sites else []
            except json.JSONDecodeError:
                sites = []
        elif sites is None:
            sites = []
        result.append({
            "document_id": r["document_id"],
            "title": r["title"] or r["document_id"],
            "doc_layer": r["doc_layer"] or "sop",
            "sites": sites,
            "library": r["library"] or "Uploads",
            "source_path": r["source_path"],
            "chunk_count": r["chunk_count"] or 0,
        })
    return result


def update_document_metadata(
    document_id: str,
    *,
    sites: list[str] | None = None,
    title: str | None = None,
    doc_layer: str | None = None,
    library: str | None = None,
    policy_ref: str | None = None,
) -> bool:
    """
    Update document metadata in the registry.
    Only updates fields that are not None.
    Returns True if the document was found and updated.
    """
    if not document_id:
        return False
    ensure_table()
    updates = []
    params = []
    if sites is not None:
        updates.append("sites = %s::jsonb")
        params.append(json.dumps(sites) if isinstance(sites, list) else "[]")
    if title is not None:
        updates.append("title = %s")
        params.append(title)
    if doc_layer is not None:
        updates.append("doc_layer = %s")
        params.append(doc_layer)
    if library is not None:
        updates.append("library = %s")
        params.append(library)
    if policy_ref is not None:
        updates.append("policy_ref = %s")
        params.append(policy_ref)
    if not updates:
        return True
    updates.append("updated_at = NOW()")
    params.append(document_id)
    with _cursor() as cur:
        cur.execute(
            f"UPDATE public.{TABLE_NAME} SET {', '.join(updates)} WHERE document_id = %s",
            tuple(params),
        )
        return cur.rowcount > 0


def update_vector_store_chunk_metadata(
    document_id: str,
    *,
    sites: list[str] | None = None,
    title: str | None = None,
    doc_layer: str | None = None,
    library: str | None = None,
    policy_ref: str | None = None,
) -> int:
    """
    Update metadata in vector store chunks for a document.
    Returns the number of chunks updated.
    """
    if not document_id or not SUPABASE_DB_URL:
        return 0
    changes = []
    if sites is not None:
        changes.append(("sites", json.dumps(sites), "jsonb"))
    if title is not None:
        changes.append(("title", title, "text"))
    if doc_layer is not None:
        changes.append(("doc_layer", doc_layer, "text"))
    if library is not None:
        changes.append(("library", library, "text"))
    if policy_ref is not None:
        changes.append(("policy_ref", policy_ref, "text"))
    if not changes:
        return 0
    for table in ("vecs.document_chunks", "public.document_chunks", "document_chunks"):
        try:
            with _cursor() as cur:
                rowcount = 0
                for key, val, typ in changes:
                    if typ == "jsonb":
                        cur.execute(
                            f"UPDATE {table} SET metadata = jsonb_set(COALESCE(metadata, '{{}}'::jsonb), %s, %s::jsonb) WHERE metadata->>'document_id' = %s",
                            ("{" + key + "}", val, document_id),
                        )
                    else:
                        cur.execute(
                            f"UPDATE {table} SET metadata = jsonb_set(COALESCE(metadata, '{{}}'::jsonb), %s, to_jsonb(%s::text)) WHERE metadata->>'document_id' = %s",
                            ("{" + key + "}", val, document_id),
                        )
                    rowcount = cur.rowcount
                return rowcount
        except Exception:
            continue
    return 0


def delete_document(document_id: str) -> None:
    """Remove a document from the registry (e.g. when re-ingesting or deleting)."""
    if not document_id:
        return
    delete_document_content(document_id)
    delete_source_file(document_id)
    delete_policy_clauses(document_id)
    with _cursor() as cur:
        cur.execute(f"DELETE FROM public.{TABLE_NAME} WHERE document_id = %s", (document_id,))


def fetch_all_from_vector_store() -> list[dict]:
    """
    Fetch all distinct documents from the vecs.document_chunks table via raw SQL.
    Returns full coverage without semantic query limits.
    """
    if not SUPABASE_DB_URL:
        return []
    # Try vecs schema first (standard vecs layout), then public, then unqualified
    for table in ("vecs.document_chunks", "public.document_chunks", "document_chunks"):
        try:
            with _cursor() as cur:
                cur.execute(f"""
                    SELECT
                        metadata->>'document_id' AS document_id,
                        metadata->>'title' AS title,
                        metadata->>'doc_layer' AS doc_layer,
                        metadata->>'sites' AS sites,
                        metadata->>'library' AS library,
                        metadata->>'policy_ref' AS policy_ref,
                        metadata->>'source_path' AS source_path,
                        COUNT(*)::int AS chunk_count
                    FROM {table}
                    WHERE metadata->>'document_id' IS NOT NULL
                      AND metadata->>'document_id' != ''
                    GROUP BY
                        metadata->>'document_id',
                        metadata->>'title',
                        metadata->>'doc_layer',
                        metadata->>'sites',
                        metadata->>'library',
                        metadata->>'policy_ref',
                        metadata->>'source_path'
                """)
                rows = cur.fetchall()
                break
        except Exception:
            continue
    else:
        return []

    result = []
    for r in rows:
        sites = r.get("sites")
        if isinstance(sites, str):
            try:
                sites = json.loads(sites) if sites else []
            except json.JSONDecodeError:
                sites = []
        elif sites is None:
            sites = []
        result.append({
            "document_id": r["document_id"],
            "title": r["title"] or r["document_id"],
            "doc_layer": r["doc_layer"] or "sop",
            "sites": sites,
            "library": r["library"] or "Uploads",
            "source_path": r["source_path"],
            "policy_ref": r["policy_ref"],
            "chunk_count": r["chunk_count"] or 0,
        })
    return result
