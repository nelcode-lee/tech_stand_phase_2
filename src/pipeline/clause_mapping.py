"""
Map compliance findings to policy_clause_records: narrow candidates → constrained LLM pick → verify.

Only emits status=linked when clause_id is in the candidate set and supporting_quote is a
substring of the row's requirement_text (whitespace-normalised).
"""
from __future__ import annotations

import logging
import os
import re

from src.pipeline.llm import completion, compliance_llm_temperature, parse_json_object
from src.pipeline.models import ComplianceFlag, DocLayer, PipelineContext, PolicyClauseMapping
from src.rag.document_registry import (
    distinct_policy_document_ids_for_standard_names,
    get_friendly_standard_name_for_document,
    get_site_scope_for_standard,
    query_policy_clauses_for_documents,
)
from src.rag.policy_clauses import _canonical_citation

log = logging.getLogger(__name__)

CLAUSE_MAPPING_ENABLED = os.environ.get("CLAUSE_MAPPING_ENABLED", "true").strip().lower() in (
    "1",
    "true",
    "yes",
)

# Documents whose standard_name in policy_clause_records is a raw filename rather than a clean
# label — listed here so they are always included in the candidate scope regardless of name match.
# Add new entries here if a standard is ingested without a clean standard_name.
_PINNED_POLICY_DOCUMENT_IDS: list[str] = [
    did.strip()
    for did in os.environ.get(
        "CLAUSE_MAPPING_PINNED_DOC_IDS",
        "14286_Cranswick_Manufacturing-Standard-Booklet_Update-2022_v4-(1)",
    ).split(",")
    if did.strip()
]

MIN_QUOTE_LEN = 16

CLAUSE_PICK_SYSTEM = """You are a compliance librarian mapping operational SOP findings to the policy standard clauses that govern them.

RULES:
- You MUST choose exactly one candidate id (e.g. C1) from the list, or the literal NONE.
- Choose the clause whose topic most closely governs the finding — even if the wording is abstract or regulatory rather than operational. Policy clauses describe the "what must be done"; findings describe the "what is missing". They will rarely use identical words.
- Only answer NONE if no candidate addresses the same subject area at all (completely different topic).
- supporting_quote MUST be copied verbatim from the requirement text of the chosen candidate only (a continuous substring). Minimum """ + str(MIN_QUOTE_LEN) + """ characters. Pick the sentence most directly relevant to the finding. If you chose NONE, use an empty string.
- Do not invent clause numbers or quote text that does not appear in the candidate block.
- Return only valid JSON, no markdown.

OUTPUT SHAPE:
{"choice":"C1","supporting_quote":"verbatim text from that candidate"}
or
{"choice":"NONE","supporting_quote":""}
"""


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


def _resolve_standard_for_display(row: dict) -> tuple[str | None, str | None]:
    """
    Resolve standard_name and canonical_citation for display.
    Uses site_standard_links when policy_clause_records has a raw filename as standard_name.
    """
    doc_id = (row.get("document_id") or "").strip()
    raw_std = (row.get("standard_name") or "").strip()
    clause_id = (row.get("clause_id") or "").strip()
    try:
        friendly = get_friendly_standard_name_for_document(doc_id) if doc_id else None
    except Exception:
        friendly = None
    display_std = friendly or raw_std or None
    if display_std and clause_id:
        cite = _canonical_citation(display_std, clause_id)
    else:
        cite = (row.get("canonical_citation") or "").strip() or None
    return display_std, cite


def _quote_verified(quote: str, requirement_text: str) -> bool:
    q = _norm_ws(quote)
    if len(q) < MIN_QUOTE_LEN:
        return False
    body = _norm_ws(requirement_text)
    return q in body


def _policy_scope_document_ids(ctx: PipelineContext) -> list[str]:
    """Registry document_ids for ingested standards that supply policy_clause_records."""
    out: list[str] = []
    if ctx.parent_policy and (ctx.parent_policy.id or "").strip():
        out.append(ctx.parent_policy.id.strip())
    for doc in ctx.higher_order_policies or []:
        did = (doc.id or "").strip()
        if did and did not in out:
            out.append(did)
    if ctx.policy_ref and (ctx.policy_ref or "").strip():
        pr = ctx.policy_ref.strip()
        if pr not in out:
            out.append(pr)
    out = list(dict.fromkeys(out))
    # SOP/WI/principle: merge IDs from DB so we still query clauses if parent_policy.id ≠ registry row.
    # Also pass pinned doc IDs for standards whose policy_clause_records.standard_name is a raw filename.
    if ctx.doc_layer in (DocLayer.sop, DocLayer.work_instruction, DocLayer.principle):
        for extra in distinct_policy_document_ids_for_standard_names(
            ["Cranswick Manufacturing Standard", "BRCGS Food Safety"],
            extra_document_ids=_PINNED_POLICY_DOCUMENT_IDS,
        ):
            if extra and extra not in out:
                out.append(extra)
    return out


def _finding_query_text(flag: ComplianceFlag) -> str:
    parts = [
        flag.issue or "",
        flag.recommendation or "",
        flag.excerpt or "",
        flag.location or "",
    ]
    return "\n".join(p for p in parts if p.strip()).strip()


