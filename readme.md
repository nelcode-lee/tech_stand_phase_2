# Tech Standards Phase 2

RAG ingestion (Workato → Python) and agent pipeline for tech standards. See [Architecture.md](Architecture.md) and [pipeline_overview.md](pipeline_overview.md).

## RAG ingestion (this phase)

- **Workato**: SharePoint connector lists and downloads documents, POSTs to Python.
- **Python**: `POST /ingest` and `POST /ingest/batch` accept document content + metadata, chunk, embed (OpenAI), and write to **Supabase** (pgvector).

### Run locally

```bash
# From project root
pip install -e .
# Set OPENAI_API_KEY and SUPABASE_DB_URL (see .env.example and docs/supabase_setup.md)
uvicorn main:app --reload
```

- Health: [http://localhost:8000/health](http://localhost:8000/health)
- OpenAPI: [http://localhost:8000/docs](http://localhost:8000/docs)
- Ingest: `POST http://localhost:8000/ingest` — see [docs/ingest_api.md](docs/ingest_api.md) for the contract for Workato.

### Env

Copy `.env.example` to `.env` and set `OPENAI_API_KEY` and `SUPABASE_DB_URL`. See `docs/supabase_setup.md` for Supabase. Optionally `OPENAI_API_BASE` (Azure), `OPENAI_EMBEDDING_MODEL`.

## Next

- Retriever: query Supabase (vecs/pgvector) by vector + metadata (doc_layer, sites, policy_ref) for `/analyse`.
- Agent pipeline: cleansing, terminology, conflict, risk, specifying, sequencing, formatting, validation.
