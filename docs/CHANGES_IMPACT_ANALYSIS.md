# Changes That Could Affect Analysis (Session Summary)

## Changes Made During Firewall/VPN Issues

### 1. **Backend – `document_registry.py`**
- **Change:** Added `connect_timeout=15` to DB connection
- **Impact:** Connection attempts fail after 15s instead of hanging indefinitely
- **Analysis impact:** None – makes DB fail fast when unreachable; when DB works, normal behavior

### 2. **Backend – `clause_mapping.py`**
- **Change:** Added `_resolve_standard_for_display()` and `get_friendly_standard_name_for_document` for compliance clause citation display
- **Impact:** Improves how standard names (e.g. BRCGS, Cranswick) appear under policy clause
- **Analysis impact:** None – display-only. Adds try/except so DB lookup failures fall back to raw values and do not break the pipeline

### 3. **Frontend – `api.js`, `ConfigurePage.jsx`, `AnalysePage.jsx`**
- **Change:** Request timeouts, navigation fixes for document switching, FSP003/FSP007 mismatch fix
- **Impact:** Better UX when loading docs, correct document shown when switching
- **Analysis impact:** None – frontend only

### 4. **Frontend – `vite.config.js`**
- **Change:** Proxy timeout 120s
- **Impact:** Longer requests less likely to fail at proxy
- **Analysis impact:** None – proxy only

---

## What Could Still Affect Analysis

1. **OpenAI/Azure API** – Slow or failing LLM calls will make analysis hang or timeout
2. **DB during analysis** – `list_documents`, `query_policy_clauses_for_documents`, `get_site_scope_for_standard` all hit the DB; if slow, analysis delays
3. **Analysis timeout** – Full 8-agent run can exceed 120s; use streaming from UI for progress

---

## Verification

- **DB connection:** OK (tested)
- **Backend health:** OK
- **Analysis test:** Timed out at 120s – may need longer timeout or may indicate backend/OpenAI bottleneck

---

## Recommendation

1. Run analysis from the **UI** (http://localhost:5173) with streaming – you’ll see which agent is running
2. If it hangs on a specific step, check backend logs for errors
3. Confirm `OPENAI_API_KEY` or Azure credentials are set and valid
4. For scripted tests, increase timeout (e.g. 300s) for full pipeline runs
