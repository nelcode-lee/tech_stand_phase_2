"""Tech standards Phase 2 — FastAPI app. RAG ingest (Workato) + agent pipeline /analyse."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.rag.routes import router as ingest_router
from src.pipeline.routes import router as pipeline_router

app = FastAPI(
    title="Tech Standards RAG",
    description="Ingest API for Workato; RAG retriever and agent pipeline for /analyse.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(ingest_router)
app.include_router(pipeline_router)


@app.get("/health")
def health():
    """Liveness + whether Postgres (Supabase) is configured for ingest, sessions, and policy clauses."""
    db = bool((os.environ.get("SUPABASE_DB_URL") or "").strip())
    return {
        "status": "ok",
        "supabase_db_configured": db,
    }
