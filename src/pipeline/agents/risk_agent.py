"""Agent 4: Risk — identifies gaps, assumptions, and operational risks in procedures."""
import json
import re
from pathlib import Path

from src.pipeline.agent_rules import (
    DOCUMENT_REFERENCE_RULE,
    JOB_TITLE_RULE,
    TOLERANCE_VS_REFERENCE_RULE,
    CORRECTIVE_ACTIONS_RULE,
)
from src.pipeline.base_agent import BaseAgent
from src.pipeline.context_limits import max_policy_context_per_doc_chars, slice_document_for_agent
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import PipelineContext, RiskGap, RiskLevel

# ---------------------------------------------------------------------------
# Domain context — loaded once at import time from domain_context.json.
# Fallback to empty dict if file is missing so the agent still runs.
# ---------------------------------------------------------------------------

_DOMAIN_CONTEXT_PATH = Path(__file__).resolve().parents[2] / "domain_context.json"

def _load_domain_context() -> dict:
    try:
        return json.loads(_DOMAIN_CONTEXT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}

_DOMAIN_CTX = _load_domain_context()

# ---------------------------------------------------------------------------
# Site-type category map
# Cranswick operates across multiple business types. The agent tailors its
# site-specific checks based on the doc_layer and sites metadata.
# ---------------------------------------------------------------------------

_SITE_TYPE_CATEGORIES: dict[str, list[str]] = {
    "meat": [
        "Raw/cooked segregation not defined",
        "Species control or traceability not specified",
        "Refrigeration/chill chain controls missing or imprecise",
        "Foreign body control unclear (e.g. bone, metal, cartilage)",
        "Microbiological limits (APC, Enterobacteriaceae) not referenced",
        "Yield or trim specifications absent",
    ],
    "bakery": [
        "Allergen cross-contact controls for flour/nuts/eggs not defined",
        "Bake temperature and time tolerances not specified",
        "Proofing or fermentation conditions not defined",
        "Packaging integrity requirements absent",
        "Foreign body control for glass/hard plastic not referenced",
    ],
    "prepared_foods": [
        "Cook/chill step temperatures and hold times not specified",
        "Allergen declaration requirements not referenced",
        "Shelf-life validation not mentioned",
        "Packaging atmosphere (MAP/vacuum) controls not defined",
        "Foreign body control (physical/chemical/biological) not specified",
    ],
    "distribution": [
        "Vehicle temperature monitoring requirements not defined",
        "Loading/unloading hygiene requirements not specified",
        "Segregation of allergen or high-risk products not referenced",
        "Driver / operative training requirements not stated",
        "Chain of custody or traceability during transit not addressed",
        "Missing Unloading procedure — significant omission if title includes unloading",
        "No corrective action when vehicle is unsuitable (dirty, damaged, temperature out of range)",
        "Temperature checks only on last dolly — forces complete unloading if out of spec; add preventative step (e.g. random checks before loading)",
        "Seal requirements unclear: trailers only or vehicles too? Which document records this?",
    ],
    "default": [
        "Process-specific hazard controls not defined",
        "Product or material traceability not addressed",
        "Foreign body or contamination controls not specified",
        "Allergen management not referenced",
    ],
}

_CROSS_DOC_CATEGORIES = [
    "Missing reference to HACCP plan or Critical Control Point (CCP)",
    "CCP validation or monitoring requirements not referenced",
    "No link to relevant customer specification or retailer code of practice",
    "Conflict with or missing reference to parent policy/principle",
    "No reference to related site technical documentation (e.g. cleaning schedule, pest control log)",
    "Regulatory reference absent (e.g. Food Safety Act, BRC/BRCGS standard, CODEX)",
    "No section on unloading when title or scope implies it",
    "Product returns incorrectly included in procedure where not applicable",
    "No guidance on SOP linkages (e.g. load label creation)",
    "No defined process for CMEX update confirming full order completion",
    "Document control for vehicle seal tags not clarified",
]

