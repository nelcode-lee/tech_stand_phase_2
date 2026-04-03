"""
Reinstate policy documents after a library prune.

Ingests BRCGS and Cranswick Manufacturing Standard from sample_docs with the exact
titles that "Reset metrics & prune library" keeps, so they survive future prunes.

Run from project root:
    python scripts/reinstate_policy_docs.py

Requires the backend to be running (uvicorn) and sample_docs to contain the PDFs.
"""
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "sample_docs"
BASE = "http://127.0.0.1:8000"

# Exact titles that prune keeps; document_ids used by site_standard_links
POLICY_DOCS = [
    {
        "path": SAMPLE / "Meat Supply Chain Assurance Module BRCGS FS v9.pdf",
        "document_id": "BRCGS-(V9)",
        "title": "BRCGS - Food Safety Standard - V9",
        "doc_layer": "policy",
    },
    {
        "path": SAMPLE / "Cranswick Manufacturing Standard v2.pdf",
        "document_id": "local-Cranswick-Manufacturing-Standard-v2",
        "title": "local-Cranswick Manufacturing Standard v2",
        "doc_layer": "policy",
    },
]


def main():
    print("Reinstating policy documents...")
    for cfg in POLICY_DOCS:
        path = cfg["path"]
        if not path.exists():
            print(f"  SKIP: {path.name} not found")
            continue
        ext = path.suffix.lower()
        mimetype = "application/pdf" if ext == ".pdf" else (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            if ext == ".docx" else "application/msword"
        )
        try:
            with open(path, "rb") as f:
                files = {"file": (path.name, f, mimetype)}
                data = {
                    "document_id": cfg["document_id"],
                    "title": cfg["title"],
                    "doc_layer": cfg["doc_layer"],
                }
                r = requests.post(f"{BASE}/ingest/file", files=files, data=data, timeout=180)
            r.raise_for_status()
            out = r.json()
            print(f"  OK: {cfg['title']} — {out.get('chunks_ingested', 0)} chunks")
        except requests.exceptions.ConnectionError:
            print("ERROR: Cannot reach backend. Start it with: uvicorn main:app --reload --port 8000")
            sys.exit(1)
        except Exception as e:
            print(f"  ERR: {cfg['title']} — {e}")
    print("Done. Refresh Library to see the policy docs.")
    print("If using site_standard_links for Cranswick (508-clause booklet), add/update the link for")
    print("  document_id 'local-Cranswick-Manufacturing-Standard-v2' or re-ingest the booklet.")


if __name__ == "__main__":
    main()
