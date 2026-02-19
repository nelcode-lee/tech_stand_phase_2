# Agent: Validation

**Position in pipeline:** 8 (always last)  
**File:** `src/pipeline/agents/validation_agent.py`  
**Always runs:** Yes

---

## Purpose

The final gate before the draft reaches a human reviewer. Validation answers one question: **does this document satisfy the requirements it claims to satisfy?** It also produces the `draft_ready` flag that Workato uses to decide whether to proceed to HITL or halt.

---

## What It Does

**Policy requirement coverage:**
- For each requirement in the parent Policy, checks whether the draft provides an implementation
- Flags requirements that are referenced but not addressed
- Flags requirements that are addressed in a way that appears to conflict with the policy wording

**Completeness check:**
- All `[SPECIFYING: ...]` inline flags from the Specifying agent are catalogued (these need SME resolution before publish)
- All `[SEQUENCING: ...]` inline flags are catalogued
- Any `[TBC]` or `[PLACEHOLDER]` content from Cleansing is confirmed still present (warns if it was silently removed)

**Self-consistency:**
- The document does not contradict itself internally
- Defined terms are used consistently throughout the document
- All internal cross-references resolve

**Relationship integrity:**
- Document has a valid parent reference (policy_ref for Principles; principle_ref for SOPs)
- Parent document exists in SharePoint and is in `published` status
- If update: new version is a superset of requirements in prior version (cannot silently remove requirements)

**Draft readiness decision:**
```
draft_ready = True   IF: no critical errors, no blockers from upstream agents,
                         no unresolved [SPECIFYING] flags that affect mandatory 
                         requirements (advisory flags can proceed)

draft_ready = False  IF: critical pipeline errors, UNSANCTIONED_CONFLICT with 
                         severity >= high, missing parent reference, or 
                         policy requirement not addressed
```

---

## Inputs Used from PipelineContext

```python
ctx.draft_content           # final formatted draft
ctx.parent_policy           # requirements to check coverage against
ctx.conflicts               # from conflict agent
ctx.risk_scores             # from risk agent
ctx.errors                  # accumulated errors from all upstream agents
ctx.terminology_flags
```

---

## Outputs Written to PipelineContext

```python
ctx.validation_result       # ValidationResult object
ctx.draft_ready             # bool — the key output Workato reads
```

**ValidationResult schema:**
```python
class ValidationResult(BaseModel):
    draft_ready: bool
    
    # Coverage
    policy_requirements_found: int
    policy_requirements_addressed: int
    policy_requirements_missing: list[str]
    
    # Flags requiring SME attention
    specifying_flags_count: int
    sequencing_flags_count: int
    placeholder_count: int
    
    # Integrity
    self_consistent: bool
    parent_ref_valid: bool
    
    # Overall
    blocking_issues: list[str]      # reasons draft_ready = False
    advisory_issues: list[str]      # surfaced in HITL card but don't block
    
    validation_summary: str         # 2–3 sentence plain English summary
                                    # shown at top of HITL Teams card
```

---

## LLM Prompt (for policy coverage check)

```
You are a compliance auditor. You will be given a Policy document and a 
draft Principle (or SOP) that claims to implement that policy.

Your task:
1. Extract every distinct requirement from the Policy
2. For each requirement, determine whether the draft addresses it
3. For requirements that are addressed, note if the draft's implementation 
   appears to conflict with the policy wording
4. For requirements not addressed, flag as missing

Be precise. A requirement is "addressed" only if the draft explicitly 
provides an implementation approach — a vague reference is not sufficient.

Return a JSON object:
{
  "requirements_found": int,
  "requirements_addressed": int,
  "missing_requirements": [{"requirement": str, "policy_section": str}],
  "conflicting_implementations": [{"requirement": str, "conflict": str}]
}

POLICY:
{parent_policy}

DRAFT:
{draft_content}
```

---

## Error Conditions

| Condition | Behaviour |
|-----------|-----------|
| Parent policy not available | Cannot do coverage check — set `draft_ready = False`, append critical error |
| LLM returns malformed JSON | Retry once, then set `draft_ready = False` |
| Draft content empty | Set `draft_ready = False`, append critical error |

---

## Test Cases

```python
def test_flags_unaddressed_policy_requirement():
def test_draft_ready_true_on_clean_pipeline():
def test_draft_ready_false_on_critical_conflict():
def test_draft_ready_false_on_missing_parent_ref():
def test_counts_specifying_flags_correctly():
def test_validation_summary_is_human_readable():
def test_cannot_remove_requirements_on_update():
```
