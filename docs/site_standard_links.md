# Site ↔ Standard Links — Governance Data

This file is the **source of truth** for populating the `site_standard_links` table in Supabase.
Run `scripts/seed_site_standard_links.py` to push all rows into the database.

---

## Standard types

| `standard_type` | Meaning |
|---|---|
| `universal` | Applies to every Cranswick site (e.g. BRCGS Food Safety) |
| `cranswick` | Cranswick internal standard — applies to all sites |
| `customer` | Retailer/customer standard — site-specific |

---

## Sites and their standards

### Yorkshire Baker

| standard_name | standard_document_id | standard_type | notes |
|---|---|---|---|
| BRCGS Food Safety | BRCGS-(V9) | universal | |
| Cranswick Manufacturing Standard | 14286_Cranswick_Manufacturing-Standard-Booklet_Update-2022_v4-(1) | cranswick | 508 clauses — standard_name in DB is raw filename, resolved via document_id |

<!-- ─────────────────────────────────────────────────────────────────────────
     ADD NEW SITES BELOW — copy the block and fill in the table rows.
     Use the same standard_name values you ingest policy documents under.
     ──────────────────────────────────────────────────────────────────────── -->

<!-- ### Site Name

| standard_name | standard_document_id | standard_type | notes |
|---|---|---|---|
| BRCGS Food Safety |  | universal | |
| Cranswick Manufacturing Standard |  | cranswick | |
| <Customer Standard Name> |  | customer | e.g. Tesco, M&S, Aldi |

-->

---

## How to add a new site

1. Add a new `### Site Name` section above with a completed table.
2. Run `python scripts/seed_site_standard_links.py` — it will upsert all rows (safe to re-run).
3. Once the standard document is ingested, fill in the `standard_document_id` column and re-run the seed.

---

## How site_scope works in analysis

When a compliance finding is linked to a policy clause the pipeline performs a
**3-hop query**:

```
ComplianceFlag
  └─► policy_clause_records  (clause_id)
        └─► site_standard_links  (standard_name / standard_document_id)
              └─► [site_id, site_id, …]
```

The resulting `site_scope` list is returned on every finding so reviewers know
exactly which sites the non-conformance applies to.
