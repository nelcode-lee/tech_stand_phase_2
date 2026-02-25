# Sample Documents

Place sample documents here for local RAG ingestion testing (without Workato/SharePoint).

## Supported formats

- **.txt** — plain text (no extraction needed)
- **.docx** — Word documents (extracted via `python-docx`)
- **.pdf** — PDF (extracted via `pypdf`)

## How to use

1. Add .txt, .docx, or .pdf files to this folder.
2. **Ingest all files in folder:**
   ```bash
   python scripts/ingest_folder.py
   # or: python scripts/ingest_folder.py /path/to/other/folder
   ```
3. **Ingest a single file (API):**
   ```bash
   python scripts/ingest_docx.py sample_docs/your_file.docx doc-id
   python scripts/ingest_docx.py sample_docs/your_file.pdf doc-id
   ```

## Metadata for ingest

When sending to `POST /ingest`, include metadata such as:
- `doc_layer`: `policy` | `principle` | `sop` | `work_instruction`
- `sites`: list of site codes
- `policy_ref`: optional parent policy reference
- `document_id`: unique ID (e.g. filename or UUID)
- `title`, `source_path`, `library`: optional
