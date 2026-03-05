"""Agent 4: Risk — identifies gaps, assumptions, and operational risks in procedures."""
import json
from pathlib import Path

from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE, JOB_TITLE_RULE, TOLERANCE_VS_REFERENCE_RULE
from src.pipeline.base_agent import BaseAgent
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

_SYSTEM_PROMPT_TEMPLATE = """You are the Risk and Assumption Gap Analyst for Cranswick PLC, a UK food manufacturing group operating across multiple site types including meat processing, bakery, prepared foods, and distribution.

DOCUMENT CONTEXT
- Document layer: {doc_layer}
- Sites in scope: {sites}
- Parent policy: {parent_policy_summary}
- Sibling documents (same layer, other sites): {sibling_summary}
- Conflicts already identified by the Conflict agent: {conflict_summary}

DOMAIN SEVERITY RULES (apply these when scoring)
{severity_rules}

FMEA SCORING — score each gap on three dimensions (1–5 each):
- Severity: {severity_scale}
- Scope: {scope_scale}
- Detectability: {detectability_scale}

ESCALATION CONTACTS (reference in recommendations where relevant)
{escalation_contacts}

CORE PRINCIPLES
- Assume zero tacit knowledge. Any step that requires prior experience must be flagged.
- No guessing or inventing missing details. Report only what is observable in the documents.
- Enumerate every gap independently — do not combine or summarise multiple gaps into one item.
- When an operator is asked to make a judgement without explicit criteria (e.g. "determine if acceptable", "ensure it is clean"), flag it as an unstated assumption.
- Distinguish between implicit assumptions (not stated anywhere) and explicit pre-requisites (stated elsewhere in the document).

YOU MUST IDENTIFY (inclusive of, but not limited to):
1. Unstated assumptions: assumed operator skills/knowledge, assumed equipment conditions, calibration or hygiene baseline assumed, prerequisites not stated
2. Missing critical information:
   - Corrective actions (what to do when something goes wrong)
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
- Score every gap using the FMEA dimensions above.

OUTPUT FORMAT
Return ONLY a JSON array. Each object:
{{"location": "<section, step, or heading>", "issue": "<the specific missing information or unsafe assumption>", "risk": "<factual consequence if left unaddressed>", "recommendation": "<exactly what information must be added>", "severity": <1-5>, "scope": <1-5>, "detectability": <1-5>}}

If no issues found, return [].
""" + DOCUMENT_REFERENCE_RULE + JOB_TITLE_RULE + TOLERANCE_VS_REFERENCE_RULE


def _build_system_prompt(ctx: PipelineContext) -> str:
    """Build a fully grounded system prompt using available context and domain config."""

    # --- doc layer ---
    doc_layer = ctx.doc_layer.value if ctx.doc_layer else "unknown"

    # --- sites ---
    sites = ", ".join(ctx.sites) if ctx.sites else "not specified"

    # --- parent policy summary ---
    if ctx.parent_policy:
        parent_policy_summary = (
            f'"{ctx.parent_policy.title}" ({ctx.parent_policy.doc_layer.value}): '
            f"{ctx.parent_policy.content[:800].strip()}…"
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
    fmea = _DOMAIN_CTX.get("fmea_scoring", {})
    severity_rules_lines = []
    for cat, meta in _DOMAIN_CTX.get("severity_rules", {}).get("categories", {}).items():
        severity_rules_lines.append(f"  - {cat}: {meta.get('note', '')}")
    severity_rules = "\n".join(severity_rules_lines) if severity_rules_lines else "  (not configured)"

    def _scale_lines(scale: dict) -> str:
        return " | ".join(f"{k}={v}" for k, v in scale.items()) if scale else "(not configured)"

    severity_scale = _scale_lines(fmea.get("severity_scale", {}))
    scope_scale = _scale_lines(fmea.get("scope_scale", {}))
    detectability_scale = _scale_lines(fmea.get("detectability_scale", {}))

    escalation = _DOMAIN_CTX.get("escalation_contacts", {})
    escalation_lines = [
        f"  - {band}: {contact}"
        for band, contact in escalation.items()
        if not band.startswith("_")
    ]
    escalation_contacts = "\n".join(escalation_lines) if escalation_lines else "  (not configured)"

    return _SYSTEM_PROMPT_TEMPLATE.format(
        doc_layer=doc_layer,
        sites=sites,
        parent_policy_summary=parent_policy_summary,
        sibling_summary=sibling_summary,
        conflict_summary=conflict_summary,
        severity_rules=severity_rules,
        severity_scale=severity_scale,
        scope_scale=scope_scale,
        detectability_scale=detectability_scale,
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
        sections.append(f"PRIMARY DOCUMENT (cleansed):\n{ctx.cleansed_content[:8000]}")

    # Parent policy (if available)
    if ctx.parent_policy:
        sections.append(
            f"PARENT POLICY — {ctx.parent_policy.title}:\n{ctx.parent_policy.content[:2000]}"
        )

    # Sibling docs (other sites — capped to avoid token overrun)
    for i, sib in enumerate(ctx.sibling_docs[:2]):
        sections.append(
            f"SIBLING DOCUMENT {i+1} — {sib.title} (sites: {', '.join(sib.sites) or 'unknown'}):\n"
            f"{sib.content[:1500]}"
        )

    return "\n\n---\n\n".join(sections) if sections else "No document content available."


def _fmea_score(severity: int, scope: int, detectability: int) -> int:
    """
    FMEA-style risk score.
    Score = severity × scope × (6 - detectability)
    Using (6 - detectability) so that a higher detectability number (harder to detect)
    raises the score, matching standard FMEA conventions where 5 = least detectable.
    Result range: 1×1×1=1 to 5×5×5=125 (normalised here to 1–25 band).
    """
    s = max(1, min(5, severity))
    sc = max(1, min(5, scope))
    d = max(1, min(5, detectability))
    return s * sc * (6 - d)


def _fmea_band(score: int) -> str:
    """Map raw FMEA score to a band using domain_context.json thresholds if available."""
    bands = _DOMAIN_CTX.get("fmea_scoring", {}).get("risk_bands", {})
    if bands:
        for band_name in ("critical", "high", "medium", "low"):
            b = bands.get(band_name, {})
            mn = b.get("min_score", 0)
            mx = b.get("max_score", 9999)
            if mn <= score <= mx:
                return band_name
    # fallback thresholds
    if score >= 20:
        return "critical"
    if score >= 12:
        return "high"
    if score >= 6:
        return "medium"
    return "low"


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

                # Parse FMEA dimensions the LLM returned
                sev = _safe_int(item.get("severity"), 0)
                sco = _safe_int(item.get("scope"), 0)
                det = _safe_int(item.get("detectability"), 0)

                # Only compute a score when all three dimensions were provided
                if sev and sco and det:
                    score = _fmea_score(sev, sco, det)
                    band = _fmea_band(score)
                else:
                    score = 0
                    band = ""

                gaps.append(
                    RiskGap(
                        location=item.get("location", ""),
                        issue=item.get("issue", ""),
                        risk=item.get("risk", ""),
                        recommendation=item.get("recommendation", ""),
                        severity=sev,
                        scope=sco,
                        detectability=det,
                        fmea_score=score,
                        fmea_band=band,
                    )
                )

            ctx.risk_gaps = gaps

            # Derive overall_risk from the highest FMEA band across all gaps
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
