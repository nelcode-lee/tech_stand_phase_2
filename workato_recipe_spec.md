# Workato Recipe Spec

## Overview

One primary recipe handles the full document request lifecycle. It is stateful, long-running, and uses Workato's Wait step to pause during HITL review.

---

## Triggers

| Trigger | Type | Source | Fires When |
|---------|------|--------|-----------|
| `doc_request` | Webhook | Workato Genie | User submits document request form |
| `review_response` | Webhook | Teams Adaptive Card | Reviewer approves, rejects, or escalates |
| `scheduled_review` | Scheduled | Recipe-set timer | Review cycle date reached for a published doc |

---

## Recipe: `doc-request-lifecycle`

### Step 1 — Parse & Validate Payload

**Action:** Workato built-in JSON parser + formula step

Extract and validate from webhook body:
```
request_type        (new_document | update_existing | contradiction_flag | review_request)
doc_layer           (policy | principle | sop | work_instruction)
sites[]             (array of site identifiers)
policy_ref          (string, optional)
urgency             (standard | urgent)
submitter_email     (string)
attached_doc_url    (SharePoint URL, optional)
```

If required fields missing → send Teams message to submitter with error detail → stop recipe.

---

### Step 2 — Enrich with Azure AD

**Connector:** Microsoft Azure AD  
**Action:** Get user by email

Pull: `display_name`, `job_title`, `department`, `manager`. Append to payload as `submitter_profile`.

Assign `tracking_id`: `UUID v4` via formula.

---

### Step 3 — Route by Request Type

**Action:** Workato conditional (if/else)

| Request Type | Route |
|-------------|-------|
| `new_document` | → Step 4 (RAG analyse) |
| `update_existing` | → Step 4 (RAG analyse, flag existing doc) |
| `contradiction_flag` | → Step 4 (analysis only, skip draft) |
| `review_request` | → Step 7 (HITL directly) |

---

### Step 4 — Invoke RAG + Agent Pipeline

**Connector:** HTTP  
**Action:** POST `{RAILWAY_BASE_URL}/analyse`

**Request body:**
```json
{
  "tracking_id": "{{tracking_id}}",
  "request_type": "{{request_type}}",
  "doc_layer": "{{doc_layer}}",
  "sites": ["{{sites}}"],
  "policy_ref": "{{policy_ref}}",
  "attached_doc_url": "{{attached_doc_url}}"
}
```

**Timeout:** 120 seconds  
**On timeout:** Write to AuditLog → notify submitter → stop recipe

**Response fields used downstream:**
```
draft_ready         (bool)
conflicts[]         (array)
risk_score          (low|medium|high|critical)
terminology_flags[] (array)
warnings[]          (array)
errors[]            (array — if any, halt and notify)
```

---

### Step 4B — Check for Blockers

**Action:** Conditional

If `errors[]` not empty → send Teams card to submitter with error detail → write AuditLog → stop.

If `conflicts[]` contains any `UNSANCTIONED_CONFLICT` with `severity: critical` → send Teams card to Standards Manager → pause recipe (Wait for input, timeout 3 days).

Otherwise → continue.

---

### Step 5 — Generate Draft

**Connector:** HTTP  
**Action:** POST `{RAILWAY_BASE_URL}/draft`

**Request body:**
```json
{
  "tracking_id": "{{tracking_id}}",
  "analysis_report": "{{step4_response}}"
}
```

Python service generates DOCX and uploads to SharePoint `/Staging/` directly via Graph API. Returns `staging_doc_url`.

Write to AuditLog: `event_type: draft_created`.

---

### Step 6 — Write Staging Metadata

**Connector:** Microsoft SharePoint  
**Action:** Update file properties

Set on the staged DOCX:
```
tracking_id, doc_layer, doc_status=draft, version=0.1,
sites, parent_policy_ref, author, conflict_flags (JSON),
risk_score, terminology_flags (JSON), agents_run
```

---

### Step 7 — Send HITL Review Card

**Connector:** Microsoft Teams  
**Action:** Send Adaptive Card to channel / user

**Card contains:**
- Document title and layer
- Link to staged draft in SharePoint
- Risk score (colour-coded: green/amber/red/critical)
- Conflict summary (if any)
- Terminology flags (if any)
- Action buttons: **Approve** | **Request Changes** | **Escalate**
- Comments field (required on Request Changes)

**Recipients:** Author + assigned SME(s) for that doc layer and site(s)  
**Update SharePoint:** `doc_status → in_review`  
**Write AuditLog:** `event_type: review_sent`

---

### Step 8 — Wait for Review Response

**Action:** Workato Wait for webhook (correlates on `tracking_id`)

**Timeout:** 5 days

**On timeout:**
- Day 5: Send reminder card to same recipients
- Day 8: Escalate to Standards Manager, write AuditLog `event_type: timeout`
- Day 10: Auto-close with status `archived`, notify submitter

---

### Step 9 — Handle Review Decision

**Action:** Conditional on `review_decision`

**Approved:**
- Update SharePoint: `doc_status → approved`, `approved_by`
- → Step 10 (Publish)

**Changes Required:**
- Write reviewer comments to AuditLog
- Update version: `0.1 → 0.2` etc.
- Re-invoke `/draft` endpoint with annotations
- → Return to Step 6 (re-stage, re-notify)
- Max loop: 5 iterations. On 6th rejection → escalate to Standards Manager.

**Escalate:**
- Send Teams message to Standards Manager with full context
- Update SharePoint: `doc_status → pending_escalation`
- Write AuditLog: `event_type: escalated`
- Pause recipe

---

### Step 10 — Publish

**Connector:** Microsoft SharePoint  
**Actions (sequential):**

1. Move DOCX from `/Staging/` to live library (e.g. `/Principles/`)
2. Update metadata: `doc_status → published`, `version → 1.0`, `effective_date`, `next_review_date`
3. If prior version exists: move to `/Archive/`, set `doc_status → archived`
4. Write relationship map entry to `DocumentRelationships` list
5. Write AuditLog: `event_type: published`

---

### Step 11 — Post-Publish Actions (parallel)

Run simultaneously:

**11a — Cascade Gap Check**  
If `doc_layer = principle`:
- Query `DocumentRelationships` for SOPs linked to this principle
- Compare against `sites[]` on the principle
- For any site with no SOP → create new intake request automatically with `request_type: new_document`, `doc_layer: sop`
- Notify Standards Manager of gaps

**11b — Stakeholder Notification**  
Send Teams message to affected site leads:
- Document name, layer, effective date
- Summary of what changed
- Link to published doc

**11c — Schedule Review Cycle**  
Create scheduled trigger in Workato for `next_review_date`:
- Fires new recipe run with `request_type: review_request`
- Pre-populates with existing doc metadata

---

## Connector Summary

| Connector | Used For |
|-----------|---------|
| Workato Genie | Front-end intake form |
| HTTP | Python RAG service on Railway |
| Microsoft Teams | Adaptive Cards, notifications |
| Microsoft SharePoint | Document upload, metadata, list writes |
| Microsoft Azure AD | User enrichment |
| Workato Scheduler | Review cycle triggers |

---

## Error Handling Principles

- Every HTTP call to Railway has a 120s timeout and explicit error handling
- All errors written to AuditLog before recipe stops
- Submitter notified on every error with plain-English explanation and tracking_id
- No recipe should silently fail — if in doubt, notify Standards Manager
