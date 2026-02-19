 # Agent: Conflict Detection

**Position in pipeline:** 3  
**File:** `src/pipeline/agents/conflict_agent.py`  
**Runs when:** `request_type` is `new_document`, `update_existing`, `contradiction_flag`, or `review_request`

---

## Purpose

Identifies genuine contradictions between documents — not stylistic differences, but cases where following one document would put a site in breach of another. Also detects policy requirements that have no downstream implementation.

This is the highest-value agent in the pipeline and the one most likely to prevent real-world compliance failures.

---

## What It Does

**Cross-document contradiction detection:**
- Compares requirements at the same layer across different sites
- Compares SOP content against its parent Principle
- Compares Principle content against its parent Policy
- Identifies where two documents prescribe incompatible actions for the same scenario

**Conflict classification:**
- `UNSANCTIONED_CONFLICT` — genuine contradiction with no recorded variance reason
- `SANCTIONED_VARIANCE` — difference is intentional and recorded in metadata
- `PENDING_REVIEW` — difference detected, no variance status on record, cannot determine intent
- `PARENT_BREACH` — SOP or Principle content contradicts its direct parent document

**Gap detection:**
- Policy requirement exists but no Principle addresses it
- Principle exists but no SOP exists for one or more sites
- SOP references a procedure that doesn't exist in any Work Instruction

---

## Key Design Rule: Sanctioned Variance

The agent must query SharePoint metadata for `variance_type` on any document where a difference is found. If `variance_type = sanctioned_variance` and `variance_reason` is populated, classify as `SANCTIONED_VARIANCE` (severity: info), not a conflict.

**Never treat all cross-site differences as errors.** Sites legitimately differ.

---

## Inputs Used from PipelineContext

```python
ctx.cleansed_content
ctx.retrieved_chunks        # includes per-document metadata (variance_type etc.)
ctx.parent_policy
ctx.sibling_docs            # same layer, other sites — primary comparison set
ctx.terminology_flags       # context: some conflicts stem from terminology issues
```

---

## Outputs Written to PipelineContext

```python
ctx.conflicts               # list[Conflict]
ctx.conflict_count          # int
ctx.blocker_count           # int (UNSANCTIONED_CONFLICT with severity critical/high)
```

**Conflict schema:**
```python
class Conflict(BaseModel):
    conflict_type: str      # UNSANCTIONED_CONFLICT | SANCTIONED_VARIANCE 
                            # | PENDING_REVIEW | PARENT_BREACH
    severity: str           # "info" | "low" | "medium" | "high" | "critical"
    layer: str              # which layer the conflict exists at
    sites: list[str]        # which sites are affected
    document_refs: list[str]    # tracking_ids of conflicting docs
    description: str        # plain English: what conflicts and why it matters
    recommendation: str     # what should happen to resolve it
    blocks_draft: bool      # True only for critical UNSANCTIONED_CONFLICT
```

**Severity guidance:**
| Type | Severity |
|------|---------|
| Direct safety/regulatory breach | `critical` |
| Operational contradiction affecting outcomes | `high` |
| Process inconsistency, same outcome possible | `medium` |
| Minor procedural difference | `low` |
| Sanctioned variance | `info` |

---

## LLM Prompt

```
You are a technical standards compliance analyst specialising in multi-site 
retail operations. You will be given a set of documents from different sites 
relating to the same operational area.

Your task is to identify genuine contradictions — cases where following one 
document would put a site in breach of another, or in breach of the parent 
policy.

Important rules:
- Only flag genuine contradictions, not stylistic differences
- If a document has variance_type = "sanctioned_variance", classify it as 
  SANCTIONED_VARIANCE, not a conflict
- Distinguish between a gap (requirement exists, implementation missing) and 
  a conflict (two incompatible implementations exist)
- For each conflict, explain what would actually go wrong if both documents 
  were followed simultaneously

Return a JSON array of Conflict objects. Do not return prose.

DOCUMENTS:
{cleansed_content}

PARENT POLICY:
{parent_policy}
```

---

## Error Conditions

| Condition | Behaviour |
|-----------|-----------|
| No sibling docs retrieved | Cannot do cross-site analysis — append warning, run parent-vs-child only |
| LLM returns malformed JSON | Retry once, then append error |
| Conflict count > 20 | Truncate to top 20 by severity, append warning |

---

## Test Cases

```python
def test_detects_unsanctioned_conflict():
def test_respects_sanctioned_variance():
def test_detects_parent_breach():
def test_detects_sop_gap():
def test_blocks_draft_on_critical():
def test_no_false_positives_on_style_difference():
```
