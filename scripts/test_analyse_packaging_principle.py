"""Test POST /analyse for packaging and labelling principle — uses vector retrieval."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

BASE = "http://127.0.0.1:8000"

# Principle doc for packaging and labelling — retrieve SOP context from vector store
# doc_layer=sop so we get packaging chunks (FSP74, etc); pipeline analyses for principle
BODY = {
    "tracking_id": "principle-packaging-001",
    "request_type": "new_document",
    "doc_layer": "sop",
    "sites": ["site_north"],
    "policy_ref": "P-001",
    "query": "packaging labelling procedure online labels",
}


def main():
    print("Calling POST /analyse (vector retrieval for packaging/labelling)...")
    r = requests.post(f"{BASE}/analyse", json=BODY, timeout=180)
    r.raise_for_status()
    data = r.json()

    print("\n" + "=" * 60)
    print("ANALYSIS: Principle — Packaging & Labelling")
    print("=" * 60)
    print(f"tracking_id:     {data.get('tracking_id')}")
    print(f"draft_ready:     {data.get('draft_ready')}")
    print(f"overall_risk:    {data.get('overall_risk')}")
    print(f"agents_run:      {data.get('agents_run')}")
    print()
    print("FLAGS:")
    print(f"  specifying_flags:   {len(data.get('specifying_flags', []))}")
    print(f"  sequencing_flags:   {len(data.get('sequencing_flags', []))}")
    print(f"  formatting_flags:   {len(data.get('formatting_flags', []))}")
    print(f"  compliance_flags:   {len(data.get('compliance_flags', []))}")
    print(f"  terminology_flags:  {len(data.get('terminology_flags', []))}")
    print(f"  conflicts:         {len(data.get('conflicts', []))}")
    print(f"  risk_scores:       {len(data.get('risk_scores', []))}")
    print(f"  risk_gaps:         {len(data.get('risk_gaps', []))}")
    print(f"  errors:            {len(data.get('errors', []))}")
    print(f"  warnings:          {len(data.get('warnings', []))}")

    # Show sample flags from each agent
    for key in ("specifying_flags", "sequencing_flags", "formatting_flags", "compliance_flags", "terminology_flags", "conflicts"):
        items = data.get(key, [])
        if items:
            print(f"\n--- {key} (sample) ---")
            for i, item in enumerate(items[:3]):
                if isinstance(item, dict):
                    val = item.get('location') or item.get('current_text') or item.get('term') or str(item)
                    print(f"  [{i+1}] {(str(val))[:80]}...")
                else:
                    print(f"  [{i+1}] {str(item)[:80]}")

    out = Path(__file__).resolve().parent.parent / "test_result_packaging_principle.json"
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"\nFull response saved to {out.name}")


if __name__ == "__main__":
    main()