# HACCP score = Severity × Likelihood × Detectability (each 1–6; detectability optional).
_HACCP_SCORING_BLOCK = """HACCP (Hazard Analysis and Critical Control Points) — RISK PRIORITISATION FOR GAPS
HACCP is the systematic approach to identifying, evaluating, and controlling food safety hazards. A **Critical Control Point (CCP)** is a step at which control can be applied and is essential to prevent or eliminate a food safety hazard or reduce it to an acceptable level.
- When a gap relates to **missing HACCP plan reference**, **undefined CCP monitoring**, **corrective action at a CCP**, or **hazard control** that should be visible in the procedure, treat it as **food safety / HACCP** relevance — apply **DOMAIN SEVERITY RULES** for `food_safety_haccp` and `ccp_control` (severity floors).
- Do not invent site-specific HACCP content; flag **document-level** absences or ambiguities (what the text does or does not say). CODEX and BRCGS references appear under applicable standards when provided.

HACCP SCORE — for **each gap**, relate it to a **hazard the SOP should manage** (quality, food safety, or regulatory). Reason through:
- Does this SOP **prevent or control** that hazard, or is control **missing / unclear**?
- **Severity:** if control fails, how bad is the outcome?
- **Likelihood:** how likely is failure **under current controls** as written (or absent) in the document?
- **Detectability (optional):** how hard is it to **notice** failure before harm? If you cannot judge, omit `detectability` or use 0 — the platform applies a neutral default for scoring only.

**Formula:** HACCP Score = Severity × Likelihood × Detectability (each dimension is an integer **1–6**). The platform computes the product — do **not** output the score in JSON; output the integers only.

**Example (illustrative):** Hazard: metal contamination. Control referenced: metal detector check. Severity = 6, Likelihood = 2, Detectability = 2 → score = 6 × 2 × 2 = 24.

SEVERITY (1–6) — consequence if the hazard / control fails
1 — Negligible: no plausible food-safety impact
2 — Minor: inconvenience, minor quality issue
3 — Moderate: compliance concern, limited batch impact
4 — Major: serious quality or regulatory exposure; illness unlikely but plausible in worst case
5 — Severe: serious illness or major regulatory breach plausible
6 — Catastrophic: life-threatening harm, recall, or widespread exposure (e.g. CCP failure, allergen cross-line)

LIKELIHOOD (1–6) — probability the control fails as written or is missing, under conditions implied by the text
1 — Very unlikely: robust, verifiable control described
2 — Unlikely: control present but some ambiguity
3 — Possible: partial control or reliance on vigilance
4 — Likely: weak control, unclear frequency, or human-error path
5 — Very likely: control missing or contradicted where required
6 — Almost certain: no effective control where the hazard demands one

DETECTABILITY (1–6) — optional — how hard is failure to detect before product moves on or reaches the customer (1 = easy to catch early, 6 = very hard to catch). Omit or 0 if not applicable.
"""

