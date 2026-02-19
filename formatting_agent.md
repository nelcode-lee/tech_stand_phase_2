# Agent: Formatting

**Position in pipeline:** 7 (always post-draft)  
**File:** `src/pipeline/agents/formatting_agent.py`  
**Always runs:** Yes (when draft exists)

---

## Purpose

Applies structural and visual standards to the draft document before HITL review. Reviewers should be reading for content, not correcting formatting. Consistent formatting also enables reliable downstream parsing by the RAG engine.

---

## What It Does

**Template compliance:**
- Verifies the document uses the correct template for its layer (Policy / Principle / SOP / Work Instruction)
- Ensures all mandatory sections are present for that template
- Flags any sections present that don't belong in that layer's template

**Heading hierarchy:**
- Enforces correct heading depth (H1 = document title, H2 = major sections, H3 = subsections)
- Flags headings that skip levels
- Ensures numbered clauses follow correct scheme (1. / 1.1 / 1.1.1)

**Metadata block:**
- Verifies document header block is complete: Doc ID, Version, Status, Author, Effective Date, Review Date, Approver, Parent Policy Ref
- Applies correct date format (DD/MM/YYYY)
- Inserts `[TO BE ASSIGNED]` placeholder for fields that will be populated on publish

**Reference formatting:**
- Ensures cross-references follow the standard format: `[DOC-TYPE-NNN]`
- Flags bare references like "see the allergen SOP" with no document ID
- Ensures all tables have headers

**DOCX output:**
- Applies correct Word styles from the house template
- Applies correct page margins and font settings
- Ensures headers/footers are populated
- Generates and inserts table of contents for documents > 5 sections

---

## Templates (by layer)

Templates are stored in `src/pipeline/templates/` and loaded by the formatting agent.

| Layer | Template file | Mandatory sections |
|-------|-------------|-------------------|
| Policy | `policy_template.docx` | Purpose, Scope, Policy Statement, Responsibilities, References, Review |
| Principle | `principle_template.docx` | Purpose, Policy Reference, Intent, Rationale, Scope, Site Variance Register, Related SOPs, Review |
| SOP | `sop_template.docx` | Purpose, Scope, Principle Reference, Responsibilities, Equipment/Resources, Procedure, Records, References, Review |
| Work Instruction | `work_instruction_template.docx` | Purpose, SOP Reference, Steps, Records |

---

## Inputs Used from PipelineContext

```python
ctx.draft_content           # text content of the draft
ctx.doc_layer               # determines which template to apply
ctx.tracking_id             # for metadata block
ctx.sites                   # for metadata block
ctx.policy_ref              # for metadata block
```

---

## Outputs Written to PipelineContext

```python
ctx.draft_content           # formatted text version
# Also writes DOCX binary directly to SharePoint /Staging/ via uploader
```

---

## Does NOT Do

- Does not change content — only structure and formatting
- Does not enforce writing style (→ Specifying agent for language)
- Does not validate content accuracy (→ Validation agent)

---

## Error Conditions

| Condition | Behaviour |
|-----------|-----------|
| Template file not found | Append `PipelineError(severity="high")`, use generic template |
| Mandatory section missing and cannot be inferred | Append warning with section name |
| DOCX generation fails | Append `PipelineError(severity="critical")` |

---

## Test Cases

```python
def test_applies_correct_template_by_layer():
def test_flags_missing_mandatory_section():
def test_enforces_heading_hierarchy():
def test_metadata_block_complete():
def test_formats_cross_references():
def test_generates_table_of_contents():
def test_docx_output_is_valid():
```
