# Phase 3 — Enterprise plumbing: Technical Standards Agent

This document maps how the working demo evolves into an **enterprise-grade** service in a **Microsoft-heavy** estate: governed identity, least-privilege access, approved hosting, and a controlled path from **Supabase + OpenAI** toward **Azure-native** data and **Azure AI Foundry**.

---

## 1. Purpose

- Retain the **Technical Standards Agent** (FastAPI pipeline, RAG, harmonisation, Workato-friendly APIs).
- Add **enterprise plumbing**: SSO, permissions, hosting, and AI/data platforms under corporate contract and network policy.

---

## 2. Current demo plumbing (baseline)

| Layer | Today (typical) |
|--------|------------------|
| App | FastAPI — ingest, `/analyse`, sessions, harmonisation APIs (`main.py`) |
| Orchestration | Workato — webhooks, HTTP to `/analyse`, Teams/HITL (`workato_recipe_spec.md`) |
| Data | Postgres via `SUPABASE_DB_URL` — registry, `document_content`, analysis sessions, policy clauses; vectors via **vecs** / pgvector on Postgres |
| AI | `openai` SDK — chat + embeddings; **`OPENAI_API_BASE`** supports Azure OpenAI–style routing (`src/pipeline/llm.py`, `src/rag/embedding.py`) |

Phase 3 **replaces or hardens** the data and AI rows and **wraps** the app in enterprise identity and hosting.

---

## 3. Target logical architecture

```
Users (Entra ID)
    → Enterprise front door (e.g. Azure Front Door + WAF, or APIM)
    → SPA / optional Teams / Workato-triggered flows
    → [AuthZ] Entra ID app roles + groups → API permissions
    → FastAPI (container) — Technical Standards Agent
    → Postgres (pgvector) OR Azure AI Search — RAG store
    → Azure AI Foundry — chat + embeddings (+ optional content filter / eval hooks)
    → Workato — workflow, notifications, SharePoint handoffs (not the SSO authority)
```

**Principle:** Workato is **integration and workflow**; **Entra ID** is **sign-in and coarse authorization**; the **API** enforces **document/site scope** and **role claims**.

---

## 4. Sign-on, permissions, and API security

### 4.1 Sign-on (SSO)

- **Microsoft Entra ID** as IdP for human-facing UI.
- **OIDC** in the SPA (e.g. MSAL): acquire **access tokens** for the FastAPI resource (audience = API app registration).
- Workato flows use a **service identity**: **client credentials** or Workato’s **Azure AD** connector with a **dedicated app registration** and narrow API permissions.

### 4.2 Permissions model (suggested)

- **App roles** on the API registration, e.g. `Standards.Reader`, `Standards.Analyst`, `Standards.Admin`, `Integration.Workato`.
- Map **Entra groups** → roles.
- **Resource-level rules** in the API: restrict `document_id` / `sites` / `library` using claims; avoid per-request Graph storms (cache directory lookups).
- **Workato** machine identity is usually **not** end-user delegated unless you implement on-behalf-of; for HITL, store **who approved** in Teams as audit metadata.

### 4.3 API hardening

- No anonymous `/analyse` in production; avoid long-lived shared secrets except tightly scoped integration.
- **mTLS or private link** between Workato egress and the API if required.
- **Rate limits**, payload limits, **correlation IDs** (`tracking_id` already supports tracing).

---

## 5. Hosting (Microsoft-aligned)

### 5.1 Patterns

- **Azure Container Apps** or **App Service (Linux)** for FastAPI; **Azure Container Registry**; CI/CD from your pipeline.
- **Key Vault** for secrets (database, Foundry keys, Workato shared secret if any).
- **Managed identity** for the app to read Key Vault and reach Azure OpenAI / Foundry where supported.
- **Private endpoints** for Postgres and AI endpoints when policy forbids public data planes.

### 5.2 Environments

- **Dev / Test / Prod** with separate Foundry projects or deployments, separate databases, and no production keys in lower environments.

### 5.3 Observability

- **Application Insights**: traces, LLM latency, failures.
- Structured logs: `tracking_id`, `document_id`, user/tenant identifiers (hashed if required for privacy).

---

## 6. Workato in Phase 3

Keep Workato for:

- Intake webhooks, **Teams** adaptive cards, scheduling, **SharePoint** file URLs.
- **Azure AD** enrichment (display name, department) as directory source of truth for submitter context.
- **HTTP** to the API.

