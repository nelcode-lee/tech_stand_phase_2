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
    """Summarise gap-level HACCP RPN bands from stored analysis JSON for dashboard aggregation."""
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


def _normalise_result_json(result_json_raw) -> dict:
    result_json = result_json_raw
    if isinstance(result_json, str):
        try:
            result_json = json.loads(result_json) if result_json else {}
        except json.JSONDecodeError:
            result_json = {}
    if not isinstance(result_json, dict):
        result_json = {}
    return result_json


HARMONISATION_STANDARD_BUCKETS = ("brcgs", "cranswick_ms", "supermarket", "other")

HARMONISATION_STANDARD_LABELS = {
    "brcgs": "BRCGS",
    "cranswick_ms": "Cranswick Manufacturing Standard",
    "supermarket": "Supermarket / customer codes",
    "other": "Other standards",
}


def _empty_harmonisation_status_counts() -> dict:
    return {
        "covered": 0,
        "partial": 0,
        "missing": 0,
        "conflict": 0,
        "not_applicable": 0,
    }


def _harmonisation_score_from_counts(status_counts: dict) -> float:
    total = sum(status_counts.values())
    if total == 0:
        return 0.0
    return round(
        (
            (status_counts["covered"] + 0.5 * status_counts["partial"] + status_counts["not_applicable"])
            / total
        )
        * 100.0,
        1,
    )


def _classify_harmonisation_standard_bucket(
    standard_name: str | None,
    policy_document_id: str | None,
    citation: str | None,
    issue: str | None = None,
) -> str:
    """
    Map clause-mapping metadata to a coarse standard family for multi-standard harmonisation UI.
    Order: BRCGS, Cranswick MS, supermarket / customer, then other.
    """
    parts = [standard_name or "", policy_document_id or "", citation or "", issue or ""]
    bag = " ".join(parts).lower()

    if "brcgs" in bag or "brc global" in bag or "brc food" in bag:
        return "brcgs"
    if "brc" in bag and ("global standard" in bag or "food safety" in bag):
        return "brcgs"

    if "cranswick" in bag or "manufacturing standard" in bag or "cms " in bag or "cms-" in bag or "cmsv" in bag:
        return "cranswick_ms"
    if "14286_cranswick" in bag or "cranswick_manufacturing" in bag.replace(" ", "_"):
        return "cranswick_ms"

    _retail = (
        "supermarket",
        "customer code",
        "retailer specification",
        "customer standard",
        "buyer requirement",
        "marks & spencer",
        "marks and spencer",
        "m&s ",
        " tesco",
        "tesco ",
        "sainsbury",
        " asda",
        "asda ",
        "morrisons",
        "waitrose",
        " aldi",
        "aldi ",
        " lidl",
        "lidl ",
        "co-op",
        "costco",
        " iceland",
    )
    if any(k in bag for k in _retail):
        return "supermarket"

    return "other"


def _build_harmonisation_from_result(result_json: dict) -> dict:
    compliance_flags = result_json.get("compliance_flags") or []
    if not isinstance(compliance_flags, list):
        compliance_flags = []

    status_counts = _empty_harmonisation_status_counts()
    by_standard: dict[str, dict] = {
        k: _empty_harmonisation_status_counts() for k in HARMONISATION_STANDARD_BUCKETS
    }
    top_gaps = []

    for f in compliance_flags:
        if not isinstance(f, dict):
            continue
        cm = f.get("clause_mapping") if isinstance(f.get("clause_mapping"), dict) else {}
        cm_status = str(cm.get("status") or "").strip().lower()
        issue_text = str(f.get("issue") or "").strip().lower()
        issue_raw = f.get("issue")
        std_name = cm.get("standard_name")
        if isinstance(std_name, str):
            std_name = std_name.strip() or None
        cite = cm.get("canonical_citation")
        bucket = _classify_harmonisation_standard_bucket(
            std_name,
            cm.get("policy_document_id"),
            cite if isinstance(cite, str) else None,
            issue_raw if isinstance(issue_raw, str) else None,
        )

        if cm_status == "linked":
            status = "covered"
        else:
            if "not applicable" in issue_text or "n/a" in issue_text:
                status = "not_applicable"
            elif "partial" in issue_text:
                status = "partial"
            elif "conflict" in issue_text or "contradict" in issue_text:
                status = "conflict"
            else:
                status = "missing"

        status_counts[status] += 1
        by_standard[bucket][status] += 1

        if status in ("missing", "conflict", "partial"):
            top_gaps.append(
                {
                    "policy_document_id": cm.get("policy_document_id"),
                    "clause_id": cm.get("clause_id"),
                    "citation": cm.get("canonical_citation"),
                    "standard_name": std_name,
                    "standard_bucket": bucket,
                    "status": status,
                    "issue": f.get("issue"),
                    "location": f.get("location"),
                    "recommended_action": f.get("recommendation"),
                }
            )

    total = sum(status_counts.values())
    score = _harmonisation_score_from_counts(status_counts)
    gate_passed = status_counts["conflict"] == 0 and status_counts["missing"] == 0

    by_standard_payload: dict[str, dict] = {}
    for key in HARMONISATION_STANDARD_BUCKETS:
        c = by_standard[key]
        subtotal = sum(c.values())
        by_standard_payload[key] = {
            "label": HARMONISATION_STANDARD_LABELS.get(key, key),
            "total_clauses": subtotal,
            "covered": c["covered"],
            "partial": c["partial"],
            "missing": c["missing"],
            "conflict": c["conflict"],
            "not_applicable": c["not_applicable"],
            "harmonisation_score": _harmonisation_score_from_counts(c),
            "gate_passed": c["conflict"] == 0 and c["missing"] == 0,
        }

    return {
        "total_clauses": total,
        "status_counts": status_counts,
        "harmonisation_score": score,
        "gate_passed": gate_passed,
        "top_gaps": top_gaps[:20],
        "by_standard": by_standard_payload,
    }