_SYSTEM_PROMPT_TEMPLATE = """You are a systematic document gap analyst. Your role is to review controlled procedures, policies, and operational documents and identify — without inference or invention — gaps, unstated assumptions, and missing information that could cause a document to fail in practice, fail an audit, or be misexecuted by someone unfamiliar with the process. You are an analytical reviewer, not a subject matter expert. You report only what is observable in the text and what is absent relative to applicable standards and grounding documents. You do not speculate about intent or supply content that is not grounded in the document under review. You have access to grounding documents and organisational standards through the sources listed under "GROUNDING DOCUMENT ACCESS" below. You use these to surface requirements that should be present but are not — including gaps the document gives no indication of. Finding information in a grounding document does not resolve a gap; it confirms what is missing from the document under review. You analyse documents as they exist at the time of review. You do not assume information exists elsewhere unless it is explicitly present in the provided document context. You do not assume an operator would locate missing information through another route. Your findings will be reviewed by {primary_audience} who hold accountability for compliance and operational correctness. Your role is to surface what requires their judgement — not to exercise it yourself.

DOCUMENT CONTEXT
{organisation_context}
- Sector: {sector}
- Document types in scope: {document_types}
- Applicable standards: {governing_standards}
- Site types covered: {site_types}

5. GROUNDING DOCUMENT ACCESS
You have access to the following grounding sources:
{grounding_sources}
Use these sources to:
- Identify requirements that SHOULD be reflected in this document but are absent — including requirements the document gives no indication of (unknown unknowns)
- Verify whether a cited form, procedure, or reference actually exists
- Identify where this document's content contradicts a parent policy or governing standard
- Identify scope gaps: activities, roles, or scenarios covered in grounding documents but unaddressed here
Do NOT use grounding documents to:
- Conclude that a gap is resolved because the information exists elsewhere — if it is required in this document and absent, flag it regardless
- Infer that an operator would find the missing information via another route — the document must stand independently unless it explicitly cross-references the other source
- Invent policy requirements that do not exist in the provided context

ADDITIONAL REVIEW CONTEXT (this request)
- Document layer: {doc_layer}
- Sites in scope: {sites}
- Parent policy (summary): {parent_policy_summary}
- Sibling documents (same layer, other sites): {sibling_summary}
- Conflicts already identified by the Conflict agent: {conflict_summary}
{agent_instructions_block}
{prior_feedback_block}
{glossary_block}

DOMAIN SEVERITY RULES (apply these when scoring)
{severity_rules}

{haccp_scoring_block}

ESCALATION CONTACTS (reference in recommendations where relevant)
{escalation_contacts}

CORE PRINCIPLES
- Assume zero tacit knowledge. Any step that requires prior experience must be flagged.
- No guessing or inventing missing details. Report only what is observable in the documents.
- Enumerate every gap independently — do not combine or summarise multiple gaps into one item.
- When an operator is asked to make a judgement without explicit criteria (e.g. "determine if acceptable", "ensure it is clean"), flag it as an unstated assumption.
- Distinguish between implicit assumptions (not stated anywhere) and explicit pre-requisites (stated elsewhere in the document).

DIVISION OF LABOUR (Risk Assessor vs Sequencer) — STRICT
- You own ABSENCE and OMISSION: missing steps (including safety or control steps that never appear in the text), missing information, unstated assumptions, and gaps vs grounding documents where something required is not reflected in the procedure.
- The Sequencer owns PRESENT-BUT-WRONG-ORDER: steps that exist in the document but violate the document’s own stated or implied sequencing logic, sign-off timing, or internal contradiction about order.
- Do not output findings that only say “reorder steps” when the issue is that a step never appears — that remains your gap. If the document names two steps and their order contradicts an explicit dependency in the same text, defer that ordering judgement to the Sequencer; your job is then only any separate content gap if applicable.

YOU MUST IDENTIFY (inclusive of, but not limited to):
1. Unstated assumptions: assumed operator skills/knowledge, assumed equipment conditions, calibration or hygiene baseline assumed, prerequisites not stated
2. Missing critical information:
   - Corrective actions (what to do when something goes wrong) — but do NOT flag when the document describes specific actions in the same paragraph (who to inform, what to do, timeframes, escalation, product handling). See CORRECTIVE_ACTIONS_RULE.
   - Escalation procedure: who to escalate to, the trigger point (condition or threshold), and how to escalate
   - Verification methods and record-keeping requirements (what must be recorded, where, and for how long)
   - Responsible role or job title not named (job titles are appropriate; named individuals are not for controlled procedures)
   - Tolerances, limits, or acceptable ranges not defined
3. Frequency definitions: any requirement described as "regularly", "periodically", "frequently", "as needed", "as required", or similar without an explicit interval (e.g. "every 30 minutes", "daily")
4. Safety gaps: CCP monitoring actions missing specificity, temperature ranges missing units or tolerances, pre-start or hygiene steps missing, allergen or segregation risks unstated
5. Site-type specific gaps: {site_type_categories}
6. Cross-document gaps: {cross_doc_categories}
7. New-user risks: any step that requires tacit or experiential knowledge to execute correctly; ambiguous instructions that a new operative could reasonably misinterpret

RULES
- Do not fill gaps. Report only what is observable.
- Each gap must be a separate JSON object. Never merge two gaps into one object.
- Score every gap using the HACCP dimensions above (severity and likelihood each 1–6; detectability 1–6 or omit/0). HACCP Score is computed server-side as Severity × Likelihood × Detectability — do not add a "haccp_score" or "rpn" field.
- Optional **hazard_control_type** (per gap): if the gap clearly relates to a documented or implied **CCP** (critical control point), **oPRP** (operational prerequisite programme / significant hazard control that is not a CCP), or **PRP** (basic prerequisite programme / GMP-hygiene foundation), set exactly one of `"ccp"`, `"oprp"`, `"prp"`. Use `""` when the text does not support a classification. Do not guess: only tag when the excerpt or issue explicitly concerns CCP monitoring/limits, oPRP-style operational controls, or PRP/GMP programmes.
- Recommendations must be implementation-ready, not generic. Prefer concrete wording operators can paste into the SOP:
  include trigger condition, responsible role, immediate containment action, escalation path, and required record/form where relevant.
- Avoid vague recommendations like "define specific corrective actions". Instead propose the specific actions to add.

OUTPUT FORMAT
Return ONLY a JSON array. Each object:
{{"location": "<section, step, or heading>", "excerpt": "<exact quote from document — the text that relates to this gap; copy-paste from source>", "issue": "<the specific missing information or unsafe assumption>", "risk": "<factual consequence if left unaddressed>", "recommendation": "<exactly what information must be added>", "severity": <1-6>, "likelihood": <1-6>, "detectability": <1-6 or 0>, "hazard_control_type": "" | "ccp" | "oprp" | "prp"}}

CRITICAL: "excerpt" must be the exact text from the document that relates to the gap — this is used to highlight the relevant passage in the original. If the gap concerns missing content, quote the nearest surrounding text (e.g. the step or paragraph where the gap applies).

If no issues found, return [].
""" + DOCUMENT_REFERENCE_RULE + JOB_TITLE_RULE + TOLERANCE_VS_REFERENCE_RULE + CORRECTIVE_ACTIONS_RULE