**Enterprise changes:**

- Replace “public URL + implicit trust” with **OAuth2 client credentials** to the API app registration.
- Allow-listed egress; production base URL points at **private** or **front-door** endpoint.

See `workato_recipe_spec.md` for the current lifecycle; extend it with an explicit **token acquisition** step before `POST /analyse`.

---

## 7. Data plane: moving off Supabase

Supabase here is effectively **Postgres + pgvector**. Migration is **same logical stack on Azure**.

### Option A — Azure Database for PostgreSQL Flexible Server + pgvector (recommended first)

- Migrate tables used today: documents registry, `document_content`, `analysis_sessions`, `policy_clause_records`, vector chunks (e.g. `vecs.document_chunks` or equivalent).
- Point application config at a single connection string (consider renaming `SUPABASE_DB_URL` → `DATABASE_URL` for clarity in Phase 3).
- If embedding model or dimension changes, **re-embed** all chunks; `EMBEDDING_DIMENSION` in `src/rag/vector_store.py` must match the deployment (default **1536** for `text-embedding-3-small`).

### Option B — Azure AI Search

- Vectors + optional hybrid search in Search; relational metadata stays in Postgres.
- Larger change: retriever (`src/rag/retriever.py`, `src/rag/vector_store.py`) becomes a Search client; strong enterprise story if chunk-level ACL or advanced search is required.

**Plumbing-first path:** Option A, then reassess Search if needed.

---

## 8. AI plane: OpenAI → Azure AI Foundry

The codebase uses the **OpenAI-compatible** Python client with optional **`OPENAI_API_BASE`** — the usual bridge to **Azure OpenAI**; Foundry exposes **deployments** with base URL + key or Entra auth depending on configuration.

### 8.1 Workstreams

- **Chat:** map `OPENAI_LLM_MODEL` / `OPENAI_DRAFT_LLM_MODEL` to **Foundry deployment names** (often differ from public OpenAI model ids).
- **Embeddings:** map `OPENAI_EMBEDDING_MODEL` to the embedding deployment; confirm **vector dimension** matches the store.
- **Content safety:** enable filters and logging in Foundry; align with DLP / PII policy for document text in prompts.
- **Capacity:** size TPM for parallel agents (multiple LLM calls per analysis run).

### 8.2 Secrets and network

- Prefer **managed identity** + RBAC to Foundry where available; otherwise Key Vault–backed API keys.
- **Private** endpoints if infosec mandates.

### 8.3 Model versioning and evaluation

- Pin deployment/version per environment.
- Add regression checks (golden SOPs, JSON schema / finding sanity) before promoting deployments.

---

## 9. Phased delivery (suggested)

| Phase | Scope | Outcome |
|--------|--------|--------|
| **3a** | Entra ID on UI + API JWT validation; Key Vault; prod-like hosting | No open API |
| **3b** | Workato → API with client credentials; audit fields | Governed automation |
| **3c** | Azure Postgres + pgvector; connection cutover | Data under enterprise DBA |
| **3d** | Azure AI Foundry for chat + embeddings; retire public OpenAI | AI under enterprise contract |
| **3e** (optional) | AI Search, chunk-level ACL, DR runbooks | Scale and compliance extras |

Run **3c** and **3d** in non-production first; plan a **re-embedding** window if the embedding deployment changes.

---

## 10. Decisions to lock early

- Ownership of API app registration and Workato service principal.
- Single-tenant Entra only vs B2B guests for external parties.
- PII in prompts — redaction vs policy exception.
- Retention and deletion for `result_json` / analysis sessions (GDPR, records management).
- DR targets (RPO/RTO) for Postgres and AI usage.

---

## 11. Codebase touchpoints (implementation)

| Area | Location |
|------|----------|
| LLM | `src/pipeline/llm.py` — `OPENAI_API_BASE`, `OPENAI_API_KEY`, model env vars |
| Embeddings | `src/rag/embedding.py` — same pattern |
| DB / registry / sessions | `src/rag/document_registry.py`, `src/rag/analysis_sessions.py` — `SUPABASE_DB_URL` |
| Vector store | `src/rag/vector_store.py` — dimension, vecs collection |
| Workato lifecycle | `workato_recipe_spec.md` — add OAuth2 to HTTP steps |

---

## 12. Document history

- **Created:** Phase 3 enterprise plumbing outline for Technical Standards Agent (identity, hosting, Workato, Postgres, Azure AI Foundry).
