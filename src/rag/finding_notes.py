"""User finding notes: audit log and optional knowledge-base ingestion."""
import json
import logging
import os
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

from src.rag.models import DocumentChunk, DocLayer

log = logging.getLogger(__name__)
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
TABLE_NAME = "finding_notes"
USER_NOTES_DOC_PREFIX = "user_finding_note_"


def _get_conn():
    if not SUPABASE_DB_URL:
        raise ValueError("SUPABASE_DB_URL required")
    return psycopg2.connect(SUPABASE_DB_URL)


@contextmanager
def _cursor():
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
    """Create finding_notes table if not exists."""
    with _cursor() as cur:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS public.{TABLE_NAME} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_name TEXT NOT NULL DEFAULT '',
                document_id TEXT NOT NULL DEFAULT '',
                tracking_id TEXT NOT NULL DEFAULT '',
                finding_id TEXT NOT NULL DEFAULT '',
                finding_summary JSONB NOT NULL DEFAULT '{{}}',
                agent_key TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                attachments JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute(f"ALTER TABLE public.{TABLE_NAME} ADD COLUMN IF NOT EXISTS attachments JSONB")


def add_finding_note(
    user_name: str,
    document_id: str,
    tracking_id: str,
    finding_id: str,
    finding_summary: dict,
    agent_key: str,
    note: str,
    attachments: list[dict] | None = None,
    add_to_vector_store: bool = True,
) -> dict | None:
    """
    Store a user note on a finding. Logs to SQL and optionally adds to vector store for retrieval.
    Returns the inserted row { id, user_name, finding_id, note, created_at } or None on failure.
    """
    if not note or not note.strip():
        log.warning("add_finding_note called with empty note")
        return None
    if not SUPABASE_DB_URL:
        log.warning("SUPABASE_DB_URL not set — finding notes will not persist")
        return None

    ensure_table()
    note_id = str(uuid.uuid4())
    created = datetime.now(timezone.utc)
    summary_json = json.dumps(finding_summary) if finding_summary else "{}"
    attachments_json = json.dumps(attachments or []) if attachments else "[]"

    with _cursor() as cur:
        cur.execute(f"""
            INSERT INTO public.{TABLE_NAME} (
                id, user_name, document_id, tracking_id, finding_id,
                finding_summary, agent_key, note, attachments, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb, %s)
        """, (
            note_id, user_name or "", document_id or "", tracking_id or "",
            finding_id or "", summary_json, agent_key or "", note.strip(), attachments_json, created,
        ))

    # Include attachment filenames in note text for vector search
    note_for_vector = note.strip()
    if attachments:
        names = [a.get("name", "file") for a in attachments if isinstance(a, dict) and a.get("name")]
        if names:
            note_for_vector = f"{note_for_vector} [Attachments: {', '.join(names)}]"

    if add_to_vector_store:
        try:
            _ingest_note_to_vector_store(
                user_name=user_name,
                document_id=document_id,
                tracking_id=tracking_id,
                finding_id=finding_id,
                finding_summary=finding_summary,
                agent_key=agent_key,
                note=note_for_vector,
                note_id=note_id,
                created_at=created,
            )
        except Exception as e:
            log.warning("Failed to ingest finding note to vector store: %s", e)

    return {
        "id": note_id,
        "user_name": user_name or "",
        "document_id": document_id or "",
        "tracking_id": tracking_id or "",
        "finding_id": finding_id or "",
        "agent_key": agent_key or "",
        "note": note.strip(),
        "created_at": created.isoformat(),
    }


def get_relevant_finding_notes(
    document_id: str,
    limit: int = 20,
    agent_key: str | None = None,
) -> list[dict]:
    """
    Return prior user feedback (finding notes) for a document, for use in agent context.
    Checked before reasoning so agents can align with known corrections/preferences.
    """
    if not document_id or not document_id.strip():
        return []
    if not SUPABASE_DB_URL:
        return []
    try:
        ensure_table()
    except Exception as e:
        log.warning("finding_notes ensure_table failed: %s", e)
        return []
    with _cursor() as cur:
        if agent_key and agent_key.strip():
            cur.execute(f"""
                SELECT agent_key, note, finding_id, created_at
                FROM public.{TABLE_NAME}
                WHERE document_id = %s AND agent_key = %s
                ORDER BY created_at DESC
                LIMIT %s
            """, (document_id.strip(), agent_key.strip(), limit))
        else:
            cur.execute(f"""
                SELECT agent_key, note, finding_id, created_at
                FROM public.{TABLE_NAME}
                WHERE document_id = %s
                ORDER BY created_at DESC
                LIMIT %s
            """, (document_id.strip(), limit))
        rows = cur.fetchall()
    return [
        {
            "agent_key": r.get("agent_key") or "",
            "note": (r.get("note") or "").strip(),
            "finding_id": r.get("finding_id") or "",
            "created_at": r.get("created_at").isoformat() if r.get("created_at") else "",
        }
        for r in rows
        if (r.get("note") or "").strip()
    ]


def list_finding_notes(limit: int = 100) -> list[dict]:
    """Return recent finding notes (user, document, finding, note, datetime) for the logs view."""
    if not SUPABASE_DB_URL:
        return []
    try:
        ensure_table()
    except Exception as e:
        log.warning("finding_notes ensure_table failed: %s", e)
        return []
    with _cursor() as cur:
        cur.execute(f"""
            SELECT id, user_name, document_id, tracking_id, finding_id,
                   finding_summary, agent_key, note, attachments, created_at
            FROM public.{TABLE_NAME}
            ORDER BY created_at DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()
    result = []
    for r in rows:
        summary = r.get("finding_summary")
        if isinstance(summary, str):
            try:
                summary = json.loads(summary) if summary else {}
            except json.JSONDecodeError:
                summary = {}
        attachments = r.get("attachments")
        if isinstance(attachments, str):
            try:
                attachments = json.loads(attachments) if attachments else []
            except json.JSONDecodeError:
                attachments = []
        result.append({
            "id": str(r.get("id", "")),
            "user_name": r.get("user_name") or "",
            "document_id": r.get("document_id") or "",
            "tracking_id": r.get("tracking_id") or "",
            "finding_id": r.get("finding_id") or "",
            "finding_summary": summary,
            "agent_key": r.get("agent_key") or "",
            "note": r.get("note") or "",
            "attachments": attachments or [],
            "created_at": r.get("created_at").isoformat() if r.get("created_at") else "",
        })
    return result


def _ingest_note_to_vector_store(
    user_name: str,
    document_id: str,
    tracking_id: str,
    finding_id: str,
    finding_summary: dict,
    agent_key: str,
    note: str,
    note_id: str,
    created_at: datetime,
) -> None:
    """Create a chunk from the note and add to vector store for retrieval."""
    from src.rag.embedding import embed_chunks
    from src.rag.vector_store import add_chunks, get_collection

    summary_str = json.dumps(finding_summary)[:500] if finding_summary else ""
    text = (
        f"User note (agent: {agent_key}, document: {document_id}). "
        f"Finding: {finding_id}. Summary: {summary_str}. Note: {note}"
    )
    doc_id = f"{USER_NOTES_DOC_PREFIX}{note_id}"
    chunk = DocumentChunk(
        text=text,
        doc_layer=DocLayer.sop,
        sites=[],
        policy_ref=None,
        document_id=doc_id,
        source_path=f"finding_note_{note_id}",
        title=f"User note by {user_name}",
        library="UserFindingNotes",
        chunk_index=0,
    )
    embeddings = embed_chunks([chunk])
    if embeddings:
        add_chunks([chunk], embeddings, collection=get_collection())
