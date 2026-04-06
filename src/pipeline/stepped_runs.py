"""Persist stepped pipeline runs (one agent per user step) — Supabase or local JSON files."""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import psycopg2
from psycopg2.extras import Json, RealDictCursor

from src.pipeline.models import PipelineContext

log = logging.getLogger(__name__)

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "").strip()
TABLE_NAME = "stepped_pipeline_runs"

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_LOCAL_DIR = _REPO_ROOT / "data" / "stepped_runs"


def _local_dir() -> Path:
    _LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    return _LOCAL_DIR


@dataclass
class SteppedRunState:
    run_id: str
    tracking_id: str
    next_step_index: int
    agent_sequence: list[str]
    request_meta: dict
    status: str  # in_progress | completed | failed
    context: PipelineContext


def context_to_dict(ctx: PipelineContext) -> dict:
    return ctx.model_dump(mode="json")


def context_from_dict(data: dict) -> PipelineContext:
    return PipelineContext.model_validate(data)


class SteppedRunStore(Protocol):
    def ensure_table(self) -> None: ...

    def create(
        self,
        *,
        tracking_id: str,
        context: PipelineContext,
        next_step_index: int,
        agent_sequence: list[str],
        request_meta: dict,
        status: str = "in_progress",
    ) -> str:
        """Returns run_id."""
        ...

    def update(
        self,
        run_id: str,
        *,
        context: PipelineContext,
        next_step_index: int,
        status: str | None = None,
    ) -> None:
        ...

    def get(self, run_id: str) -> SteppedRunState | None:
        ...


class SupabaseSteppedRunStore:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def _conn(self):
        return psycopg2.connect(self._dsn)

    def ensure_table(self) -> None:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS public.{TABLE_NAME} (
                        run_id TEXT PRIMARY KEY,
                        tracking_id TEXT NOT NULL,
                        context_json JSONB NOT NULL,
                        next_step_index INTEGER NOT NULL DEFAULT 0,
                        agent_sequence JSONB NOT NULL DEFAULT '[]',
                        request_meta JSONB NOT NULL DEFAULT '{{}}',
                        status TEXT NOT NULL DEFAULT 'in_progress',
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_tracking_id
                    ON public.{TABLE_NAME} (tracking_id)
                    """
                )
            conn.commit()
        finally:
            conn.close()

    def create(
        self,
        *,
        tracking_id: str,
        context: PipelineContext,
        next_step_index: int,
        agent_sequence: list[str],
        request_meta: dict,
        status: str = "in_progress",
    ) -> str:
        run_id = str(uuid.uuid4())
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO public.{TABLE_NAME}
                    (run_id, tracking_id, context_json, next_step_index, agent_sequence, request_meta, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_id,
                        tracking_id,
                        Json(context_to_dict(context)),
                        next_step_index,
                        Json(agent_sequence),
                        Json(request_meta),
                        status,
                    ),
                )
            conn.commit()
        finally:
            conn.close()
        return run_id

    def update(
        self,
        run_id: str,
        *,
        context: PipelineContext,
        next_step_index: int,
        status: str | None = None,
    ) -> None:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                if status is not None:
                    cur.execute(
                        f"""
                        UPDATE public.{TABLE_NAME}
                        SET context_json = %s, next_step_index = %s, status = %s, updated_at = NOW()
                        WHERE run_id = %s
                        """,
                        (Json(context_to_dict(context)), next_step_index, status, run_id),
                    )
                else:
                    cur.execute(
                        f"""
                        UPDATE public.{TABLE_NAME}
                        SET context_json = %s, next_step_index = %s, updated_at = NOW()
                        WHERE run_id = %s
                        """,
                        (Json(context_to_dict(context)), next_step_index, run_id),
                    )
            conn.commit()
        finally:
            conn.close()

    def get(self, run_id: str) -> SteppedRunState | None:
        conn = self._conn()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    f"""
                    SELECT run_id, tracking_id, context_json, next_step_index, agent_sequence, request_meta, status
                    FROM public.{TABLE_NAME}
                    WHERE run_id = %s
                    """,
                    (run_id,),
                )
                row = cur.fetchone()
        finally:
            conn.close()
        if not row:
            return None
        ctx = context_from_dict(row["context_json"])
        seq = row["agent_sequence"]
        if isinstance(seq, str):
            seq = json.loads(seq)
        meta = row["request_meta"]
        if isinstance(meta, str):
            meta = json.loads(meta)
        return SteppedRunState(
            run_id=row["run_id"],
            tracking_id=row["tracking_id"],
            next_step_index=int(row["next_step_index"]),
            agent_sequence=list(seq or []),
            request_meta=dict(meta or {}),
            status=row["status"] or "in_progress",
            context=ctx,
        )


class FileSteppedRunStore:
    """Dev fallback when SUPABASE_DB_URL is unset."""

    def ensure_table(self) -> None:
        _local_dir()

    def create(
        self,
        *,
        tracking_id: str,
        context: PipelineContext,
        next_step_index: int,
        agent_sequence: list[str],
        request_meta: dict,
        status: str = "in_progress",
    ) -> str:
        run_id = str(uuid.uuid4())
        path = _local_dir() / f"{run_id}.json"
        payload = {
            "run_id": run_id,
            "tracking_id": tracking_id,
            "context_json": context_to_dict(context),
            "next_step_index": next_step_index,
            "agent_sequence": agent_sequence,
            "request_meta": request_meta,
            "status": status,
        }
        path.write_text(json.dumps(payload, default=str), encoding="utf-8")
        return run_id

    def update(
        self,
        run_id: str,
        *,
        context: PipelineContext,
        next_step_index: int,
        status: str | None = None,
    ) -> None:
        path = _local_dir() / f"{run_id}.json"
        if not path.is_file():
            raise FileNotFoundError(run_id)
        raw = json.loads(path.read_text(encoding="utf-8"))
        raw["context_json"] = context_to_dict(context)
        raw["next_step_index"] = next_step_index
        if status is not None:
            raw["status"] = status
        path.write_text(json.dumps(raw, default=str), encoding="utf-8")

    def get(self, run_id: str) -> SteppedRunState | None:
        path = _local_dir() / f"{run_id}.json"
        if not path.is_file():
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        ctx = context_from_dict(raw["context_json"])
        return SteppedRunState(
            run_id=raw["run_id"],
            tracking_id=raw["tracking_id"],
            next_step_index=int(raw["next_step_index"]),
            agent_sequence=list(raw.get("agent_sequence") or []),
            request_meta=dict(raw.get("request_meta") or {}),
            status=raw.get("status") or "in_progress",
            context=ctx,
        )


def get_stepped_run_store() -> SteppedRunStore:
    if SUPABASE_DB_URL:
        return SupabaseSteppedRunStore(SUPABASE_DB_URL)
    log.info("SUPABASE_DB_URL not set — using file-backed stepped run store under %s", _LOCAL_DIR)
    return FileSteppedRunStore()
