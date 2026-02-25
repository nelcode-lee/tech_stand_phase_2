"""Ingest a DOCX or PDF file via POST /ingest/file. For local testing."""
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

BASE = "http://127.0.0.1:8000"


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/ingest_docx.py <path-to.docx|.pdf|.doc> [document_id]")
        print("Example: python scripts/ingest_docx.py sample.docx doc-001")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}")
        sys.exit(1)
    if path.suffix.lower() not in (".docx", ".pdf", ".doc"):
        print("Only .docx, .pdf, and .doc files are supported.")
        sys.exit(1)

    document_id = sys.argv[2] if len(sys.argv) > 2 else path.stem

    ext = path.suffix.lower()
    if ext == ".docx":
        mimetype = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif ext == ".pdf":
        mimetype = "application/pdf"
    else:
        mimetype = "application/msword"  # legacy .doc

    with open(path, "rb") as f:
        files = {"file": (path.name, f, mimetype)}
        data = {
            "document_id": document_id,
            "doc_layer": "sop",
            "sites": "site_north",
            "policy_ref": "P-001",
        }
        r = requests.post(f"{BASE}/ingest/file", files=files, data=data, timeout=120)

    r.raise_for_status()
    out = r.json()
    print(f"OK: {out.get('message', 'Ingested')}")
    print(f"  document_id: {out.get('document_id')}")
    print(f"  chunks_ingested: {out.get('chunks_ingested')}")


if __name__ == "__main__":
    main()
