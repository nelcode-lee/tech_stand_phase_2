# SharePoint Metadata Schema

All document libraries and lists use a shared metadata schema. The `src/sharepoint/metadata.py` module enforces this schema — never write SharePoint columns manually.

---

## Document Libraries

### Library Structure

```
/Policies/
/Principles/
/SOPs/
/WorkInstructions/
/Staging/           ← all drafts, regardless of layer
/Archive/           ← superseded versions, read-only
```

---

## Column Definitions

### All Document Libraries (shared columns)

| Column Name | Type | Required | Values / Notes |
|-------------|------|----------|---------------|
| `tracking_id` | Text | Yes | UUID assigned at intake |
| `doc_layer` | Choice | Yes | `policy`, `principle`, `sop`, `work_instruction` |
| `doc_status` | Choice | Yes | `draft`, `in_review`, `changes_required`, `approved`, `published`, `archived` |
| `version` | Text | Yes | Semantic: `0.1`, `0.2`, `1.0`, `2.0` |
| `sites` | Multi-choice | Yes | Site identifiers e.g. `site_north`, `site_south` — or `all` |
| `parent_policy_ref` | Text | Yes | Reference code of governing Policy |
| `parent_principle_ref` | Text | Conditional | Required for SOPs and Work Instructions |
| `effective_date` | Date | Conditional | Required on publish |
| `next_review_date` | Date | Conditional | Required on publish (default: 12 months) |
| `author` | Person | Yes | Document author (Azure AD) |
| `approved_by` | Person | Conditional | Required on publish |
| `last_modified_by` | Person | Auto | Managed by SharePoint |
| `created_date` | Date/Time | Auto | Managed by SharePoint |

### Additional Columns — Staging Only

| Column Name | Type | Notes |
|-------------|------|-------|
| `conflict_flags` | Multi-line text | JSON array of conflict summaries from Conflict agent |
| `risk_score` | Choice | `low`, `medium`, `high`, `critical` — from Risk agent |
| `terminology_flags` | Multi-line text | JSON array from Terminology agent |
| `agents_run` | Text | Comma-separated list of agents that processed this doc |
| `analysis_report_url` | Hyperlink | Link to full JSON report stored in /Staging/Reports/ |

### Additional Columns — Principles Only

| Column Name | Type | Notes |
|-------------|------|-------|
| `intent_summary` | Multi-line text | Plain English statement of why this principle exists |
| `sop_coverage` | Multi-choice | Which sites have a downstream SOP for this principle |
| `sop_gap_sites` | Multi-choice | Sites where SOP coverage is missing (auto-populated on publish) |

### Additional Columns — SOPs Only

| Column Name | Type | Notes |
|-------------|------|-------|
| `variance_reason` | Multi-line text | If site-specific variance from standard approach, reason recorded here |
| `variance_type` | Choice | `none`, `sanctioned_variance`, `pending_review` |
| `equipment_refs` | Text | Equipment or system identifiers relevant to this SOP |

---

## Relationship Map List

A separate SharePoint List tracks the full document hierarchy. This is what the RAG engine queries to find parent/child/sibling documents.

**List name:** `DocumentRelationships`

| Column | Type | Notes |
|--------|------|-------|
| `parent_id` | Text | SharePoint item ID or tracking_id of parent doc |
| `child_id` | Text | SharePoint item ID or tracking_id of child doc |
| `parent_layer` | Choice | `policy`, `principle`, `sop`, `work_instruction` |
| `child_layer` | Choice | Same enum |
| `relationship_type` | Choice | `parent_child`, `sibling`, `supersedes`, `referenced_by` |
| `sites` | Multi-choice | Sites where this relationship applies |
| `created_date` | Date/Time | Auto |

---

## Audit Log List

All recipe actions are written here. Provides full traceability per tracking_id.

**List name:** `AuditLog`

| Column | Type | Notes |
|--------|------|-------|
| `tracking_id` | Text | Links to document |
| `event_type` | Choice | `intake`, `analysis_complete`, `draft_created`, `review_sent`, `approved`, `changes_requested`, `published`, `archived`, `escalated`, `timeout` |
| `event_timestamp` | Date/Time | When it happened |
| `actor` | Person | Who triggered it (or `system` for automated) |
| `notes` | Multi-line text | Free text, e.g. reviewer comments |
| `agent_report_snapshot` | Multi-line text | JSON snapshot of pipeline report at this point |

---

## Status Transition Rules

```
draft → in_review          (Workato: on Teams card sent)
in_review → changes_required  (Workato: on reviewer rejection)
changes_required → in_review  (Workato: on redraft submitted)
in_review → approved       (Workato: on SME approval)
approved → published       (Workato: on publish action)
published → archived       (Workato: when superseded by new version)
```

Any transition outside this sequence must be flagged as an error and written to AuditLog with `event_type: invalid_transition`.

---

## Versioning Convention

| Scenario | Version |
|----------|---------|
| First draft | `0.1` |
| Each revision during review | `0.2`, `0.3` ... |
| First publish | `1.0` |
| Minor update (published → review → publish) | `1.1`, `1.2` ... |
| Major revision | `2.0` |

Major vs minor is determined by the approving SME at point of approval.

---

## Metadata Enforcement

`src/sharepoint/metadata.py` exposes:

```python
def build_metadata(doc_layer: DocLayer, status: DocStatus, **kwargs) -> dict:
    """Returns validated SharePoint column dict. Raises ValidationError if required fields missing."""

def validate_transition(current_status: DocStatus, new_status: DocStatus) -> bool:
    """Returns True if transition is valid per state machine."""

def build_relationship_entry(parent_id: str, child_id: str, ...) -> dict:
    """Returns validated relationship map entry."""
```