def _build_candidate_prompt_block(candidates: list[dict]) -> tuple[str, dict[str, dict]]:
    """Return prompt fragment and map C1..Cn -> clause row."""
    lines: list[str] = []
    key_to_row: dict[str, dict] = {}
    for i, row in enumerate(candidates):
        cid = f"C{i + 1}"
        key_to_row[cid] = row
        cite = (row.get("canonical_citation") or "").strip()
        head = (row.get("heading") or "").strip()
        req = (row.get("requirement_text") or "").strip()
        if len(req) > 1200:
            req = req[:1197] + "..."
        title = f"{cid}: {cite}"
        if head:
            title += f" — {head}"
        lines.append(title)
        lines.append(req)
        lines.append("")
    return "\n".join(lines).strip(), key_to_row


async def _pick_clause_for_flag(flag: ComplianceFlag, candidates: list[dict]) -> PolicyClauseMapping:
    if not candidates:
        return PolicyClauseMapping(status="unmapped", unmapped_reason="no_candidates")

    block, key_to_row = _build_candidate_prompt_block(candidates)
    user = f"""FINDING TO MAP:
Location: {flag.location}
Issue: {flag.issue}
Recommendation: {flag.recommendation}
Excerpt: {flag.excerpt or "(none)"}

CANDIDATE CLAUSES (choose one id C1, C2, … or NONE):
{block}
"""
    try:
        raw = await completion(user, system=CLAUSE_PICK_SYSTEM, temperature=compliance_llm_temperature())
        data = parse_json_object(raw) or {}
    except Exception as e:
        log.warning("Clause mapping LLM failed: %s", e)
        return PolicyClauseMapping(status="unmapped", unmapped_reason="error")

    choice = str(data.get("choice") or data.get("candidate") or "").strip().upper()
    quote = str(data.get("supporting_quote") or "").strip()

    if choice == "NONE" or not choice:
        return PolicyClauseMapping(status="unmapped", unmapped_reason="model_none")

    # Normalise e.g. "c3" -> "C3"
    if choice.startswith("C") and choice[1:].isdigit():
        pass
    elif choice.isdigit():
        choice = f"C{choice}"
    else:
        # allow "C1" with extra noise
        m = re.search(r"C\s*(\d+)", choice, re.I)
        choice = f"C{int(m.group(1))}" if m else ""

    row = key_to_row.get(choice) if choice else None
    if not row:
        return PolicyClauseMapping(status="unmapped", unmapped_reason="verify_failed")

    req_text = (row.get("requirement_text") or "").strip()
    display_std, display_cite = _resolve_standard_for_display(row)
    if not _quote_verified(quote, req_text):
        return PolicyClauseMapping(
            status="unmapped",
            unmapped_reason="verify_failed",
            policy_document_id=row.get("document_id"),
            clause_id=row.get("clause_id"),
            canonical_citation=display_cite or row.get("canonical_citation"),
            standard_name=display_std or row.get("standard_name"),
        )

    preview_limit = int(os.environ.get("CLAUSE_PREVIEW_CHARS", "1200"))
    preview = req_text[:preview_limit] + ("…" if len(req_text) > preview_limit else "")
    return PolicyClauseMapping(
        status="linked",
        policy_document_id=row.get("document_id"),
        clause_id=row.get("clause_id"),
        canonical_citation=display_cite or row.get("canonical_citation"),
        standard_name=display_std or row.get("standard_name"),
        supporting_quote=quote[:2000] if len(quote) > 2000 else quote,
        requirement_preview=preview,
        unmapped_reason=None,
    )


def ensure_compliance_flags_have_clause_mapping(ctx: PipelineContext) -> None:
    """Set clause_mapping to not_run if still missing (e.g. enrichment skipped or failed)."""
    for flag in ctx.compliance_flags:
        if flag.clause_mapping is None:
            flag.clause_mapping = PolicyClauseMapping(status="unmapped", unmapped_reason="not_run")


async def enrich_compliance_flags_clause_mapping(ctx: PipelineContext) -> None:
    """
    Mutate ctx.compliance_flags in place with clause_mapping on each flag.
    Skips LLM when disabled but still records disabled reason.
    """
    if not CLAUSE_MAPPING_ENABLED:
        for flag in ctx.compliance_flags:
            flag.clause_mapping = PolicyClauseMapping(status="unmapped", unmapped_reason="disabled")
        return

    doc_ids = _policy_scope_document_ids(ctx)
    if not doc_ids:
        for flag in ctx.compliance_flags:
            flag.clause_mapping = PolicyClauseMapping(status="unmapped", unmapped_reason="no_policy_scope")
        return

    limit = int(os.environ.get("CLAUSE_MAPPING_CANDIDATE_LIMIT", "30"))

    for flag in ctx.compliance_flags:
        q = _finding_query_text(flag)
        candidates = query_policy_clauses_for_documents(doc_ids, q, limit=limit)
        log.debug(
            "Clause mapping: %d candidates for finding %r (doc_ids=%s)",
            len(candidates),
            (flag.issue or "")[:80],
            doc_ids,
        )
        try:
            mapping = await _pick_clause_for_flag(flag, candidates)
        except Exception as e:
            log.warning("Clause mapping error for flag: %s", e)
            mapping = PolicyClauseMapping(status="unmapped", unmapped_reason="error")

        # 3-hop: clause → standard → sites
        if mapping.status == "linked":
            try:
                mapping.site_scope = get_site_scope_for_standard(
                    standard_document_id=mapping.policy_document_id,
                    standard_name=mapping.standard_name,
                )
            except Exception as e:
                log.warning("site_scope lookup failed: %s", e)

        flag.clause_mapping = mapping