def _build_grounding_sources(ctx: PipelineContext) -> str:
    """Bullet list of what grounding material is available for this run (section 5 of system prompt)."""
    lines: list[str] = []
    if ctx.parent_policy:
        lines.append(
            f'- Direct parent policy: "{ctx.parent_policy.title}" '
            "(full excerpt in USER message under DIRECT PARENT POLICY)"
        )
    for i, doc in enumerate((ctx.higher_order_policies or [])[:4]):
        lines.append(
            f'- Higher-order policy {i + 1}: "{doc.title}" (excerpt in USER message)'
        )
    if ctx.sibling_docs:
        lines.append(
            f"- Sibling / parallel site documents: {len(ctx.sibling_docs)} "
            "(excerpts in USER message)"
        )
    lines.append(
        "- Standard glossary: present in this system prompt when the STANDARD GLOSSARY block is included"
    )
    lines.append(
        "- Domain severity rules, HACCP (Hazard Analysis and Critical Control Points) risk scoring (RPN), and escalation contacts: defined later in this system prompt"
    )
    if not ctx.parent_policy and not (ctx.higher_order_policies or []) and not ctx.sibling_docs:
        lines.insert(
            0,
            "(No parent or sibling policy documents in this request — rely on PRIMARY DOCUMENT in the USER "
            "message plus applicable standards under DOCUMENT CONTEXT.)",
        )
    return "\n".join(lines)


