# Product backlog — Tech Standards platform (phase 2+)

This document turns the architectural review themes into **epics**, **stories**, and **acceptance criteria**. It is a planning aid, not a commitment order. Prioritise with your product and compliance owners.

---

## Epic A — Persistence, recall, and audit trail

**Goal:** Any analysis run is **durable**, **retrievable by id**, and **auditable** without relying on browser storage.

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| A1 | Server is the source of truth for full analysis results | Given `SUPABASE_DB_URL` is configured, when an analysis completes successfully, then `result_json` for that `tracking_id` is stored in `analysis_sessions` and can be fetched via the existing analysis session API; the UI can reload full findings after a hard refresh without depending on `localStorage` for payload. |
| A2 | User-visible “saved” state matches reality | When `session_saved` is false, the UI shows a clear, persistent message that results may not be recalled later and prompts remediation (configure DB); when true, “View analysis” / dashboard recall works from server data alone. |
| A3 | Optional: version or immutability of runs | Given two runs for the same `document_id`, both remain listable with distinct `tracking_id` and timestamps; updates do not silently drop historical runs (define policy: append-only vs overwrite). |
| A4 | Ingest vs analysis failure clarity | If ingestion is partial or `document_id` mismatches chunks, the user sees a specific error (“not ingested”, “no content”) rather than a generic analysis failure. |

---

## Epic B — End-to-end value flow (scope → evidence → disposition → sign-off)

**Goal:** The workflow matches **governed** standards operations: scope is explicit, evidence is traceable, disposition is recorded, sign-off is attributable.

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| B1 | Scope is visible and repeatable | Configure / Analyse surfaces **document layer, sites, policy refs, and document identity** in one summary strip; the same inputs are stored on the analysis session record for replay. |
| B2 | Evidence mapping is consistent | For compliance-related findings, **policy clause linkage** (where implemented) is shown in UI and export; gaps are documented where mapping is missing. |
| B3 | Disposition taxonomy (Must-fix / Advisory / Info) | Each finding (or grouped finding) can be assigned a **disposition**; value persists in DB and appears in exports; filtering by disposition works on Dashboard or Analyse. |
| B4 | Human sign-off | A **named user**, **timestamp**, and **confirmation** (e.g. “reviewed for release”) can be recorded **per session or per document version**; record is immutable or audit-logged after submit. |
| B5 | Harmonisation and outputs stay aligned | Harmonisation scores and narrative align to **the same session** referenced by exports; export packs include scope, findings summary, and sign-off when present. |

---

## Epic C — Operational metrics and governance insight

**Goal:** Metrics support **risk management** and **audit**, not only demo charts.

**Implemented (phase 1):** Dashboard → **Advanced** tab — **Document health** table (latest run per document, findings, HACCP gap bands C/H/M/L, Δ vs prior run, overall risk); **Re-analysis trend** list for multi-run documents; **By site label** and **By requester** aggregates; **Governance & ratings** explainer. Backend: `record_session` now persists **`risk_metrics`** (from `result_json`) so list endpoints expose gap bands without loading full JSON. Historical sessions re-gain gap bands on new analyses or re-save.

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| C1 | Document health | Dashboard (or report) lists documents with **open finding counts**, **severity breakdown**, and **last analysis date** sourced from persisted sessions. |
| C2 | Policy alignment over time | For a document (or site), show **trend** of harmonisation / clause coverage across runs when the same `document_id` is re-analysed. |
| C3 | Attribution (optional, data-dependent) | If document metadata includes **owner / site / author**, reports can show **repeat patterns** (e.g. count of high-severity gaps per site); if metadata is missing, the UI states that limitation. |
| C4 | Site or unit “rating” | Any composite score is **documented** (formula, weights, minimum data rules); treated as **supplementary**, not a substitute for audit evidence. |

---

## Epic D — Document generation vs review-first

**Goal:** Avoid promising **auto-published** controlled documents before governance exists.

**Implemented:** `frontend/src/config/productPhase.js` — `VITE_DRAFT_OUTPUT_MODE` (`assistive` | `beta` | `minimal`). **Phase positioning** copy via `PhasePositioningBanner` on Configure, Dashboard (Advanced), Analyse (review overview). **Draft step** labels and tooltips in `Layout` session rail; Library / Dashboard **New Document** buttons; **RebuildScreen** disclaimer for create finalize. Internal: `docs/BACKLOG.md` (this file).

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| D1 | Phase positioning | Product copy and internal docs state that **review, validation, and metrics** are the primary phase-2 outcomes; **draft / layout output** is positioned as assistive or experimental where templates are not approved. |
| D2 | Defer full doc builder (optional story) | Until template library and approval workflow exist, **no user-facing promise** of one-click issued SOPs; optional flag hides or labels draft generation as beta. |

---

## Epic E — Finding quality (duplicates, false positives, shallow context)

**Goal:** Higher **signal**, fewer duplicate or context-blind gaps.

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| E1 | Stronger deduplication | Deduplication keys consider **excerpt fingerprint** and **normalised location** beyond first 200 chars of issue text; measurable duplicate rate drops on sample documents (define baseline set). |
| E2 | Full-document checks for “missing X” class | For configured finding classes (e.g. limits not stated), a **deterministic pass** over full stored document text can suppress or downgrade candidates when patterns (e.g. `mm`, numeric limits) exist elsewhere in the doc. |
| E3 | Extend verification breadth (careful) | Document which finding types use **finding_verification** vs not; optionally add non–missing-info checks without collapsing valid contradiction findings. |
| E4 | Human override persistence | Dismiss / false-positive actions are **stored** and optionally used to suppress similar suggestions in future runs (define scope: per document vs global). |

---

## Epic F — Analysis latency (target &lt; 6 minutes without cutting accuracy)

**Goal:** Reduce wall-clock time via **architecture**, not by hiding document text.

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| F1 | Parallel specialist wave | With `PIPELINE_PARALLEL_SPECIALISTS=true`, full pipeline completes in **lower wall time** than sequential on a reference document; merged outputs match existing functional tests / spot checks (no dropped agent outputs). |
| F2 | Operational validation | Document expected runtime range for **small / medium / large** SOPs after proxy and DB timeouts are sized correctly. |
| F3 | Optional two-tier analysis | “Quick scan” path runs a **subset** of agents or a shorter context for triage; full run remains available with identical contract as today. |
| F4 | Reuse of embeddings | Re-analysis of **unchanged ingested content** does not re-embed unnecessarily (ingest pipeline documents when embeddings are recomputed). |

---

## Suggested sequencing (non-binding)

1. **A1–A2** — Unblocks trust and “push-button recall.”  
2. **E1–E2** — Reduces noise and support burden.  
3. **F1–F2** — Addresses latency without changing product promises.  
4. **B3–B4** — Governance differentiators.  
5. **C1–C3** — Deeper metrics once data is stable.  
6. **D1–D2** — Align expectations on document generation.

---

## References in repo

- Analysis session persistence: `src/rag/analysis_sessions.py`, `src/pipeline/routes.py` (`record_session`, `session_saved`).
- Client session log (metadata-only persistence): `frontend/src/context/AnalysisContext.jsx`.
- Pipeline parallelism: `src/pipeline/router.py` (`PIPELINE_PARALLEL_SPECIALISTS`).
- Finding deduplication: `src/pipeline/routes.py` (`_deduplicate_findings`).
- Finding verification: `src/pipeline/finding_verification.py`.
