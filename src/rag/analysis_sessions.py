"""Analysis sessions: persist analysis results for dashboard metrics."""
import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
TABLE_NAME = "analysis_sessions"


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
    """Create analysis_sessions table if not exists."""
    with _cursor() as cur:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS public.{TABLE_NAME} (
                tracking_id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                doc_layer TEXT NOT NULL DEFAULT 'sop',
                sites TEXT NOT NULL DEFAULT '',
                overall_risk TEXT,
                total_findings INTEGER NOT NULL DEFAULT 0,
                agents_run JSONB NOT NULL DEFAULT '[]',
                agent_findings JSONB NOT NULL DEFAULT '{{}}',
                workflow_type TEXT NOT NULL DEFAULT 'review',
                completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)


def record_session(
    tracking_id: str,
    document_id: str = "",
    title: str = "",
    doc_layer: str = "sop",
    sites: str = "",
    overall_risk: str | None = None,
    total_findings: int = 0,
    agents_run: list[str] | None = None,
    agent_findings: dict | None = None,
    workflow_type: str = "review",
) -> None:
    """Insert or update an analysis session record."""
    if not tracking_id:
        return
    ensure_table()
    agents_json = json.dumps(agents_run or [])
    findings_json = json.dumps(agent_findings or {})
    with _cursor() as cur:
        cur.execute(f"""
            INSERT INTO public.{TABLE_NAME} (
                tracking_id, document_id, title, doc_layer, sites,
                overall_risk, total_findings, agents_run, agent_findings,
                workflow_type, completed_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, NOW())
            ON CONFLICT (tracking_id) DO UPDATE SET
                document_id = EXCLUDED.document_id,
                title = EXCLUDED.title,
                doc_layer = EXCLUDED.doc_layer,
                sites = EXCLUDED.sites,
                overall_risk = EXCLUDED.overall_risk,
                total_findings = EXCLUDED.total_findings,
                agents_run = EXCLUDED.agents_run,
                agent_findings = EXCLUDED.agent_findings,
                workflow_type = EXCLUDED.workflow_type,
                completed_at = EXCLUDED.completed_at
        """, (
            tracking_id, document_id, title, doc_layer, sites,
            overall_risk, total_findings, agents_json, findings_json,
            workflow_type,
        ))


def list_sessions(limit: int = 50) -> list[dict]:
    """Return recent analysis sessions, newest first."""
    try:
        ensure_table()
    except Exception:
        return []
    with _cursor() as cur:
        cur.execute(f"""
            SELECT tracking_id, document_id, title, doc_layer, sites,
                   overall_risk, total_findings, agents_run, agent_findings,
                   workflow_type, completed_at
            FROM public.{TABLE_NAME}
            ORDER BY completed_at DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()

    result = []
    for r in rows:
        agents = r.get("agents_run")
        if isinstance(agents, str):
            try:
                agents = json.loads(agents) if agents else []
            except json.JSONDecodeError:
                agents = []
        elif agents is None:
            agents = []
        findings = r.get("agent_findings")
        if isinstance(findings, str):
            try:
                findings = json.loads(findings) if findings else {}
            except json.JSONDecodeError:
                findings = {}
        elif findings is None:
            findings = {}
        result.append({
            "trackingId": r["tracking_id"],
            "documentId": r["document_id"] or "",
            "title": r["title"] or r["document_id"] or "Unnamed",
            "docLayer": r["doc_layer"] or "sop",
            "sites": r["sites"] or "",
            "overallRisk": r["overall_risk"],
            "totalFindings": r["total_findings"] or 0,
            "agentsRun": agents,
            "agentFindings": findings,
            "workflowType": r["workflow_type"] or "review",
            "completedAt": r["completed_at"].isoformat() if r.get("completed_at") else None,
        })
    return result
