# Weekly Summary — Tech Standards Phase 2

**Period:** Week of 18 February 2025 (approx.)

---

## 1. UI & Analyse Page Layout

- **Split view:** Original Document and Findings shown side by side in two panels
- **Flag counts bar** moved to the top of the results area
- **Section-based navigation:** Clicking a finding scrolls to the matching section in the original document (supports "Step 3", "Section 4", etc.)
- **Single-finding highlight:** Only the selected finding is highlighted; previous highlights are cleared
- **Buttons outside card:** Back and Run Analysis moved into a header bar outside the white card
- **Spacing:** Adjusted gaps between header, card, and controls

---

## 2. Document Structure & Content

- **Section parsing:** Sections parsed at ingest and stored in `document_content` (JSONB)
- **Full document content:** When `document_id` is set, pipeline uses full content from `document_content` instead of joining chunks (avoids chunk overlap and duplicate findings)
- **Deduplication:** Findings deduplicated by location, section, excerpt, etc. in `_deduplicate_findings()`

---

## 3. Agent Rules (from Human Feedback)

| Rule | Purpose |
|------|---------|
| **Job title vs named individual** | Job titles (e.g. "Quality Manager") are acceptable; named individuals are not for controlled procedures |
| **Tolerance vs reference** | Distinguish tolerance/parameter gaps from missing document references in intake/specification sections |
| **Purpose/objective implicit** | Purpose can be conveyed by title, intro, or procedure; don't require an explicit "Purpose" section |
| **Document reference** | If a child doc is referenced → allow; if not → ask for reference |

**Applied to:** Risk, Validation, Specifying, Cleansing, Formatting agents

---

## 4. Template & Structure

- **Purpose/Objective:** Changed from required to optional in section template (no longer high-severity omission when missing)
- **Risk agent:** Updated wording from "Responsible person or role not named" to "Responsible role or job title not named (job titles are appropriate; named individuals are not for controlled procedures)"

---

## 5. Extraction & Content Integrity

### DOCX list extraction
- **List bullets preserved:** Paragraphs with list/bullet styling (e.g. "bullrt para", "List Bullet") now get a `•` prefix so extracted text preserves list structure
- **Effect:** "Relevant Documentation:" followed by bullet items no longer triggers false "incomplete list" flags

### Content integrity flags
- **Colon + list:** "Line ends with colon and nothing" / "incomplete list" reframed as often an **extraction artefact** rather than a document defect
- **Severity:** Downgraded from high/medium to **low** for both `truncated_step` and `incomplete_list`
- **Recommendation:** "Check the source document. If a list exists there, the issue is extraction quality (re-ingest may help)."

### Tables
- Tables extracted row-by-row with tab separators and `[TABLE]` marker (unchanged; DOCX extraction already handles tables)

---

## 6. Non-Text Elements (Images, Flow Charts, Tables)

- **Discussion:** Options for managing pictures, flow charts, and tables in scope
- **Current:** Tables extracted; images/flow charts detected via placeholders (`[IMAGE]`, `[CHART]`, etc.) and flagged as `non_text_element` with recommendation to add text description
- **Future options:** pdfplumber for PDF tables; vision-based description for images; manual description workflow

---

## 7. Technical Notes

- **Re-ingest:** Documents ingested before section parsing and list-bullet extraction need re-ingest for full benefit
- **Paths:** `src/pipeline/agent_rules.py`, `src/rag/file_extract.py`, `src/rag/docx_extract.py`, `src/pipeline/agents/cleansing_agent.py`, `frontend/src/pages/AnalysePage.jsx`

---

## 8. Files to Re-Ingest

For documents ingested before this week:
- Re-ingest to get section-based navigation and full-content analysis
- Re-ingest DOCX files to benefit from list bullet preservation
