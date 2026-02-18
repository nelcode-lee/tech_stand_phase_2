# Ingest API (for Workato)

Workato uses the **SharePoint connector** to list and download documents, then POSTs them to the Python RAG service. The service chunks, embeds, and writes to the vector store (**Supabase** with pgvector).

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/ingest` | Ingest a single document |
| POST | `/ingest/batch` | Ingest multiple documents in one request |
| GET | `/health` | Health check |

## Single document: POST /ingest

**Request body (JSON):**

```json
{
  "content": "Plain text body of the document (extract from SharePoint file/page).",
  "metadata": {
    "doc_layer": "sop",
    "sites": ["site_north", "site_south"],
    "policy_ref": "P-012",
    "document_id": "sharepoint-item-id-or-unique-id",
    "source_path": "/SOPs/SiteNorth/SOP-003.docx",
    "title": "SOP-003 Cleaning procedure",
    "library": "SOPs"
  }
}
```

- **content**: Required. Plain text only (no HTML). Workato should strip HTML or use file text extraction.
- **metadata.doc_layer**: One of `policy`, `principle`, `sop`, `work_instruction`.
- **metadata.sites**: List of site codes this document applies to.
- **metadata.policy_ref**: Optional; parent policy reference (e.g. P-012).
- **metadata.document_id**: Required. Unique id (e.g. SharePoint list item ID). Used for re-ingest (replacing existing chunks).
- **metadata.source_path**, **title**, **library**: Optional; improve retrieval and audit.

**Response (200):**

```json
{
  "ok": true,
  "chunks_ingested": 12,
  "document_id": "sharepoint-item-id-or-unique-id",
  "message": "Ingested 12 chunks"
}
```

## Batch: POST /ingest/batch

**Request body (JSON):**

```json
{
  "documents": [
    {
      "content": "...",
      "metadata": { "doc_layer": "policy", "sites": [], "document_id": "id1", ... }
    },
    {
      "content": "...",
      "metadata": { "doc_layer": "sop", "sites": ["site_a"], "document_id": "id2", ... }
    }
  ]
}
```

**Response (200):**

```json
{
  "ok": true,
  "total_chunks": 25,
  "documents_processed": 2,
  "errors": []
}
```

If some documents fail, `errors` contains messages; `ok` may be `false` but status code is still 200.

## Environment (Python service)

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI (or Azure) API key for embeddings |
| `OPENAI_API_BASE` | Optional; set for Azure OpenAI endpoint |
| `OPENAI_EMBEDDING_MODEL` | Default `text-embedding-3-small` |
| `SUPABASE_DB_URL` | Supabase PostgreSQL connection string (for pgvector). See [Supabase setup](supabase_setup.md). |

## Workato recipe flow (high level)

1. Trigger: schedule or “Run recipe” for full backfill.
2. SharePoint connector: list items from library (e.g. Policies, Principles, SOPs, WorkInstructions) with columns: doc_layer, sites, policy_ref, document_id, title, path.
3. For each item (or batch): download file content → extract text (or use connector’s text output).
4. HTTP connector: POST to `https://<your-railway-app>/ingest` or `/ingest/batch` with body as above.
5. On publish (future): when a document is approved and published, trigger same flow for that document to re-ingest.
