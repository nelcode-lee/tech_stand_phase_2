# Tech Standards Phase 2 — Project Summary

**For:** Progress meeting  
**Date:** February 2025

---

## 1. What We Have Built

### 1.1 Python RAG Service (FastAPI)

A single service that:

- **Ingests** documents (plain text, DOCX, PDF) and stores them in a vector database.
- **Retrieves** relevant chunks by semantic search when analysing a topic.
- **Runs an 8-agent analysis pipeline** on document content and returns structured flags and recommendations.

**Tech stack:** FastAPI, OpenAI (embeddings + GPT-4o), Supabase (PostgreSQL + pgvector via vecs), Python 3.12.

---

### 1.2 Document Ingestion

| Capability | Description |
|------------|-------------|
| **POST /ingest** | Ingest one document (JSON: plain text + metadata). |
| **POST /ingest/batch** | Ingest multiple documents in one request. |
| **POST /ingest/file** | Upload a single **DOCX or PDF**; text is extracted and ingested. |
| **Chunking** | Documents are split into ~400-token chunks with overlap. |
| **Embeddings** | OpenAI `text-embedding-3-small` (or configurable model). |
| **Vector store** | Chunks + embeddings stored in Supabase (`vecs.document_chunks`). |

**Local testing:**

- **scripts/ingest_folder.py** — Ingest all .txt, .docx, .pdf files from a folder (default: `sample_docs/`); creates vecs index when done.
- **scripts/create_vecs_index.py** — Create/rebuild the vector index (run after API ingests if needed).
- **scripts/ingest_docx.py** — Ingest one DOCX or PDF via the API.
- **scripts/find_term.py** — Search which document contains a given term (e.g. “Julian code”).

Sample documents have been ingested (FSP74, FSP048, FSP09, Cranswick Manufacturing Standard, BRCGS module, foreign body prevention, etc.) for RAG and agent testing.

---

### 1.3 Analysis Pipeline (POST /analyse)

**Input:** Either:

- Raw **content** (plain text), or  
- **Vector retrieval** (query + optional filters: doc_layer, sites, policy_ref).

**Output:** Structured JSON (and optional Markdown report) with:

| Output | Meaning |
|--------|--------|
| **specifying_flags** | Vague or unmeasurable language (e.g. “as per required frequency”, “adequate controls”). |
| **sequencing_flags** | Logical flow or step-order issues. |
| **formatting_flags** | Template/structure and presentation issues. |
| **compliance_flags** | Regulatory/compliance gaps (e.g. BRCGS, customer specs). Each item may include **clause_mapping**: grounded link to `policy_clause_records` (lexical candidates → constrained LLM pick → verified quote) or **unmapped** for HITL. Env: `CLAUSE_MAPPING_ENABLED` (default true), `CLAUSE_MAPPING_CANDIDATE_LIMIT` (default 22). |
| **terminology_flags** | Terms used but undefined or inconsistent (with evidence: location quote). |
| **conflicts** | Cross-document contradictions (e.g. different check frequencies). |
| **risk_gaps** | Missing controls, accountability, or corrective actions. |
| **risk_scores** | Risk band (low/medium/high/critical) where applicable. |
| **draft_ready** | Whether the analysis allows the draft to proceed. |
| **overall_risk** | Overall risk level. |

**8 agents (Cranswick-focused prompts):** Cleansing, Terminology, Conflict, Risk, Specifying, Sequencing, Formatting, Validation. Router runs the right set by request type and doc layer (e.g. sequencing skipped for policy/principle).

**Guardrails:** Terminology agent only flags terms that **appear in the document**; each flag includes a **location** (exact quote). Invented terms are filtered out.

**Agent context limits (procedure text):** Agents no longer hard-cap SOP text at ~12k characters. By default they receive up to **120,000 characters** of cleansed/draft content per call, and larger parent-policy excerpts (**16k chars per policy document**, **48k** for combined policy appendix), so findings can use material from later in the document. Tunable via env: `AGENT_DOCUMENT_MAX_CHARS`, `AGENT_POLICY_APPENDIX_MAX_CHARS`, `AGENT_POLICY_CONTEXT_PER_DOC_MAX_CHARS` (see `src/pipeline/context_limits.py`). Set `AGENT_DOCUMENT_MAX_CHARS=0` for effectively no limit (capped at 2M chars as a safety ceiling).

