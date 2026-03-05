"""
Fetch the latest GEN-OP-17 analysis session from the API and export to GEN-OP-17_review_findings.md.
Requires: backend running (e.g. http://127.0.0.1:8002)
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

import requests
from scripts.export_analysis_report import export_from_dict

BASE = "http://127.0.0.1:8000"
OUTPUT = ROOT / "GEN-OP-17_review_findings.md"


def main():
    # 1. List recent sessions
    r = requests.get(f"{BASE}/analysis/sessions?limit=50", timeout=10)
    r.raise_for_status()
    sessions = r.json()

    # 2. Find latest GEN-OP-17 session (documentId or title)
    genop17 = None
    for s in sessions:
        doc_id = s.get("documentId") or s.get("document_id") or ""
        title = (s.get("title") or "").lower()
        if doc_id == "GEN-OP-17" or "internal audit" in title or "gen-op-17" in doc_id.lower():
            genop17 = s
            break

    if not genop17:
        print("No GEN-OP-17 session found in analysis_sessions.")
        print("Run an analysis on GEN-OP-17 in the frontend first, then run this script again.")
        sys.exit(1)

    tracking_id = genop17.get("trackingId") or genop17.get("tracking_id")
    if not tracking_id:
        print("Session has no tracking_id.")
        sys.exit(1)

    # 3. Fetch full session with result
    r = requests.get(f"{BASE}/analysis/sessions/{tracking_id}", timeout=10)
    r.raise_for_status()
    session = r.json()
    result = session.get("result")

    if not result:
        print("Session has no result data.")
        sys.exit(1)

    # Ensure document_id/title for header
    result["document_id"] = result.get("document_id") or genop17.get("documentId") or "GEN-OP-17"
    result["title"] = result.get("title") or genop17.get("title") or "Internal Auditing Procedure"

    # 4. Export to markdown
    report = export_from_dict(result)
    OUTPUT.write_text(report, encoding="utf-8")
    print(f"Exported to {OUTPUT}")
    print(f"  Risk gaps: {len(result.get('risk_gaps', []))}")
    print(f"  Specifying: {len(result.get('specifying_flags', []))}")
    print(f"  Content integrity: {len(result.get('content_integrity_flags', []))}")
    print(f"  Sequencing: {len(result.get('sequencing_flags', []))}")
    print(f"  Formatting: {len(result.get('formatting_flags', []))}")
    print(f"  Compliance: {len(result.get('compliance_flags', []))}")


if __name__ == "__main__":
    main()
