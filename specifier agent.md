# Agent: Specifying

**Position in pipeline:** 5  
**File:** `src/pipeline/agents/specifying_agent.py`  
**Runs when:** `request_type` is `new_document` or `update_existing`

---

## Purpose

Tightens vague language in the draft before it is committed to document form. Standards documents fail in practice when requirements are ambiguous — this agent converts fuzzy intent into precise, testable statements.

This is a drafting-phase agent. It operates on the emerging draft content, not the retrieved source documents.

---

## What It Does

**Vagueness detection:**
- Flags undefined quantitative thresholds: "regularly", "frequently", "as soon as possible", "sufficient"
- Flags undefined comparative references: "at least as good as", "equivalent to"
- Flags passive constructions that obscure responsibility: "it should be ensured that", "checks must be carried out"
- Flags circular definitions: "a critical control point is a point that is critical"

**Specificity suggestions:**
- For each vague phrase, proposes a specific replacement based on context from the parent policy and existing SOPs
- Proposes explicit responsibility assignment: "the Site Manager must..." not "management must..."
- Proposes measurable thresholds where possible: "within 4 hours" not "promptly"

**Modal verb enforcement:**
- Ensures `must` / `shall` used only for mandatory requirements
- Ensures `should` used only for recommended (non-mandatory) actions  
- Ensures `may` / `can` used only for permitted options
- Flags any `will` used as a requirement (not a description of future state)

---

## Inputs Used from PipelineContext

```python
ctx.draft_content           # the emerging draft text
ctx.parent_policy           # source of truth for thresholds
ctx.cleansed_content        # existing SOP language for reference thresholds
ctx.terminology_flags       # avoid compounding terminology issues
```

---

## Outputs Written to PipelineContext

```python
ctx.draft_content           # updated with specificity improvements (tracked)
ctx.warnings                # appended with any suggestions that couldn't be resolved
```

The agent appends `[SPECIFYING: suggested replacement — confirm with SME]` inline where it proposes a change but cannot determine the correct specific value from context. These inline flags are visible to the reviewer in the HITL card.

---

## Does NOT Do

- Does not invent thresholds — if no basis exists in policy or existing SOPs, it flags and moves on
- Does not rewrite sentence structure beyond what is needed for specificity
- Does not enforce house style (→ Formatting agent)

---

## LLM Prompt

```
You are a technical standards editor specialising in operational compliance 
documents for multi-site retail food operations.

Your task is to review the following draft document and identify language 
that is too vague to be reliably implemented or audited.

For each vague phrase:
1. Identify what is vague and why
2. Propose a specific replacement, using the parent policy and reference 
   documents as the source of correct thresholds and responsibilities
3. If you cannot determine the correct specific value from the available 
   context, mark it with: [SPECIFYING: <your suggested replacement> — 
   confirm with SME]

Also enforce consistent modal verb usage:
- must / shall → mandatory requirements only
- should → recommended, non-mandatory
- may / can → permitted options
- Flag any misuse

DRAFT:
{draft_content}

PARENT POLICY (for threshold reference):
{parent_policy}

REFERENCE SOPS (for existing thresholds):
{cleansed_content}

Return the revised draft text with changes tracked using the format:
~~original~~ → **replacement**
And a separate JSON array of changes made.
```

---

## Error Conditions

| Condition | Behaviour |
|-----------|-----------|
| Draft content is empty | Append `PipelineError(severity="critical")`, halt |
| No parent policy available | Append warning, run without threshold reference |
| LLM cannot parse draft structure | Append error, return draft unchanged |

---

## Test Cases

```python
def test_flags_vague_frequency():
def test_proposes_specific_threshold_from_policy():
def test_flags_passive_responsibility():
def test_modal_verb_correction():
def test_marks_unresolvable_with_sme_flag():
def test_does_not_invent_thresholds():
```