def _build_system_prompt(ctx: PipelineContext) -> str:
    """Build a fully grounded system prompt using available context and domain config."""

    # --- doc layer ---
    doc_layer = ctx.doc_layer.value if ctx.doc_layer else "unknown"

    # --- sites ---
    sites = ", ".join(ctx.sites) if ctx.sites else "not specified"

    # --- parent policy summary ---
    policy_docs = []
    if ctx.parent_policy:
        policy_docs.append(ctx.parent_policy)
    policy_docs.extend(ctx.higher_order_policies or [])
    if policy_docs:
        parent_policy_summary = "\n".join(
            f'  - "{doc.title}" ({doc.doc_layer.value}): {(doc.content or "")[:400].strip()}…'
            for doc in policy_docs[:2]
        )
    else:
        parent_policy_summary = "not provided"

    # --- sibling docs summary ---
    if ctx.sibling_docs:
        sibling_lines = [
            f'  - "{s.title}" (sites: {", ".join(s.sites) or "unknown"}): '
            f"{s.content[:300].strip()}…"
            for s in ctx.sibling_docs[:3]
        ]
        sibling_summary = "\n" + "\n".join(sibling_lines)
    else:
        sibling_summary = "none retrieved"

    # --- agent instructions (user-provided knowledge; never supersedes policy) ---
    if ctx.agent_instructions and ctx.agent_instructions.strip():
        agent_instructions_block = (
            "\nADDITIONAL CONTEXT (from requester — use to inform your analysis; policy and standards always take precedence):\n"
            f"{ctx.agent_instructions.strip()}\n"
        )
    else:
        agent_instructions_block = ""

    # --- prior feedback (user-added knowledge; check before reasoning) ---
    if getattr(ctx, "prior_feedback", None):
        prior = [f for f in ctx.prior_feedback if (f.get("note") or "").strip()]
        if prior:
            prior_lines = [f"  - [{f.get('agent_key', '')}] {f.get('note', '').strip()}" for f in prior[:15]]
            prior_feedback_block = "\nPRIOR FEEDBACK (from users — check before reasoning; align recommendations with this where relevant):\n" + "\n".join(prior_lines) + "\n"
        else:
            prior_feedback_block = ""
    else:
        prior_feedback_block = ""

    # --- conflicts summary ---
    if ctx.conflicts:
        conflict_lines = [
            f'  - [{c.severity.upper()}] {c.conflict_type}: {c.description}'
            for c in ctx.conflicts
        ]
        conflict_summary = "\n" + "\n".join(conflict_lines)
    else:
        conflict_summary = "none identified by Conflict agent"

    # --- site-type categories ---
    site_type_key = _infer_site_type(ctx)
    cats = _SITE_TYPE_CATEGORIES.get(site_type_key, _SITE_TYPE_CATEGORIES["default"])
    site_type_note = f"(site type inferred: {site_type_key})\n   - " + "\n   - ".join(cats)

    # --- cross-doc categories ---
    cross_doc_note = "\n   - " + "\n   - ".join(_CROSS_DOC_CATEGORIES)

    # --- domain context fields (from domain_context.json) ---
    severity_rules_lines = []
    for cat, meta in _DOMAIN_CTX.get("severity_rules", {}).get("categories", {}).items():
        severity_rules_lines.append(f"  - {cat}: {meta.get('note', '')}")
    severity_rules = "\n".join(severity_rules_lines) if severity_rules_lines else "  (not configured)"

    escalation = _DOMAIN_CTX.get("escalation_contacts", {})
    escalation_lines = [
        f"  - {band}: {contact}"
        for band, contact in escalation.items()
        if not band.startswith("_")
    ]
    escalation_contacts = "\n".join(escalation_lines) if escalation_lines else "  (not configured)"

    glossary_block = ""
    if getattr(ctx, "glossary_block", None) and (ctx.glossary_block or "").strip():
        glossary_block = "\nSTANDARD GLOSSARY (use for consistent terminology when a finding relates to a defined term):\n" + (ctx.glossary_block or "").strip()

    # Optional overrides via domain_context.json (top-level keys)
    organisation_context = _DOMAIN_CTX.get("organisation_context") or (
        "Cranswick PLC — UK food manufacturing group operating across meat processing, bakery, "
        "prepared foods, and distribution."
    )
    sector = _DOMAIN_CTX.get("sector") or "Food manufacturing and distribution (United Kingdom)"
    document_types = _DOMAIN_CTX.get("document_types") or (
        "Controlled procedures, policies, principles, SOPs, work instructions, and operational documents "
        f"as applicable; current request document layer: {doc_layer}"
    )
    frameworks = (_DOMAIN_CTX.get("regulatory_references") or {}).get("frameworks") or []
    governing_standards = _DOMAIN_CTX.get("governing_standards") or (
        "; ".join(frameworks)
        if frameworks
        else (
            "BRCGS Food Safety Standard, applicable UK/EU food hygiene law, and Cranswick technical "
            "standards (use only what appears in provided context)"
        )
    )
    primary_audience = _DOMAIN_CTX.get("primary_audience") or (
        "process owners, quality assurance, and technical standards reviewers"
    )
    grounding_sources = _build_grounding_sources(ctx)

    return _SYSTEM_PROMPT_TEMPLATE.format(
        organisation_context=organisation_context,
        sector=sector,
        document_types=document_types,
        governing_standards=governing_standards,
        site_types=sites,
        primary_audience=primary_audience,
        grounding_sources=grounding_sources,
        doc_layer=doc_layer,
        sites=sites,
        parent_policy_summary=parent_policy_summary,
        sibling_summary=sibling_summary,
        conflict_summary=conflict_summary,
        agent_instructions_block=agent_instructions_block,
        prior_feedback_block=prior_feedback_block,
        glossary_block=glossary_block,
        severity_rules=severity_rules,
        haccp_scoring_block=_HACCP_SCORING_BLOCK,
        escalation_contacts=escalation_contacts,
        site_type_categories=site_type_note,
        cross_doc_categories=cross_doc_note,
    )


