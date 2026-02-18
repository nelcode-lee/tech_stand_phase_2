# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────┐
│  FRONT END                                          │
│  Workato Genie                                      │
│  Captures: request type, doc layer, site(s),        │
│  policy ref, urgency, attached sources              │
└──────────────────────┬──────────────────────────────┘
                       │ webhook POST
┌──────────────────────▼──────────────────────────────┐
│  ORCHESTRATION                                      │
│  Workato Recipe                                     │
│  • Routes by request type                           │
│  • Manages HITL state machine                       │
│  • Sends Teams Adaptive Cards                       │
│  • Handles timeouts and escalation                  │
│  • Publishes to SharePoint on approval              │
└────────┬────────────────────────────────────────────┘
         │ HTTP POST /analyse or /draft
┌────────▼────────────────────────────────────────────┐
│  PYTHON RAG SERVICE  (Railway)                      │
│                                                     │
│  FastAPI app                                        │
│  ├── RAG Retriever (Graph API + vector search)      │
│  └── Agent Pipeline                                 │
│       ├── Router (selective agent activation)       │
│       ├── Cleansing Agent                           │
│       ├── Terminology Agent                         │
│       ├── Conflict Agent                            │
│       ├── Risk Agent                                │
│       ├── Specifying Agent                          │
│       ├── Sequencing Agent                          │
│       ├── Formatting Agent                          │
│       └── Validation Agent                          │
└────────┬────────────────────────────────────────────┘
         │ Graph API
┌────────▼────────────────────────────────────────────┐
│  SHAREPOINT ONLINE                                  │
│  ├── /Policies/                                     │
│  ├── /Principles/                                   │
│  ├── /SOPs/                                         │
│  ├── /WorkInstructions/                             │
│  ├── /Staging/          ← drafts land here          │
│  ├── /Archive/          ← superseded versions       │
│  └── Lists/             ← relationship map, audit   │
└─────────────────────────────────────────────────────┘
```

---

## Request Flow

### 1. Intake (Workato)
User submits via Genie. Recipe validates payload, enriches with Azure AD profile, assigns `tracking_id`, routes by request type.

Request types:
- `new_document` — full pipeline
- `update_existing` — RAG pulls current version as additional context
- `contradiction_flag` — skip draft, run analysis only
- `review_request` — route directly to HITL

### 2. RAG Retrieval (Python)
On `/analyse` call, the retriever:
1. Queries SharePoint for documents matching: same layer, same site(s), same policy ref
2. Additionally pulls: parent policy, sibling documents from other sites (same layer)
3. Chunks and embeds all retrieved content
4. Returns ranked chunks to the pipeline context

### 3. Agent Pipeline (Python)
Router activates agents based on request type. See [`agents/pipeline-overview.md`](agents/pipeline-overview.md) for routing logic. Each agent receives a `PipelineContext` and returns an enriched version. Pipeline returns a single structured JSON report to Workato.

### 4. HITL (Workato)
Recipe enters Wait state. Teams Adaptive Card sent to author and SME(s). Review states:
```
DRAFT → IN_REVIEW → CHANGES_REQUIRED → SME_APPROVED → PUBLISHED
                  ↑_______loop__________|
```
Timeout: 5 days → reminder → escalate to Standards Manager.

### 5. Publish (Workato + SharePoint)
On approval:
- Doc moved from `/Staging/` to live library
- Version incremented (0.x → 1.0, or n.0 → n+1.0)
- Prior version archived
- Relationship map updated
- Cascade check: if Principle published, are SOPs present for all affected sites?
- Stakeholder notifications sent
- Review cycle trigger scheduled (default: 12 months)

---

## Data Flow: PipelineContext

The canonical data object passed through the entire Python layer:

```python
class PipelineContext(BaseModel):
    # Request
    tracking_id: str
    request_type: RequestType
    doc_layer: DocLayer
    sites: list[str]
    policy_ref: str | None
    
    # Retrieved docs
    retrieved_chunks: list[DocumentChunk]
    parent_policy: Document | None
    sibling_docs: list[Document]
    
    # Agent outputs (populated as pipeline runs)
    cleansed_content: str | None
    terminology_flags: list[TerminologyFlag]
    conflicts: list[Conflict]
    risk_scores: list[RiskScore]
    draft_content: str | None
    validation_result: ValidationResult | None
    
    # Pipeline state
    errors: list[PipelineError]
    warnings: list[str]
    agents_run: list[str]
    draft_ready: bool
```

---

## Multi-Site Variance

Sites may legitimately implement the same Principle differently. The system handles this via a `variance_reason` metadata field. The Conflict agent classifies cross-site differences as:

- `UNSANCTIONED_CONFLICT` — same requirement, incompatible approach, no recorded variance
- `SANCTIONED_VARIANCE` — difference is intentional and recorded
- `PENDING_REVIEW` — difference detected, variance status unknown

Only `UNSANCTIONED_CONFLICT` blocks the draft pipeline.

---

## Technology Choices

| Component | Dev | Production |
|-----------|-----|-----------|
| Vector store | Supabase (pgvector) | Supabase (pgvector) |
| LLM | GPT-4o | Azure OpenAI GPT-4o |
| Embeddings | text-embedding-3-small | Azure OpenAI |
| Doc generation | python-docx | python-docx |
| API framework | FastAPI | FastAPI |
| Hosting | Railway | Railway |
