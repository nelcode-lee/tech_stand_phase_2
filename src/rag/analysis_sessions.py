"""Analysis sessions: persist analysis results for dashboard metrics."""
import json
import logging
import os

log = logging.getLogger(__name__)
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
TABLE_NAME = "analysis_sessions"


def _compute_risk_metrics(result_json: dict | None) -> dict | None:
    """Summarise gap-level FMEA from stored analysis JSON for dashboard aggregation."""
    if not result_json:
        return None
    gaps = result_json.get("risk_gaps") or []
    if not isinstance(gaps, list):
        gaps = []
    bands = {"low": 0, "medium": 0, "high": 0, "critical": 0}
    unknown_band = 0
    rpns: list[int] = []
    gap_count = 0
    for g in gaps:
        if not isinstance(g, dict):
            continue
        gap_count += 1
        b = (g.get("fmea_band") or "").lower().strip()
        if b in bands:
            bands[b] += 1
        else:
            unknown_band += 1
        score = g.get("fmea_score")
        try:
            if score is not None and int(score) > 0:
                rpns.append(int(score))
        except (TypeError, ValueError):
            pass
    return {
        "risk_gap_count": gap_count,
        "gaps_by_band": bands,
        "gaps_unknown_band": unknown_band,
        "max_rpn": max(rpns) if rpns else 0,
        "avg_rpn": round(sum(rpns) / len(rpns), 1) if rpns else 0.0,
    }


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
                requester TEXT NOT NULL DEFAULT '',
                doc_layer TEXT NOT NULL DEFAULT 'sop',
                sites TEXT NOT NULL DEFAULT '',
                overall_risk TEXT,
                total_findings INTEGER NOT NULL DEFAULT 0,
                agents_run JSONB NOT NULL DEFAULT '[]',
                agent_findings JSONB NOT NULL DEFAULT '{{}}',
                workflow_type TEXT NOT NULL DEFAULT 'review',
                result_json JSONB,
                completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute(f"""
            ALTER TABLE public.{TABLE_NAME}
            ADD COLUMN IF NOT EXISTS result_json JSONB
        """)
        cur.execute(f"""
            ALTER TABLE public.{TABLE_NAME}
            ADD COLUMN IF NOT EXISTS requester TEXT NOT NULL DEFAULT ''
        """)
        cur.execute(f"""
            ALTER TABLE public.{TABLE_NAME}
            ADD COLUMN IF NOT EXISTS corrections_implemented INTEGER NOT NULL DEFAULT 0
        """)
        cur.execute(f"""
            ALTER TABLE public.{TABLE_NAME}
            ADD COLUMN IF NOT EXISTS risk_metrics JSONB
        """)


def record_session(
    tracking_id: str,
    document_id: str = "",
    title: str = "",
    requester: str = "",
    doc_layer: str = "sop",
    sites: str = "",
    overall_risk: str | None = None,
    total_findings: int = 0,
    agents_run: list[str] | None = None,
    agent_findings: dict | None = None,
    workflow_type: str = "review",
    result_json: dict | None = None,
    corrections_implemented: int = 0,
) -> None:
    """Insert or update an analysis session record."""
    if not tracking_id:
        return
    if not SUPABASE_DB_URL:
        log.warning("SUPABASE_DB_URL not set — analysis sessions will not persist to database")
        return
    ensure_table()
    agents_json = json.dumps(agents_run or [])
    findings_json = json.dumps(agent_findings or {})
    result_json_str = json.dumps(result_json) if result_json else None
    corrections = max(0, int(corrections_implemented))
    with _cursor() as cur:
        cur.execute(f"""
            INSERT INTO public.{TABLE_NAME} (
                tracking_id, document_id, title, requester, doc_layer, sites,
                overall_risk, total_findings, agents_run, agent_findings,
                workflow_type, result_json, corrections_implemented, completed_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s::jsonb, %s, NOW())
            ON CONFLICT (tracking_id) DO UPDATE SET
                document_id = EXCLUDED.document_id,
                title = EXCLUDED.title,
                requester = EXCLUDED.requester,
                doc_layer = EXCLUDED.doc_layer,
                sites = EXCLUDED.sites,
                overall_risk = EXCLUDED.overall_risk,
                total_findings = EXCLUDED.total_findings,
                agents_run = EXCLUDED.agents_run,
                agent_findings = EXCLUDED.agent_findings,
                workflow_type = EXCLUDED.workflow_type,
                result_json = COALESCE(EXCLUDED.result_json, {TABLE_NAME}.result_json),
                corrections_implemented = EXCLUDED.corrections_implemented,
                completed_at = EXCLUDED.completed_at
        """, (
            tracking_id, document_id, title, requester or "", doc_layer, sites,
            overall_risk, total_findings, agents_json, findings_json,
            workflow_type, result_json_str, corrections,
        ))


