"""
Post-pipeline verification: drop false-positive findings already answered elsewhere in the document.

Targets cases like "temperature range not specified for form X" when the following sub-bullets
(3a, 3b) or adjacent steps state the limits. Each suppression requires a verbatim quote that
appears in the document (whitespace-normalised substring check).
"""
from __future__ import annotations

import json
import logging
import os
import re

from src.pipeline.context_limits import slice_document_for_agent
from src.pipeline.llm import completion, parse_json_object
from src.pipeline.models import PipelineContext, RiskLevel

log = logging.getLogger(__name__)

FINDING_VERIFICATION_ENABLED = os.environ.get("FINDING_VERIFICATION_ENABLED", "true").strip().lower() in (
    "1",
    "true",
    "yes",
)

MIN_VERIFICATION_QUOTE_LEN = 25

_BAND_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}
_RISK_LEVEL_MAP = {
    "low": RiskLevel.low,
    "medium": RiskLevel.medium,
    "high": RiskLevel.high,
    "critical": RiskLevel.critical,
}

VERIFICATION_SYSTEM = """You are a senior technical reviewer for food-manufacturing SOPs.

TASK
You receive the FULL procedure text and a list of automated FINDINGS. Each finding claims something is missing, vague, or wrong.

Decide which findings are FALSE POSITIVES because the document ALREADY satisfies the claim when read as a whole — especially:
- The SAME numbered step, sub-step (3a, 3b), or bullet immediately following the quoted excerpt
- A later step in the same Procedure section that gives limits, references, or criteria the finding says are absent
- Cross-references to forms (e.g. FSR…) where the required limits appear in adjacent lines

DO NOT suppress if:
- The document truly omits the criterion, or only vague language exists ("appropriate", "as required") with no measurable value
- The finding is about contradiction, sequencing error, or terminology — only suppress "missing information" type issues that ARE present elsewhere

GROUNDING (mandatory for every suppression)
For each finding you suppress, you MUST provide supporting_verbatim_quote: copy a CONTIGUOUS substring from the DOCUMENT TEXT below that proves the requirement/limit/reference exists. Minimum """ + str(MIN_VERIFICATION_QUOTE_LEN) + """ characters. If you cannot copy such a substring, DO NOT suppress that finding.

OUTPUT
Return ONLY valid JSON:
{"suppressed": [{"id": "<id from list>", "supporting_verbatim_quote": "<exact substring from document>"}]}
If nothing should be suppressed, return {"suppressed": []}.
No markdown, no commentary."""


def _norm_ws(s: str) -> str:
    t = s or ""
    for a, b in (
        ("\u2019", "'"),
        ("\u2018", "'"),
        ("\u201c", '"'),
        ("\u201d", '"'),
        ("\u2013", "-"),
        ("\u2014", "-"),
        ("\u00a0", " "),
    ):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t.strip().lower())


def _quote_verified_in_doc(quote: str, doc: str) -> bool:
    q = _norm_ws(quote)
    if len(q) < MIN_VERIFICATION_QUOTE_LEN:
        return False
    return q in _norm_ws(doc)


def _document_text_for_verification(ctx: PipelineContext) -> str:
    return (ctx.draft_content or ctx.cleansed_content or "").strip()


def _build_finding_manifest(ctx: PipelineContext) -> list[dict]:
    """Flat list of {id, kind, summary} for the LLM."""
    rows: list[dict] = []

    def add(kind: str, idx: int, issue: str, excerpt: str | None, location: str | None) -> None:
        ex = (excerpt or "").strip()[:400]
        loc = (location or "").strip()[:200]
        iss = (issue or "").strip()[:500]
        rows.append(
            {
                "id": f"{kind}:{idx}",
                "kind": kind,
                "location": loc,
                "excerpt": ex,
                "issue": iss,
            }
        )

    for i, g in enumerate(ctx.risk_gaps):
        add("risk", i, g.issue, g.excerpt, g.location)
    for i, s in enumerate(ctx.specifying_flags):
        add("specifying", i, s.issue, s.current_text, s.location)
    for i, s in enumerate(ctx.sequencing_flags):
        add("sequencing", i, s.issue, s.excerpt, s.location)
    for i, c in enumerate(ctx.compliance_flags):
        add("compliance", i, c.issue, c.excerpt, c.location)
    for i, f in enumerate(ctx.formatting_flags):
        add("formatting", i, f.issue, f.excerpt, f.location)
    for i, c in enumerate(ctx.cleanser_flags):
        add("cleanser", i, c.issue, c.current_text, c.location)

    return rows