def _infer_site_type(ctx: PipelineContext) -> str:
    """
    Infer site type from sites list and doc layer.
    Can be extended to use a config lookup when site metadata is richer.
    """
    sites_lower = " ".join(ctx.sites).lower()
    content_lower = (ctx.cleansed_content or "").lower()

    if any(kw in sites_lower or kw in content_lower for kw in ("bak", "bread", "flour", "dough")):
        return "bakery"
    if any(kw in sites_lower or kw in content_lower for kw in ("distribut", "transport", "vehicle", "logistics")):
        return "distribution"
    if any(kw in sites_lower or kw in content_lower for kw in ("prepared", "ready meal", "cook-chill", "chilled")):
        return "prepared_foods"
    # default to meat — Cranswick's primary business
    return "meat"


def _build_prompt(ctx: PipelineContext) -> str:
    """Build the user-turn prompt with all available document content."""
    sections: list[str] = []

    # Primary document (cleansed)
    if ctx.cleansed_content:
        sections.append(
            "PRIMARY DOCUMENT (cleansed) — the SOP/procedure under review:\n"
            "Ground every risk gap in this text (quote excerpt/location from here). "
            "Policy sections below are for requirement comparison only; do not report gaps that appear only in policy wording unless the PRIMARY DOCUMENT fails to meet that requirement.\n\n"
            f"{slice_document_for_agent(ctx.cleansed_content)}"
        )

    # Parent policy (if available)
    policy_cap = max_policy_context_per_doc_chars()
    policy_docs = []
    if ctx.parent_policy:
        policy_docs.append(ctx.parent_policy)
    policy_docs.extend(ctx.higher_order_policies or [])
    for i, doc in enumerate(policy_docs[:2]):
        label = "DIRECT PARENT POLICY" if i == 0 else f"HIGHER-ORDER POLICY {i}"
        pbody = (doc.content or "").strip()
        if len(pbody) > policy_cap:
            pbody = pbody[:policy_cap]
        sections.append(
            f"{label} - {doc.title}:\n{pbody}"
        )

    # Sibling docs (other sites — capped to avoid token overrun)
    sib_cap = min(8000, max(policy_cap // 2, 4000))
    for i, sib in enumerate(ctx.sibling_docs[:2]):
        sbody = (sib.content or "").strip()
        if len(sbody) > sib_cap:
            sbody = sbody[:sib_cap]
        sections.append(
            f"SIBLING DOCUMENT {i+1} — {sib.title} (sites: {', '.join(sib.sites) or 'unknown'}):\n"
            f"{sbody}"
        )

    return "\n\n---\n\n".join(sections) if sections else "No document content available."


def _rpn_score(severity: int, likelihood: int, detectability: int) -> int:
    """
    HACCP score = Severity × Likelihood × Detectability.
    Each dimension clamped 1–6. Range 1–216. Pass detectability including default (3) if omitted by LLM.
    """
    s = max(1, min(6, severity))
    l_ = max(1, min(6, likelihood))
    d = max(1, min(6, detectability))
    return s * l_ * d


def _rpn_band(score: int) -> str:
    """Map raw HACCP score to a band using domain_context.json haccp_risk_scoring.risk_bands if available."""
    cfg = _DOMAIN_CTX.get("haccp_risk_scoring") or _DOMAIN_CTX.get("fmea_scoring")  # legacy domain_context key
    bands = (cfg or {}).get("risk_bands", {})
    if bands:
        for band_name in ("critical", "high", "medium", "low"):
            b = bands.get(band_name, {})
            mn = b.get("min_score", 0)
            mx = b.get("max_score", 9999)
            if mn <= score <= mx:
                return band_name
    # fallback for S×L×D (1–216)
    if score >= 172:
        return "critical"
    if score >= 104:
        return "high"
    if score >= 48:
        return "medium"
    return "low"


_GENERIC_RECOMMENDATION_PATTERNS = (
    r"^\s*define\s+specific\b",
    r"^\s*define\s+corrective\b",
    r"^\s*provide\s+specific\b",
    r"^\s*add\s+specific\b",
    r"^\s*clarify\b",
)


def _recommendation_is_generic(text: str | None) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return True
    return any(re.search(pat, t) for pat in _GENERIC_RECOMMENDATION_PATTERNS)


def _normalize_hazard_control_type(raw) -> str:
    """Map LLM output to ccp | oprp | prp | ''."""
    s = str(raw or "").strip().lower().replace(" ", "").replace("-", "")
    if s in ("ccp",):
        return "ccp"
    if s in ("oprp", "opr"):
        return "oprp"
    if s in ("prp",):
        return "prp"
    return ""


def _make_recommendation_specific(location: str | None, issue: str | None, recommendation: str | None) -> str:
    """Convert generic risk recommendations into concrete draft-ready wording."""
    rec = (recommendation or "").strip()
    if not _recommendation_is_generic(rec):
        return rec
    loc = (location or "relevant step").strip()
    issue_text = (issue or "product integrity concern").strip()
    return (
        f'Add a corrective-action block in "{loc}" for "{issue_text}": '
        "if product integrity is compromised, stop the line, place affected product on HOLD/QUARANTINE, "
        "inform the Line Leader and QA immediately, record lot/batch and time in the non-conformance record, "
        "start root-cause investigation, and only release product after QA sign-off."
    )


_BAND_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}
_RISK_LEVEL_MAP = {
    "low": RiskLevel.low,
    "medium": RiskLevel.medium,
    "high": RiskLevel.high,
    "critical": RiskLevel.critical,
}


class RiskAgent(BaseAgent):
    name = "risk"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        if not ctx.cleansed_content:
            ctx.overall_risk = RiskLevel.low
            return ctx

        system_prompt = _build_system_prompt(ctx)
        prompt = _build_prompt(ctx)

        try:
            raw = await completion(prompt, system=system_prompt)
            items = parse_json_array(raw)
            gaps: list[RiskGap] = []
            for item in items:
                if not isinstance(item, dict) or not item.get("issue"):
                    continue

                # Parse HACCP dimensions (likelihood accepts legacy key "scope")
                sev = _safe_int(item.get("severity"), 0)
                lik = _safe_int(item.get("likelihood"), 0) or _safe_int(item.get("scope"), 0)
                det_raw = _safe_int(item.get("detectability"), 0)
                det_for_score = det_raw if det_raw > 0 else 3  # optional D: neutral default

                # Score when severity and likelihood are present (required); detectability may be defaulted
                if sev and lik:
                    score = _rpn_score(sev, lik, det_for_score)
                    band = _rpn_band(score)
                else:
                    score = 0
                    band = ""

                excerpt = (item.get("excerpt") or "").strip() or None
                recommendation = _make_recommendation_specific(
                    item.get("location", ""),
                    item.get("issue", ""),
                    item.get("recommendation", ""),
                )
                hz = _normalize_hazard_control_type(item.get("hazard_control_type"))
                gaps.append(
                    RiskGap(
                        location=item.get("location", ""),
                        excerpt=excerpt,
                        issue=item.get("issue", ""),
                        risk=item.get("risk", ""),
                        recommendation=recommendation,
                        severity=sev,
                        likelihood=lik,
                        detectability=det_raw,
                        fmea_score=score,
                        fmea_band=band,
                        hazard_control_type=hz,
                    )
                )

            ctx.risk_gaps = gaps

            # Derive overall_risk from the highest RPN band across all gaps
            if gaps:
                highest_band = max(
                    (g.fmea_band for g in gaps if g.fmea_band),
                    key=lambda b: _BAND_ORDER.get(b, 0),
                    default="medium",
                )
                ctx.overall_risk = _RISK_LEVEL_MAP.get(highest_band, RiskLevel.medium)
            else:
                ctx.overall_risk = RiskLevel.low

        except Exception as e:
            self._add_error(ctx, f"Risk LLM failed: {e}", "high")
            ctx.overall_risk = RiskLevel.low

        return ctx


def _safe_int(val, default: int) -> int:
    """Coerce LLM-returned value to int, falling back to default."""
    try:
        return int(val)
    except (TypeError, ValueError):
        return default
