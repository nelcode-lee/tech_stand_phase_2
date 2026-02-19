# Sample Documents

Place sample documents here for local RAG ingestion testing (without Workato/SharePoint).

## Supported formats

- **.txt** — plain text (no extraction needed)
- **.docx** — Word documents (requires `python-docx` for text extraction)
- **.pdf** — PDF (requires `pypdf` or similar for text extraction)

## How to use

1. Add sample files to this folder.
2. Run the local ingest script (see `scripts/` when available) or `POST /ingest` manually with the file content.
3. Or use the Python API: the ingest module accepts `content` (plain text) + `metadata`; extract text from files as needed.

## Metadata for ingest

When sending to `POST /ingest`, include metadata such as:
- `doc_layer`: `policy` | `principle` | `sop` | `work_instruction`
- `sites`: list of site codes
- `policy_ref`: optional parent policy reference
- `document_id`: unique ID (e.g. filename or UUID)
- `title`, `source_path`, `library`: optional
