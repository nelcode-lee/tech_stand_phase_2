"""Test POST /analyse with sample doc content."""
import json
import sys
from pathlib import Path

# Add project root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

SAMPLE = Path(__file__).resolve().parent.parent / "sample_docs" / "forignbodyprevention.txt"
BASE = "http://127.0.0.1:8000"


def main():
    if not SAMPLE.exists():
        print(f"Sample file not found: {SAMPLE}")
        sys.exit(1)

    content = SAMPLE.read_text(encoding="utf-8")
    body = {
        "tracking_id": "test-fbp-001",
        "request_type": "new_document",
        "doc_layer": "sop",
        "sites": ["site_north"],
        "policy_ref": "P-001",
        "content": content,
    }

    print("Calling POST /analyse...")
    r = requests.post(f"{BASE}/analyse", json=body, timeout=120)
    r.raise_for_status()
    data = r.json()

    print("\n=== ANALYSIS RESULT ===")
    print(f"tracking_id: {data.get('tracking_id')}")
    print(f"draft_ready: {data.get('draft_ready')}")
    print(f"overall_risk: {data.get('overall_risk')}")
    print(f"agents_run: {data.get('agents_run')}")
    print(f"specifying_flags: {len(data.get('specifying_flags', []))}")
    print(f"sequencing_flags: {len(data.get('sequencing_flags', []))}")
    print(f"formatting_flags: {len(data.get('formatting_flags', []))}")
    print(f"compliance_flags: {len(data.get('compliance_flags', []))}")
    print(f"terminology_flags: {len(data.get('terminology_flags', []))}")
    print(f"conflicts: {len(data.get('conflicts', []))}")
    print(f"risk_scores: {len(data.get('risk_scores', []))}")

    out = Path(__file__).resolve().parent.parent / "test_result.json"
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"\nFull response saved to {out.name}")


if __name__ == "__main__":
    main()
