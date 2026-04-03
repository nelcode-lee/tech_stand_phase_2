"""Document registry: SQL table for listing documents without vector similarity search."""
import json
import logging
import os
import re
from contextlib import contextmanager
from typing import Any

log = logging.getLogger(__name__)

import psycopg2
from psycopg2.extras import RealDictCursor

from src.rag.policy_clauses import build_clause_context_block, parse_policy_clauses

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
TABLE_NAME = "documents"
CONTENT_TABLE_NAME = "document_content"
SOURCE_FILE_TABLE_NAME = "document_source_files"
POLICY_CLAUSE_TABLE_NAME = "policy_clause_records"
SITE_STANDARD_TABLE_NAME = "site_standard_links"

# When token extraction yields nothing, avoid returning arbitrary clauses (early clause_ids).
_POLICY_CLAUSE_QUERY_FALLBACK = (
    "temperature control chilled frozen dispatch loading vehicle transport storage "
    "monitoring verification traceability foreign body hygiene food safety hazard"
)

# Words so common in BRCGS / MS clause text they add noise without the phrase bonus below.
# NOTE: do NOT add operational terms like "check", "document", "record" here — they are
# meaningful discriminators when extracted from compliance findings.
_POLICY_QUERY_STOPWORDS = frozenset({
    "shall", "must", "with", "that", "this", "from", "there", "their", "where", "when",
    "using", "used", "ensure", "appropriate", "relevant", "including", "within", "against",
    "through",
})


def _policy_clause_query_terms(query_text: str) -> tuple[set[str], list[str]]:
    """
    Return (term_set, ordered_words) for clause scoring.
    ordered_words keeps sequence for adjacent-phrase matching.
    """
    raw = (query_text or "").lower()
    words = re.findall(r"[A-Za-z][A-Za-z0-9\-]{3,}", raw)
    ordered: list[str] = []
    seen: set[str] = set()
    for w in words:
        lw = w.lower()
        if lw in _POLICY_QUERY_STOPWORDS or lw in seen:
            continue
        seen.add(lw)
        ordered.append(lw)
    term_set = set(ordered)
    if not term_set:
        fb = re.findall(r"[A-Za-z][A-Za-z0-9\-]{3,}", _POLICY_CLAUSE_QUERY_FALLBACK.lower())
        ordered = [w.lower() for w in fb if w.lower() not in _POLICY_QUERY_STOPWORDS]
        term_set = set(ordered)
    return term_set, ordered


def _phrase_bonus(haystack: str, ordered_words: list[str]) -> int:
    """Extra score when two consecutive query tokens both appear as an adjacent phrase in haystack."""
    if len(ordered_words) < 2:
        return 0
    bonus = 0
    for i in range(len(ordered_words) - 1):
        a, b = ordered_words[i], ordered_words[i + 1]
        if f"{a} {b}" in haystack:
            bonus += 3
    return bonus


def _get_conn():
    """Create a connection using SUPABASE_DB_URL."""
    if not SUPABASE_DB_URL:
        raise ValueError("SUPABASE_DB_URL environment variable is required")
    return psycopg2.connect(SUPABASE_DB_URL, connect_timeout=15)


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


def distinct_policy_document_ids_for_standard_names(
    standard_names: list[str],
    *,
    extra_document_ids: list[str] | None = None,
) -> list[str]:
    """
    All document_ids that have active rows for any of the given standard_name values,
    plus any extra_document_ids explicitly provided (bypasses name matching for documents
    whose standard_name in policy_clause_records is a raw filename rather than a clean label).
    """
    if not SUPABASE_DB_URL:
        return []
    out: list[str] = []
    names = [str(n).strip() for n in (standard_names or []) if str(n).strip()]
    if names:
        try:
            ensure_policy_clause_table()
        except Exception:
            names = []
    if names:
        lowered = tuple(n.lower() for n in names)
        placeholders = ",".join(["%s"] * len(lowered))
        with _cursor() as cur:
            cur.execute(
                f"""
                SELECT DISTINCT document_id FROM public.{POLICY_CLAUSE_TABLE_NAME}
                WHERE COALESCE(active, TRUE) = TRUE
                  AND LOWER(TRIM(standard_name)) IN ({placeholders})
                ORDER BY document_id
                """,
                lowered,
            )
            for r in cur.fetchall():
                did = str(r["document_id"]).strip()
                if did and did not in out:
                    out.append(did)
    # Explicitly pinned document IDs (for docs whose standard_name is a raw filename)
    for did in extra_document_ids or []:
        did = str(did).strip()
        if did and did not in out:
            out.append(did)
    return out


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
    out = [_policy_clause_row_from_db(dict(row)) for row in rows]
    out.sort(key=lambda row: _clause_sort_key(row.get("clause_id") or ""))
    if limit and limit > 0:
        return out[:limit]
    return out


