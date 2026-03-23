"""
Seed site_standard_links table from the canonical list below.

Usage:
    python scripts/seed_site_standard_links.py

Safe to re-run — each row is upserted on (site_id, standard_name).
Update docs/site_standard_links.md when adding new sites, then re-run this script.
"""
import os
import sys

# Allow running from the repo root without installing the package.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from src.rag.document_registry import upsert_site_standard_link

# ─────────────────────────────────────────────────────────────────────────────
# GOVERNANCE DATA
# Edit this list when sites or standards change.
# standard_document_id: leave None until the policy document has been ingested,
#                       then fill in the document_id from the Supabase registry.
# ─────────────────────────────────────────────────────────────────────────────
LINKS: list[dict] = [
    # ── Yorkshire Baker ──────────────────────────────────────────────────────
    {
        "site_id": "Yorkshire Baker",
        "standard_name": "BRCGS Food Safety",
        "standard_document_id": "BRCGS-(V9)",
        "standard_type": "universal",
        "notes": None,
    },
    {
        "site_id": "Yorkshire Baker",
        "standard_name": "Cranswick Manufacturing Standard",
        "standard_document_id": "14286_Cranswick_Manufacturing-Standard-Booklet_Update-2022_v4-(1)",
        "standard_type": "cranswick",
        "notes": "508 clauses — standard_name in policy_clause_records is raw filename, resolved via document_id",
    },
    # ── ADD MORE SITES BELOW ─────────────────────────────────────────────────
    # {
    #     "site_id": "Hams Hall",
    #     "standard_name": "BRCGS Food Safety",
    #     "standard_document_id": None,
    #     "standard_type": "universal",
    #     "notes": None,
    # },
    # {
    #     "site_id": "Hams Hall",
    #     "standard_name": "Cranswick Manufacturing Standard",
    #     "standard_document_id": None,
    #     "standard_type": "cranswick",
    #     "notes": None,
    # },
    # {
    #     "site_id": "Hams Hall",
    #     "standard_name": "Tesco Supplier Standard",
    #     "standard_document_id": None,
    #     "standard_type": "customer",
    #     "notes": None,
    # },
]
# ─────────────────────────────────────────────────────────────────────────────


def main() -> None:
    if not os.environ.get("SUPABASE_DB_URL"):
        print("ERROR: SUPABASE_DB_URL is not set. Add it to your .env file.")
        sys.exit(1)

    print(f"Seeding {len(LINKS)} site_standard_links row(s)...")
    ok = 0
    for link in LINKS:
        try:
            upsert_site_standard_link(
                site_id=link["site_id"],
                standard_name=link["standard_name"],
                standard_document_id=link.get("standard_document_id"),
                standard_type=link.get("standard_type", "universal"),
                notes=link.get("notes"),
            )
            status = "(doc_id: pending)" if not link.get("standard_document_id") else f"(doc_id: {link['standard_document_id']})"
            print(f"  OK  {link['site_id']}  <->  {link['standard_name']}  {status}")
            ok += 1
        except Exception as e:
            print(f"  ERR {link['site_id']}  <->  {link['standard_name']}  ERROR: {e}")

    print(f"\nDone — {ok}/{len(LINKS)} rows upserted.")


if __name__ == "__main__":
    main()
