# Doc Builder — Document Production Branch

**Branch:** `Doc_builder`  
**Scope:** Document production elements — amending docs with findings, format preservation, and citation handling.

---

## How the System Knows What's Required

The document builder (and upstream agents) infer requirements from:

1. **Checklist categories** — Hardcoded in agents (e.g. `_SITE_TYPE_CATEGORIES`, `_CROSS_DOC_CATEGORIES` in risk agent). Injected into prompts as guidance.
2. **Domain context** — `domain_context.json`: severity rules, FMEA scales, regulatory references (names only), standard sections.
3. **Document content** — The primary document (cleansed content) and findings from analysis.
4. **Parent policy** — When `policy_ref` is set, parent policy content is retrieved and passed to agents.

The LLM combines these with its training to infer what actions are required for each finding.

---

## What Can Be Cited as Proof

| Source | In prompt? | Verifiable? |
|--------|------------|-------------|
| **Parent policy** | Yes — full content when `policy_ref` set | Yes — can cite specific text |
| **BRCGS clauses** | No — only framework name in `regulatory_references` | No — LLM infers from training |
| **Cranswick standards** | No | No |
| **Regulations** (e.g. 852/2004) | No — names only | No |

**Implication:** Citations to BRCGS, Cranswick, or regulations are inferred references, not checked against real source documents. Only parent policy citations are verifiable.

---

## Doc Builder Work Items (This Branch)

- [ ] Store original DOCX at ingest (or structure-preserving extraction) for format fidelity
- [ ] Amendment flow: apply findings → proposed content → HITL → new version
- [ ] Improve `_text_to_docx` for bullets, tables, heading detection (Option C)
- [ ] Versioned `document_content` with single source of truth
- [ ] Test docs: `is_test` flag, watermark for test-only amendments

---

## Related Files

- `src/rag/file_extract.py` — extraction (loses format)
- `src/rag/chunking.py` — chunks for RAG (full text preserved in `document_content`)
- `src/rag/document_registry.py` — `document_content` table
- `src/pipeline/routes.py` — `_text_to_docx`, `/draft` endpoint
