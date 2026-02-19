# Technical Standards Platform

A RAG-based document authoring and governance system for managing technical standards across multiple retail sites. Evolves a chat-only standards agent into a full document lifecycle system with version control, contradiction detection, and human-in-the-loop review.

---

## What This System Does

- **Receives** document requests (new doc, update, contradiction flag, review) via Workato Genie
- **Retrieves** relevant context from a controlled SharePoint document library using RAG
- **Analyses** for contradictions, gaps, and terminology inconsistencies across sites and document layers
- **Drafts** structured documents using layer-appropriate templates (Policy / Principle / SOP)
- **Routes** drafts through a HITL approval workflow managed by Workato
- **Publishes** approved documents to SharePoint with full metadata, version control, and relationship mapping
- **Schedules** review cycles and cascades gap flags when new Principles are published without downstream SOPs

---

## Document Hierarchy

```
POLICY
  └─ PRINCIPLE   ← bridge layer being built out (intent + rationale)
       └─ SOP    ← site-specific operational procedure
            └─ WORK INSTRUCTION
```

Every document in the system is tagged to a layer and must reference its parent. This lineage is queryable by the RAG engine and enforced by the Validation agent.

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full system diagram.

**Short version:**

```
Workato Genie (front end)
    ↓ webhook
Workato Recipe (orchestration + HITL state machine)
    ↓ HTTP POST
Python RAG Service (Railway)
    ↓ Graph API
SharePoint Document Library (document store + metadata)
```

---

## Key Docs

| Doc | Purpose |
|-----|---------|
| [`docs/architecture.md`](docs/architecture.md) | System design and data flow |
| [`docs/sharepoint-schema.md`](docs/sharepoint-schema.md) | Metadata schema for all document libraries |
| [`docs/workato-recipe-spec.md`](docs/workato-recipe-spec.md) | Recipe structure, triggers, connectors |
| [`docs/agents/pipeline-overview.md`](docs/agents/pipeline-overview.md) | Agent pipeline design and routing logic |
| [`docs/agents/`](docs/agents/) | Individual agent specs |

---

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Copy and fill env vars
cp .env.example .env

# Run locally
uvicorn src.main:app --reload

# Run tests
pytest tests/
```

---

## Environment Variables

See `.env.example` for the full list. Key vars:

| Variable | Purpose |
|----------|---------|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI API endpoint |
| `AZURE_OPENAI_KEY` | Azure OpenAI API key |
| `GRAPH_CLIENT_ID` | Azure AD app registration for Graph API |
| `GRAPH_CLIENT_SECRET` | Graph API secret |
| `GRAPH_TENANT_ID` | Azure AD tenant |
| `SHAREPOINT_SITE_ID` | Target SharePoint site |
| `VECTOR_STORE_PATH` | Local ChromaDB path (dev) |
| `AZURE_SEARCH_ENDPOINT` | Azure AI Search endpoint (prod) |

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/analyse` | Run RAG + agent pipeline, return structured report |
| `POST` | `/draft` | Generate DOCX and upload to SharePoint staging |
| `GET` | `/health` | Health check |
| `GET` | `/status/{tracking_id}` | Request status lookup |