**Finding verification (post-pipeline):** After deduplication, an extra pass (`finding_verification`) sends the **full procedure text** (same slice as agents) plus batched findings to the LLM. It **removes** items that are false positives because the document **already** states the missing limit/reference in the same flow (e.g. sub-steps 3a/3b immediately after step 3). Each removal requires a **verbatim quote** that is verified as a substring of the document. Env: `FINDING_VERIFICATION_ENABLED` (default true), `FINDING_VERIFICATION_BATCH_SIZE` (default 18). `overall_risk` is recomputed after risk gaps are removed.

---

### 1.4 Testing & Reporting

| Script / artefact | Purpose |
|-------------------|--------|
| **scripts/test_analyse.py** | Run analysis with a sample .txt (e.g. foreign body prevention). |
| **scripts/test_analyse_packaging_principle.py** | Run analysis for packaging/labelling using vector retrieval (no content in request). |
| **scripts/export_analysis_report.py** | Convert analysis JSON → structured **Markdown** report. |
| **test_result_packaging_principle.json** | Example full analysis response. |
| **test_result_packaging_principle.md** | Example human-readable report. |

---

### 1.5 API Endpoints (current)

| Method | Path | Purpose |
|--------|------|---------|
| GET | /health | Health check. |
| POST | /ingest | Ingest one document (JSON: content + metadata). |
| POST | /ingest/file | Ingest one DOCX or PDF (multipart upload). |
| POST | /ingest/batch | Ingest multiple documents (JSON). |
| POST | /analyse | Run RAG + agent pipeline (content, or vector retrieval). |

---

## 2. What It Does (Value)

- **Single source of truth for analysis:** One service performs chunking, embedding, retrieval, and all 8 analysis types.
- **RAG over your documents:** Semantic search pulls relevant chunks (e.g. packaging/labelling) from ingested SOPs, standards, and PDFs.
- **Structured, auditable output:** Flags and recommendations are JSON (and Markdown) so they can drive workflows, review, and reporting.
- **Ready for automation:** APIs are designed for Workato (or similar) to call `/ingest` and `/analyse` and to consume the response (e.g. draft_ready, conflicts, terminology_flags).
- **Safe terminology reporting:** Only terms that actually appear in the text are flagged, with a quoted location.

**Example use case:** “Build a principle for packaging and labelling” → call `/analyse` with a packaging/labelling query → retrieve relevant chunks from FSP74, Cranswick Manufacturing Standard, etc. → get specifying, sequencing, formatting, compliance, terminology, conflict, and risk outputs in one response and in a Markdown report.

---

## 3. What’s Left To Do

### 3.1 Workato & SharePoint

| Item | Status |
|------|--------|
| Workato Genie (intake form) | Not built. |
| Workato recipe (orchestration + HITL) | Spec written (`workato_recipe_spec.md`); recipe not implemented. |
| SharePoint connector in Workato | List/download docs, extract text, POST to `/ingest` — in progress / not wired end-to-end. |
| Teams Adaptive Cards (HITL) | Not built. |

### 3.2 Draft & Publish

| Item | Status |
|------|--------|
| **POST /draft** | Not built. Intended: generate DOCX from analysis and upload to SharePoint `/Staging/`. |
| Golden templates | DOCX templates per layer (Policy, Principle, SOP, Work Instruction) — not created. |
| **GET /status/{tracking_id}** | Not built. |
| Graph API (Python) | Azure AD app + SharePoint upload/publish — not implemented. |

### 3.3 Operational

| Item | Status |
|------|--------|
| Automated tests | No `pytest` suite yet. |
| Deployment | Not on Railway or similar; run locally / on internal host. |
| vecs index | `create_index()` called after folder ingest and via `scripts/create_vecs_index.py`. |

---

## 4. Recommended Next Steps

1. **Workato ingest recipe** — Complete SharePoint → `/ingest` (or `/ingest/file`) so live docs can backfill the vector store.
2. **vecs index** — Index is created by `ingest_folder.py` after bulk run; for API-only ingests run `python scripts/create_vecs_index.py` after bulk load.
3. **Workato Genie + recipe** — Intake form and lifecycle recipe (analyse → draft → HITL → publish) per spec.
4. **POST /draft** — DOCX generation from analysis + upload to SharePoint staging.
5. **Graph API + SharePoint** — Direct upload/publish and metadata if needed beyond Workato.

---

## 5. References

- **PROJECT_REVIEW.md** — Detailed done/pending and env vars.
- **workato_recipe_spec.md** — Full recipe steps, triggers, connectors.
- **docs/ingest_api.md** — Ingest API (including `/ingest/file`).
- **docs/supabase_setup.md** — Supabase and pgvector setup.
