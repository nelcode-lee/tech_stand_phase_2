"""Tech standards Phase 2 — FastAPI app. RAG ingest (Workato) + future /analyse pipeline."""
from fastapi import FastAPI
from src.rag.routes import router as ingest_router

app = FastAPI(
    title="Tech Standards RAG",
    description="Ingest API for Workato; RAG retriever and agent pipeline for /analyse.",
    version="0.1.0",
)

app.include_router(ingest_router)


@app.get("/health")
def health():
    return {"status": "ok"}