def get_harmonisation_scorecard(document_id: str, site: str = "", doc_layer: str = "") -> dict | None:
    """
    Build a harmonisation scorecard from the latest persisted analysis session for a document.
    Uses compliance flag clause_mapping status as the first-pass harmonisation signal.
    """
    doc_id = (document_id or "").strip()
    if not doc_id:
        return None
    site_value = (site or "").strip()
    doc_layer_value = (doc_layer or "").strip()
    try:
        ensure_table()
        with _cursor() as cur:
            where = ["document_id = %s"]
            params: list = [doc_id]
            if doc_layer_value:
                where.append("doc_layer = %s")
                params.append(doc_layer_value)
            if site_value:
                where.append("sites ILIKE %s")
                params.append(f"%{site_value}%")
            query = (
                f"SELECT tracking_id, document_id, title, doc_layer, sites, completed_at, result_json "
                f"FROM public.{TABLE_NAME} "
                f"WHERE {' AND '.join(where)} "
                f"ORDER BY completed_at DESC LIMIT 1"
            )
            cur.execute(query, tuple(params))
            row = cur.fetchone()
    except Exception as e:
        log.warning("analysis_sessions get_harmonisation_scorecard failed: %s", e)
        return None

    if not row:
        return None

    metrics = _build_harmonisation_from_result(_normalise_result_json(row.get("result_json")))
    status_counts = metrics["status_counts"]

    return {
        "document_id": row.get("document_id") or doc_id,
        "title": row.get("title") or row.get("document_id") or "Unnamed",
        "doc_layer": row.get("doc_layer") or "sop",
        "sites": row.get("sites") or "",
        "tracking_id": row.get("tracking_id") or "",
        "summary": {
            "total_clauses": metrics["total_clauses"],
            "covered": status_counts["covered"],
            "partial": status_counts["partial"],
            "missing": status_counts["missing"],
            "conflict": status_counts["conflict"],
            "not_applicable": status_counts["not_applicable"],
            "harmonisation_score": metrics["harmonisation_score"],
            "gate_passed": metrics["gate_passed"],
        },
        "by_standard": metrics.get("by_standard") or {},
        "top_gaps": metrics["top_gaps"],
        "last_updated": row["completed_at"].isoformat() if row.get("completed_at") else datetime.now(timezone.utc).isoformat(),
    }


def get_harmonisation_trend(document_id: str, limit: int = 12, site: str = "", doc_layer: str = "") -> dict | None:
    """Return harmonisation trend points across recent sessions for a document."""
    doc_id = (document_id or "").strip()
    if not doc_id:
        return None
    points_limit = max(1, min(int(limit or 12), 36))
    site_value = (site or "").strip()
    doc_layer_value = (doc_layer or "").strip()
    try:
        ensure_table()
        with _cursor() as cur:
            where = ["document_id = %s"]
            params: list = [doc_id]
            if doc_layer_value:
                where.append("doc_layer = %s")
                params.append(doc_layer_value)
            if site_value:
                where.append("sites ILIKE %s")
                params.append(f"%{site_value}%")
            params.append(points_limit)
            query = (
                f"SELECT tracking_id, completed_at, result_json "
                f"FROM public.{TABLE_NAME} "
                f"WHERE {' AND '.join(where)} "
                f"ORDER BY completed_at DESC LIMIT %s"
            )
            cur.execute(query, tuple(params))
            rows = cur.fetchall() or []
    except Exception as e:
        log.warning("analysis_sessions get_harmonisation_trend failed: %s", e)
        return None

    points = []
    for r in reversed(rows):
        metrics = _build_harmonisation_from_result(_normalise_result_json(r.get("result_json")))
        points.append(
            {
                "tracking_id": r.get("tracking_id") or "",
                "completed_at": r["completed_at"].isoformat() if r.get("completed_at") else None,
                "harmonisation_score": metrics["harmonisation_score"],
                "total_clauses": metrics["total_clauses"],
                "missing": metrics["status_counts"]["missing"],
                "conflict": metrics["status_counts"]["conflict"],
            }
        )
    return {"document_id": doc_id, "points": points}