def _batch_manifest(rows: list[dict], batch_size: int) -> list[list[dict]]:
    return [rows[i : i + batch_size] for i in range(0, len(rows), batch_size)]


async def _verify_batch(doc_slice: str, batch: list[dict]) -> list[tuple[str, str]]:
    """Return list of (id, quote) verified to appear in doc_slice."""
    lines = [f"- {json.dumps(r, ensure_ascii=False)}" for r in batch]
    user = (
        "DOCUMENT TEXT:\n```\n"
        + doc_slice
        + "\n```\n\nFINDINGS TO REVIEW (use exact id strings):\n"
        + "\n".join(lines)
    )
    raw = await completion(user, system=VERIFICATION_SYSTEM)
    data = parse_json_object(raw) or {}
    suppressed = data.get("suppressed")
    if not isinstance(suppressed, list):
        return []
    out: list[tuple[str, str]] = []
    for item in suppressed:
        if not isinstance(item, dict):
            continue
        fid = str(item.get("id") or "").strip()
        quote = str(item.get("supporting_verbatim_quote") or "").strip()
        if not fid or not _quote_verified_in_doc(quote, doc_slice):
            continue
        out.append((fid, quote))
    return out


def _recompute_overall_risk(ctx: PipelineContext) -> None:
    gaps = ctx.risk_gaps
    if not gaps:
        ctx.overall_risk = RiskLevel.low
        return
    highest_band = max(
        (g.fmea_band for g in gaps if g.fmea_band),
        key=lambda b: _BAND_ORDER.get(b, 0),
        default="medium",
    )
    ctx.overall_risk = _RISK_LEVEL_MAP.get(highest_band, RiskLevel.medium)


def _apply_suppressions(ctx: PipelineContext, suppress_ids: set[str]) -> int:
    """Remove suppressed findings by id. Returns count removed."""
    # Map id "risk:3" -> kind risk, index 3 — apply by sorting indices descending per kind
    by_kind: dict[str, list[int]] = {}
    for sid in suppress_ids:
        if ":" not in sid:
            continue
        k, _, rest = sid.partition(":")
        try:
            idx = int(rest)
        except ValueError:
            continue
        by_kind.setdefault(k, []).append(idx)
    removed_total = 0

    def drop_by_indices(items: list, kind: str) -> list:
        nonlocal removed_total
        drop = set(by_kind.get(kind, []))
        if not drop:
            return items
        new_list = [x for i, x in enumerate(items) if i not in drop]
        removed_total += len(items) - len(new_list)
        return new_list

    ctx.risk_gaps = drop_by_indices(list(ctx.risk_gaps), "risk")
    ctx.specifying_flags = drop_by_indices(list(ctx.specifying_flags), "specifying")
    ctx.sequencing_flags = drop_by_indices(list(ctx.sequencing_flags), "sequencing")
    ctx.compliance_flags = drop_by_indices(list(ctx.compliance_flags), "compliance")
    ctx.formatting_flags = drop_by_indices(list(ctx.formatting_flags), "formatting")
    ctx.cleanser_flags = drop_by_indices(list(ctx.cleanser_flags), "cleanser")

    _recompute_overall_risk(ctx)
    return removed_total


async def run_finding_verification(ctx: PipelineContext) -> None:
    """
    Mutate ctx: remove false-positive findings grounded by verbatim document quotes.
    Appends 'finding_verification' to agents_run when work was attempted.
    """
    if not FINDING_VERIFICATION_ENABLED:
        return

    doc = _document_text_for_verification(ctx)
    if not doc:
        return

    manifest = _build_finding_manifest(ctx)
    if not manifest:
        return

    ctx.agents_run.append("finding_verification")

    doc_slice = slice_document_for_agent(doc)
    batch_size = int(os.environ.get("FINDING_VERIFICATION_BATCH_SIZE", "18"))

    suppress_ids: set[str] = set()
    try:
        for batch in _batch_manifest(manifest, batch_size):
            pairs = await _verify_batch(doc_slice, batch)
            for fid, _q in pairs:
                suppress_ids.add(fid)
    except Exception as e:
        log.warning("Finding verification failed: %s", e)
        ctx.warnings.append("Finding verification step failed; all findings kept.")
        return

    if not suppress_ids:
        return

    removed = _apply_suppressions(ctx, suppress_ids)
    if removed:
        ctx.warnings.append(
            f"Finding verification removed {removed} item(s) already addressed in the document (verbatim-checked)."
        )
