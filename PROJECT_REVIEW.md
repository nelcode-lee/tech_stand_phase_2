# Tech Standards Phase 2 — Project Review

*Last updated: Feb 2025*

---

## Executive Summary

The Tech Standards platform is a RAG-based document authoring system for Cranswick. The Python service ingests documents, stores them in Supabase (pgvector), and runs an 8-agent pipeline for analysis. Core functionality is **working end-to-end**.

---

## Done

### Infrastructure & Configuration

- [x] **Supabase connection** — PostgreSQL + pgvector via vecs
  - Transaction pooler connection string configured
  - pgvector extension enabled
  - `load_dotenv` in `main.py` for reliable `.env` loading

- [x] **OpenAI** — Embeddings (text-embedding-3-small/ada-002) and LLM (gpt-4o)

- [x] **Environment** — `.env` and `.env.example` with required vars

### RAG (Retrieve / Ingest)

- [x] **Document ingestion**
  - `POST /ingest` — single document
  - `POST /ingest/batch` — multiple documents
  - Chunking, embedding, vector store upsert
  - Sample ingest script: `scripts/ingest_sample.py`

- [x] **Vector retrieval**
  - `src/rag/retriever.py` — semantic search over Supabase
  - Filters by `doc_layer`, `policy_ref`, `sites` (in Python; vecs filter constraints)
  - Used when `/analyse` receives no `content` or `retrieved_chunks`

- [x] **Vector store** — `document_chunks` collection; text stored in metadata for retrieval

### Agent Pipeline

- [x] **8 agents implemented** (all with Cranswick-specific prompts):
  - **Cleansing** — Structural cleanup + specification analysis
  - **Terminology** — Term consistency
  - **Conflict** — Cross-document contradictions
  - **Risk** — Gap analysis, risk scores
  - **Specifying** — Vague/unmeasurable language
  - **Sequencing** — Logical flow and step order
  - **Formatting** — Template compliance, structure
  - **Validation** — Regulatory/compliance + final gate

- [x] **Pipeline router** — Selective activation by request type and doc layer

- [x] **Output flags** — `terminology_flags`, `conflicts`, `risk_gaps`, `specifying_flags`, `sequencing_flags`, `formatting_flags`, `compliance_flags`

### API Endpoints

- [x] `GET /health` — Health check
- [x] `POST /ingest` — Ingest single document
- [x] `POST /ingest/batch` — Ingest batch
- [x] `POST /analyse` — Run pipeline (content, retrieved_chunks, or vector retrieval)

---

## Pending / Not Yet Built

### Workato Integration

- [ ] **Workato Genie** — Front-end intake form
- [ ] **Workato Recipe** — Orchestration, HITL state machine
- [ ] **SharePoint connector (Workato)** — List, download, extract text; POST to `/ingest`
- [ ] **Teams Adaptive Cards** — HITL review cards

### SharePoint Direct Integration (Python)

- [ ] **Microsoft Graph API** — Azure AD app, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID`
- [ ] **SharePoint retrieval** — Fetch docs by layer/site/policy_ref (optional supplement to vector store)
- [ ] **Upload to `/Staging/`** — DOCX output via Graph API
- [ ] **Publish flow** — Move from Staging to live library, archive old versions

### Draft & Publish

- [ ] `POST /draft` — Generate DOCX and upload to SharePoint staging
- [ ] Golden Template — DOCX template for Policy / Principle / SOP / Work Instruction
- [ ] `GET /status/{tracking_id}` — Request status lookup

### Operational

- [ ] **Tests** — `pytest tests/`
- [ ] **Deployment** — Railway or equivalent
- [ ] **vecs index** — `create_index()` for better query performance (warning currently logged)

---

## Environment Variables Reference

| Variable | Purpose | Status |
|----------|---------|--------|
| `OPENAI_API_KEY` | OpenAI API key | Required |
| `OPENAI_LLM_MODEL` | LLM model (e.g. gpt-4o) | Optional |
| `OPENAI_EMBEDDING_MODEL` | Embedding model | Optional |
| `SUPABASE_DB_URL` | PostgreSQL connection string | Required |
| `SUPABASE_ANON_KEY` | (Future: Supabase client) | Not used yet |
| `SUPABASE_SERVICE_KEY` | (Future: Supabase client) | Not used yet |
| `SUPABASE_STORAGE_BUCKET` | (Future: storage) | Not used yet |
| `GRAPH_CLIENT_ID` | (Future: Graph API) | Not configured |
| `GRAPH_CLIENT_SECRET` | (Future: Graph API) | Not configured |
| `GRAPH_TENANT_ID` | (Future: Graph API) | Not configured |
| `SHAREPOINT_SITE_ID` | (Future: SharePoint) | Not configured |

---

## Quick Test Commands

```bash
# Connection test
python scripts/test_connection.py

# Ingest sample doc
python scripts/ingest_sample.py

# Start server
uvicorn main:app --reload

# POST /analyse (vector retrieval)
# Body: {"tracking_id":"test-001","request_type":"new_document","doc_layer":"sop","sites":["site_north"],"policy_ref":"P-001"}
```

---

## Next Steps (Recommended Order)

1. **Workato ingest recipe** — SharePoint → `/ingest` for initial backfill
2. **Create vecs index** — Call `collection.create_index()` after ingest for better performance
3. **Workato Genie + Recipe** — Intake, routing, HITL
4. **Graph API + SharePoint** — Direct retrieval/publish if needed
5. **`POST /draft`** — DOCX generation and upload
