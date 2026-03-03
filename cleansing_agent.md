# Agent: Cleansing

**Position in pipeline:** 1 (always first)  
**File:** `src/pipeline/agents/cleansing_agent.py`  
**Always runs:** Yes

---

## Purpose

Normalises all retrieved document content before any analysis occurs. Downstream agents assume they are receiving clean, consistent text. Garbage in = garbage analysis.

---

## What It Does

**Structural cleaning:**
- Strips HTML/XML tags from SharePoint content
- Removes headers, footers, page numbers, watermarks
- Collapses repeated whitespace and blank lines
- Normalises line endings

**Format normalisation:**
- Converts all list styles to consistent markdown-style bullets
- Normalises heading hierarchy (H1/H2/H3 → consistent depth markers)
- Removes tracked changes markup (accept all, clean text only)
- Strips comments and annotations (preserves content, logs that annotations existed)

**Encoding:**
- Normalises to UTF-8
- Replaces smart quotes with straight quotes
- Replaces em/en dashes with hyphens in structured fields (preserves in prose)

**Content flagging (does NOT remove — flags for downstream agents):**
- Sections marked as "DRAFT" or "PLACEHOLDER"
- `[TBC]`, `[TO BE CONFIRMED]`, `[INSERT X]` patterns
- Incomplete sentences (ends mid-clause)
- Complex words, jargon, or undefined abbreviations that require prior company or technical knowledge (readers should understand without domain expertise)

---

## Glossary (domain_context.json)

A standard glossary is maintained in `src/pipeline/domain_context.json` under `glossary.terms`. Example entries:
- **CMEX**: Cranswick Manufacturing Execution software
- **SSCC**: Serial Shipping Container Code

These terms are injected as ambiguities into the cleansing and terminology agent prompts. When they appear in documents without definition, agents flag them. Add new terms to the glossary to extend coverage.

---

## Inputs Used from PipelineContext

```python
ctx.retrieved_chunks       # raw chunks from SharePoint
ctx.parent_policy          # raw policy document
ctx.current_version        # raw current version (if update)
ctx.sibling_docs           # raw sibling documents
```

---

## Outputs Written to PipelineContext

```python
ctx.cleansed_content       # normalised full text ready for analysis
ctx.warnings               # appended with any placeholder/incomplete flags
```

---

## Does NOT Do

- Does not evaluate meaning or quality
- Does not flag terminology inconsistencies (→ Terminology agent)
- Does not remove content it doesn't understand — flags it instead
- Does not touch the original retrieved documents (non-destructive)

---

## Error Conditions

| Condition | Behaviour |
|-----------|-----------|
| Retrieved chunks are empty | Append `PipelineError(severity="critical")`, halt |
| Encoding cannot be resolved | Append `PipelineError(severity="high")`, skip affected chunk |
| Content is entirely placeholder | Append warning, continue |

---

## Prompt (if LLM-assisted)

Cleansing is primarily rule-based (regex + python-docx parsing). Only invoke LLM if structural ambiguity cannot be resolved by rules — e.g. determining whether a heading is a section title or a callout box label.

If LLM used for structural ambiguity:
```
You are a document normalisation assistant. Your only task is to clean and 
structure the following document text. Do not change any meaning. Do not 
add content. Do not remove content unless it is purely formatting artefact 
(page numbers, headers, footers). Return only the cleaned text.
```

The specification analysis prompt (CLEANSING_SPEC_PROMPT) identifies vague language and **complex words/jargon** that would confuse readers without prior company or technical knowledge. Documents must be understandable by readers with no domain expertise.

---

## Test Cases

```python
def test_strips_html():
def test_normalises_headings():
def test_flags_placeholders():
def test_handles_empty_input():
def test_non_destructive():  # original chunks unchanged after run
```