def _policy_clause_row_from_db(row: dict) -> dict:
    """Normalise keywords JSON on a clause row from the DB."""
    keywords = row.get("keywords")
    if isinstance(keywords, str):
        try:
            keywords = json.loads(keywords) if keywords else []
        except json.JSONDecodeError:
            keywords = []
    return {**row, "keywords": keywords or []}


def _grounding_terms(grounding_text: str | None) -> set[str]:
    """4+ letter tokens for overlap scoring (lowercased)."""
    if not grounding_text or not str(grounding_text).strip():
        return set()
    g = str(grounding_text).lower()
    return {t for t in re.findall(r"[a-z]{4,}", g)}


def _updated_at_ts(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value.timestamp())
    except (AttributeError, TypeError, OSError, ValueError):
        return 0.0


def _pick_clause_row_for_grounding(rows: list[dict], grounding_text: str | None) -> dict | None:
    """
    When several ingests share the same canonical_citation, pick the row whose body best
    matches the finding text. If grounding is rich but no row shares any token, return None
    so callers can fall back to keyword retrieval (avoids showing the wrong document's body).
    """
    if not rows:
        return None
    g_terms = _grounding_terms(grounding_text)
    if not g_terms:
        ordered = sorted(rows, key=lambda r: _updated_at_ts(r.get("updated_at")), reverse=True)
        return _policy_clause_row_from_db(dict(ordered[0]))

    scored: list[tuple[int, float, dict]] = []
    for raw in rows:
        row = dict(raw)
        hay = f"{row.get('heading') or ''} {row.get('requirement_text') or ''}".lower()
        score = sum(1 for t in g_terms if t in hay)
        scored.append((score, _updated_at_ts(row.get("updated_at")), row))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    best_score, _, best_row = scored[0]
    if best_score <= 0 and len(g_terms) >= 5:
        return None
    return _policy_clause_row_from_db(dict(best_row))


def lookup_policy_clause_row(
    *,
    canonical_citation: str | None = None,
    standard_name: str | None = None,
    clause_id: str | None = None,
    grounding_text: str | None = None,
) -> dict | None:
    """
    Return one policy_clause_records row by canonical_citation (preferred) or standard_name + clause_id.

    Multiple rows can exist (same clause ingested from different files). When ``grounding_text``
    is provided, the row with the best token overlap to the finding is chosen; if none overlap
    and grounding is substantial, returns None.
    """
    if not SUPABASE_DB_URL:
        return None
    try:
        ensure_policy_clause_table()
    except Exception:
        return None

    with _cursor() as cur:
        if canonical_citation and str(canonical_citation).strip():
            cur.execute(
                f"""
                SELECT document_id, standard_name, version, clause_id, heading, requirement_text,
                       keywords, canonical_citation, source_title, active, updated_at
                FROM public.{POLICY_CLAUSE_TABLE_NAME}
                WHERE LOWER(TRIM(canonical_citation)) = LOWER(TRIM(%s))
                  AND COALESCE(active, TRUE) = TRUE
                ORDER BY updated_at DESC
                """,
                (str(canonical_citation).strip(),),
            )
        elif standard_name and clause_id and str(standard_name).strip() and str(clause_id).strip():
            cur.execute(
                f"""
                SELECT document_id, standard_name, version, clause_id, heading, requirement_text,
                       keywords, canonical_citation, source_title, active, updated_at
                FROM public.{POLICY_CLAUSE_TABLE_NAME}
                WHERE LOWER(TRIM(standard_name)) = LOWER(TRIM(%s))
                  AND TRIM(clause_id) = TRIM(%s)
                  AND COALESCE(active, TRUE) = TRUE
                ORDER BY updated_at DESC
                """,
                (str(standard_name).strip(), str(clause_id).strip()),
            )
        else:
            return None
        db_rows = cur.fetchall()
    if not db_rows:
        return None
    return _pick_clause_row_for_grounding(db_rows, grounding_text)