def get_session(tracking_id: str) -> dict | None:
    """Return a single session with full result_json, or None if not found."""
    try:
        ensure_table()
    except Exception as e:
        log.warning("analysis_sessions ensure_table failed: %s", e)
        return None
    with _cursor() as cur:
        cur.execute(f"""
            SELECT tracking_id, document_id, title, requester, doc_layer, sites,
                   overall_risk, total_findings, agents_run, agent_findings,
                   workflow_type, result_json, corrections_implemented, risk_metrics, completed_at
            FROM public.{TABLE_NAME}
            WHERE tracking_id = %s
        """, (tracking_id,))
        r = cur.fetchone()
    if not r:
        return None
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
    result_json = r.get("result_json")
    if isinstance(result_json, str):
        try:
            result_json = json.loads(result_json) if result_json else None
        except json.JSONDecodeError:
            result_json = None
    risk_metrics = r.get("risk_metrics")
    if isinstance(risk_metrics, str):
        try:
            risk_metrics = json.loads(risk_metrics) if risk_metrics else None
        except json.JSONDecodeError:
            risk_metrics = None
    elif risk_metrics is not None and not isinstance(risk_metrics, dict):
        risk_metrics = None
    if risk_metrics is None and result_json:
        risk_metrics = _compute_risk_metrics(result_json)
    return {
        "trackingId": r["tracking_id"],
        "documentId": r["document_id"] or "",
        "title": r["title"] or r["document_id"] or "Unnamed",
        "requester": r.get("requester") or "",
        "docLayer": r["doc_layer"] or "sop",
        "sites": r["sites"] or "",
        "overallRisk": r["overall_risk"],
        "totalFindings": r["total_findings"] or 0,
        "agentsRun": agents,
        "agentFindings": findings,
        "workflowType": r["workflow_type"] or "review",
        "correctionsImplemented": r.get("corrections_implemented") or 0,
        "completedAt": r["completed_at"].isoformat() if r.get("completed_at") else None,
        "result": result_json,
        "riskMetrics": risk_metrics,
    }


def delete_sessions_for_non_policy_docs() -> int:
    """Delete analysis sessions for non-policy documents. Returns count deleted."""
    try:
        ensure_table()
        with _cursor() as cur:
            cur.execute(f"""
                DELETE FROM public.{TABLE_NAME}
                WHERE COALESCE(LOWER(doc_layer), 'sop') != 'policy'
            """)
            return cur.rowcount
    except Exception as e:
        log.warning("analysis_sessions delete_sessions_for_non_policy_docs failed: %s", e)
        return 0


def delete_all_sessions() -> int:
    """Delete all analysis sessions (reset dashboard metrics and clear Attention Required). Returns count deleted."""
    try:
        ensure_table()
        with _cursor() as cur:
            cur.execute(f"DELETE FROM public.{TABLE_NAME}")
            return cur.rowcount
    except Exception as e:
        log.warning("analysis_sessions delete_all_sessions failed: %s", e)
        return 0


def list_sessions(limit: int = 50) -> list[dict]:
    """Return recent analysis sessions, newest first. Returns [] if DB unavailable."""
    try:
        ensure_table()
        with _cursor() as cur:
            cur.execute(f"""
                SELECT tracking_id, document_id, title, requester, doc_layer, sites,
                       overall_risk, total_findings, agents_run, agent_findings,
                       workflow_type, corrections_implemented, completed_at
                FROM public.{TABLE_NAME}
                ORDER BY completed_at DESC
                LIMIT %s
            """, (limit,))
            rows = cur.fetchall()
    except Exception as e:
        log.warning("analysis_sessions list_sessions failed (DB may be unavailable): %s", e)
        return []

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
        risk_metrics = r.get("risk_metrics")
        if isinstance(risk_metrics, str):
            try:
                risk_metrics = json.loads(risk_metrics) if risk_metrics else None
            except json.JSONDecodeError:
                risk_metrics = None
        elif risk_metrics is not None and not isinstance(risk_metrics, dict):
            risk_metrics = None
        result.append({
            "trackingId": r["tracking_id"],
            "documentId": r["document_id"] or "",
            "title": r["title"] or r["document_id"] or "Unnamed",
            "requester": r.get("requester") or "",
            "docLayer": r["doc_layer"] or "sop",
            "sites": r["sites"] or "",
            "overallRisk": r["overall_risk"],
            "totalFindings": r["total_findings"] or 0,
            "agentsRun": agents,
            "agentFindings": findings,
            "workflowType": r["workflow_type"] or "review",
            "correctionsImplemented": r.get("corrections_implemented") or 0,
            "completedAt": r["completed_at"].isoformat() if r.get("completed_at") else None,
            "riskMetrics": risk_metrics,
        })
    return result
