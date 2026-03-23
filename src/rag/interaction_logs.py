"""Governance interaction logs: persist user and UI actions for auditability."""
import json
import logging
import os
import uuid
from contextlib import contextmanager

import psycopg2
from psycopg2.extras import RealDictCursor

log = logging.getLogger(__name__)
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
TABLE_NAME = "interaction_logs"


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
    """Create interaction_logs table if not exists."""
    with _cursor() as cur:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS public.{TABLE_NAME} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_name TEXT NOT NULL DEFAULT '',
                action_type TEXT NOT NULL DEFAULT '',
                route TEXT NOT NULL DEFAULT '',
                workflow_mode TEXT NOT NULL DEFAULT '',
                document_id TEXT NOT NULL DEFAULT '',
                tracking_id TEXT NOT NULL DEFAULT '',
                finding_id TEXT NOT NULL DEFAULT '',
                doc_layer TEXT NOT NULL DEFAULT '',
                metadata JSONB NOT NULL DEFAULT '{{}}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute(f"ALTER TABLE public.{TABLE_NAME} ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{{}}'")


def add_interaction_log(
    *,
    user_name: str = "",
    action_type: str,
    route: str = "",
    workflow_mode: str = "",
    document_id: str = "",
    tracking_id: str = "",
    finding_id: str = "",
    doc_layer: str = "",
    metadata: dict | None = None,
) -> dict | None:
    """Store one interaction log entry and return a normalised record."""
    if not action_type or not action_type.strip():
        return None
    if not SUPABASE_DB_URL:
        log.warning("SUPABASE_DB_URL not set — interaction logs will not persist")
        return None
    ensure_table()
    log_id = str(uuid.uuid4())
    metadata_json = json.dumps(metadata or {})
    with _cursor() as cur:
        cur.execute(f"""
            INSERT INTO public.{TABLE_NAME} (
                id, user_name, action_type, route, workflow_mode,
                document_id, tracking_id, finding_id, doc_layer, metadata, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
        """, (
            log_id,
            user_name or "",
            action_type.strip(),
            route or "",
            workflow_mode or "",
            document_id or "",
            tracking_id or "",
            finding_id or "",
            doc_layer or "",
            metadata_json,
        ))
    return {
        "id": log_id,
        "user_name": user_name or "",
        "action_type": action_type.strip(),
        "route": route or "",
        "workflow_mode": workflow_mode or "",
        "document_id": document_id or "",
        "tracking_id": tracking_id or "",
        "finding_id": finding_id or "",
        "doc_layer": doc_layer or "",
        "metadata": metadata or {},
    }


def list_interaction_logs(limit: int = 200) -> list[dict]:
    """Return recent governance interaction logs."""
    if not SUPABASE_DB_URL:
        return []
    try:
        ensure_table()
    except Exception as e:
        log.warning("interaction_logs ensure_table failed: %s", e)
        return []
    with _cursor() as cur:
        cur.execute(f"""
            SELECT id, user_name, action_type, route, workflow_mode,
                   document_id, tracking_id, finding_id, doc_layer, metadata, created_at
            FROM public.{TABLE_NAME}
            ORDER BY created_at DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()
    result = []
    for r in rows:
        metadata = r.get("metadata")
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata) if metadata else {}
            except json.JSONDecodeError:
                metadata = {}
        result.append({
            "id": str(r.get("id", "")),
            "user_name": r.get("user_name") or "",
            "action_type": r.get("action_type") or "",
            "route": r.get("route") or "",
            "workflow_mode": r.get("workflow_mode") or "",
            "document_id": r.get("document_id") or "",
            "tracking_id": r.get("tracking_id") or "",
            "finding_id": r.get("finding_id") or "",
            "doc_layer": r.get("doc_layer") or "",
            "metadata": metadata or {},
            "created_at": r.get("created_at").isoformat() if r.get("created_at") else "",
        })
    return result