def query_policy_clauses(
    query_text: str,
    *,
    document_id: str | None = None,
    standard_name: str | None = None,
    limit: int = 25,
) -> list[dict]:
    """Return the most relevant structured policy clauses using keyword + adjacent-phrase overlap."""
    rows = get_policy_clauses(document_id=document_id, standard_name=standard_name)
    if not rows:
        return []
    query_terms, ordered_words = _policy_clause_query_terms(query_text or "")
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
        score += _phrase_bonus(haystack, ordered_words)
        # Never include zero-hit rows: empty or degenerate queries used to add every clause
        # and sort by clause_id (early BRCGS sections like 3.7 unrelated to the finding).
        if score > 0:
            scored.append((score, row))
    scored.sort(key=lambda item: (-item[0], item[1].get("clause_id") or ""))
    if not scored:
        return []
    best = scored[0][0]
    # Drop weak stragglers when there is a clearly stronger match (reduces generic single-token hits).
    if best >= 4:
        thresh = max(2, int(best * 0.45))
        scored = [(s, r) for s, r in scored if s >= thresh]
    return [row for _, row in scored[:limit]]


def query_policy_clauses_for_documents(
    document_ids: list[str],
    query_text: str,
    *,
    limit: int = 25,
) -> list[dict]:
    """
    Lexical clause retrieval across multiple policy documents (union + global re-rank).
    Used for SOP compliance → policy clause mapping with scoped standards.
    """
    ids = [str(d).strip() for d in (document_ids or []) if str(d).strip()]
    if not ids:
        return []
    seen: set[tuple[str, str]] = set()
    merged: list[dict] = []
    per_doc = max(8, min(20, limit * 2 // max(1, len(ids)) + 4))
    for doc_id in ids:
        part = query_policy_clauses(query_text, document_id=doc_id, limit=per_doc)
        for row in part:
            key = (str(row.get("document_id") or ""), str(row.get("clause_id") or ""))
            if key in seen or not key[0] or not key[1]:
                continue
            seen.add(key)
            merged.append(row)
    if not merged:
        return []
    query_terms, ordered_words = _policy_clause_query_terms(query_text or "")
    rescored: list[tuple[int, dict]] = []
    for row in merged:
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
        score += _phrase_bonus(haystack, ordered_words)
        if score > 0:
            rescored.append((score, row))
    rescored.sort(key=lambda item: (-item[0], item[1].get("clause_id") or ""))
    if not rescored:
        return []
    best = rescored[0][0]
    if best >= 4:
        thresh = max(2, int(best * 0.45))
        rescored = [(s, r) for s, r in rescored if s >= thresh]
    return [row for _, row in rescored[:limit]]


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


def resolve_registry_document_id(document_id: str) -> str:
    """
    Map a requested id to the canonical `documents.document_id` when possible.
    Handles case differences (fsp048 vs FSP048) and extended ids (FSP048 vs FSP048-METAL-DETECTION).
    If nothing matches, returns the trimmed request unchanged.
    """
    rid = (document_id or "").strip()
    if not rid or not SUPABASE_DB_URL:
        return rid
    try:
        ensure_table()
        with _cursor() as cur:
            cur.execute(
                f"""
                SELECT document_id FROM public.{TABLE_NAME}
                WHERE document_id = %s OR LOWER(document_id) = LOWER(%s)
                LIMIT 1
                """,
                (rid, rid),
            )
            row = cur.fetchone()
            if row and row.get("document_id"):
                return row["document_id"]
            base = rid.split()[0].strip()
            if not base:
                return rid
            cur.execute(
                f"""
                SELECT document_id FROM public.{TABLE_NAME}
                WHERE document_id ILIKE %s OR document_id ILIKE %s OR document_id ILIKE %s
                ORDER BY LENGTH(document_id) ASC
                LIMIT 1
                """,
                (base, base + "-%", base + "_%"),
            )
            row = cur.fetchone()
            if row and row.get("document_id"):
                return row["document_id"]
    except Exception:
        pass
    return rid


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
                f"""
                SELECT content, sections FROM public.{CONTENT_TABLE_NAME}
                WHERE document_id = %s OR LOWER(document_id) = LOWER(%s)
                """,
                (document_id, document_id),
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
                    WHERE LOWER(TRIM(metadata->>'document_id')) = LOWER(TRIM(%s))
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


# ---------------------------------------------------------------------------
# Site ↔ Standard links  (governance graph edge)
# ---------------------------------------------------------------------------

def ensure_site_standard_table() -> None:
    """Create site_standard_links if it does not exist."""
    if not SUPABASE_DB_URL:
        return
    with _cursor() as cur:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS public.{SITE_STANDARD_TABLE_NAME} (
                id             SERIAL PRIMARY KEY,
                site_id        TEXT NOT NULL,
                standard_name  TEXT NOT NULL,        -- e.g. "BRCGS Food Safety"
                standard_document_id TEXT,           -- FK to documents.document_id (nullable — standard may not be ingested yet)
                standard_type  TEXT NOT NULL DEFAULT 'universal',
                                                      -- universal | cranswick | customer
                notes          TEXT,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (site_id, standard_name)
            )
        """)


def upsert_site_standard_link(
    site_id: str,
    standard_name: str,
    *,
    standard_document_id: str | None = None,
    standard_type: str = "universal",
    notes: str | None = None,
) -> None:
    """Add or update a site ↔ standard link row."""
    if not SUPABASE_DB_URL or not site_id or not standard_name:
        return
    ensure_site_standard_table()
    with _cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO public.{SITE_STANDARD_TABLE_NAME}
                (site_id, standard_name, standard_document_id, standard_type, notes)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (site_id, standard_name) DO UPDATE SET
                standard_document_id = EXCLUDED.standard_document_id,
                standard_type        = EXCLUDED.standard_type,
                notes                = EXCLUDED.notes
            """,
            (site_id.strip(), standard_name.strip(), standard_document_id, standard_type, notes),
        )


def delete_site_standard_link(site_id: str, standard_name: str) -> bool:
    """Remove a specific link. Returns True if a row was deleted."""
    if not SUPABASE_DB_URL or not site_id or not standard_name:
        return False
    ensure_site_standard_table()
    with _cursor() as cur:
        cur.execute(
            f"DELETE FROM public.{SITE_STANDARD_TABLE_NAME} WHERE site_id = %s AND standard_name = %s",
            (site_id.strip(), standard_name.strip()),
        )
        return cur.rowcount > 0


def list_site_standard_links(*, site_id: str | None = None) -> list[dict]:
    """Return all site_standard_links rows, optionally filtered to one site."""
    if not SUPABASE_DB_URL:
        return []
    try:
        ensure_site_standard_table()
    except Exception:
        return []
    where = ""
    params: list = []
    if site_id:
        where = "WHERE site_id = %s"
        params.append(site_id.strip())
    with _cursor() as cur:
        cur.execute(
            f"SELECT id, site_id, standard_name, standard_document_id, standard_type, notes, created_at "
            f"FROM public.{SITE_STANDARD_TABLE_NAME} {where} ORDER BY site_id, standard_name",
            tuple(params),
        )
        return [dict(r) for r in cur.fetchall()]


def get_friendly_standard_name_for_document(standard_document_id: str | None) -> str | None:
    """
    Return the friendly standard_name from site_standard_links for the given document_id.

    Used when policy_clause_records.standard_name is a raw filename (e.g. Cranswick doc);
    site_standard_links maps standard_document_id → friendly name (e.g. "Cranswick Manufacturing Standard").
    """
    if not SUPABASE_DB_URL or not standard_document_id or not str(standard_document_id).strip():
        return None
    try:
        ensure_site_standard_table()
    except Exception:
        return None
    with _cursor() as cur:
        cur.execute(
            f"SELECT standard_name FROM public.{SITE_STANDARD_TABLE_NAME} WHERE standard_document_id = %s LIMIT 1",
            (str(standard_document_id).strip(),),
        )
        row = cur.fetchone()
        return str(row["standard_name"]).strip() if row and row.get("standard_name") else None


def get_site_scope_for_standard(
    standard_document_id: str | None = None,
    standard_name: str | None = None,
) -> list[str]:
    """
    3-hop graph query: clause → standard → sites.

    Given a policy document_id (from policy_clause_records) or standard_name,
    return the list of site_ids that are linked to that standard.

    Falls back to empty list (no curated links) — callers should handle gracefully.
    """
    if not SUPABASE_DB_URL:
        return []
    if not standard_document_id and not standard_name:
        return []
    try:
        ensure_site_standard_table()
    except Exception:
        return []
    where_parts: list[str] = []
    params: list = []
    if standard_document_id:
        where_parts.append("standard_document_id = %s")
        params.append(standard_document_id.strip())
    if standard_name:
        where_parts.append("LOWER(TRIM(standard_name)) = LOWER(TRIM(%s))")
        params.append(standard_name.strip())
    where_sql = "WHERE " + " OR ".join(where_parts)
    with _cursor() as cur:
        cur.execute(
            f"SELECT DISTINCT site_id FROM public.{SITE_STANDARD_TABLE_NAME} {where_sql} ORDER BY site_id",
            tuple(params),
        )
        return [str(r["site_id"]).strip() for r in cur.fetchall() if r.get("site_id")]


# Layers treated as ingested procedures (SOPs / WIs), not policy standards.
PROCEDURE_DOC_LAYERS = frozenset({"sop", "work_instruction"})


def delete_vector_chunks_document_id_like(pattern: str) -> int:
    """
    Delete rows from the vector chunk table where metadata document_id matches SQL LIKE pattern.
    Tries vecs.document_chunks, then public.document_chunks. Returns rows deleted (best effort).
    """
    if not SUPABASE_DB_URL or not pattern:
        return 0
    for table in ("vecs.document_chunks", "public.document_chunks", "document_chunks"):
        try:
            with _cursor() as cur:
                cur.execute(
                    f"DELETE FROM {table} WHERE metadata->>'document_id' LIKE %s",
                    (pattern,),
                )
                return int(cur.rowcount or 0)
        except Exception as e:
            log.debug("delete_vector_chunks_document_id_like skip %s: %s", table, e)
            continue
    return 0


def purge_documents_by_doc_layers(
    layers: frozenset[str] | set[str] | None = None,
) -> dict[str, Any]:
    """
    Remove all documents whose doc_layer is in `layers` (default: sop + work_instruction)
    from the vector store and SQL registry (content, source files, policy_clause rows for that id).

    Merges registry + vector-derived doc lists so orphan vector-only procedure docs are removed too.
    Returns {"removed_ids": [...], "removed_count": int}.
    """
    from src.rag.vector_store import delete_by_document_id

    want = frozenset(layers) if layers is not None else PROCEDURE_DOC_LAYERS
    by_id: dict[str, dict] = {}
    try:
        for d in list_documents():
            doc_id = (d.get("document_id") or "").strip()
            if doc_id:
                by_id[doc_id] = d
    except Exception as e:
        log.warning("purge_documents_by_doc_layers list_documents: %s", e)
    try:
        for d in fetch_all_from_vector_store():
            doc_id = (d.get("document_id") or "").strip()
            if doc_id and doc_id not in by_id:
                by_id[doc_id] = d
    except Exception as e:
        log.warning("purge_documents_by_doc_layers fetch_all_from_vector_store: %s", e)

    to_remove: list[str] = []
    for doc_id, d in by_id.items():
        layer = (d.get("doc_layer") or "sop").strip().lower()
        if layer in want:
            to_remove.append(doc_id)

    removed: list[str] = []
    for doc_id in to_remove:
        try:
            delete_by_document_id(doc_id)
            delete_document(doc_id)
            removed.append(doc_id)
        except Exception as e:
            log.warning("purge_documents_by_doc_layers failed for %s: %s", doc_id, e)

    return {"removed_ids": removed, "removed_count": len(removed)}


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
