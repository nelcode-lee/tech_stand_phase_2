"""
Markdown export for analysis results — used by scripts and POST /analysis/audit-pack.

Compliance section includes policy clause_mapping (citation, verified quote, site scope).
"""
from __future__ import annotations

import json
from collections import defaultdict

# Must match frontend `stableFindingId` / `itemForFindingIdHash` (strip volatile + hazard_control_type).
_FINDING_ID_HASH_SKIP = frozenset({
    "policy_evidence",
    "policyEvidence",
    "citations",
    "requirement_reference",
    "clause_mapping",
    "hazard_control_type",
})


def _item_for_finding_id_hash(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in _FINDING_ID_HASH_SKIP}


def _js_int32(x: int) -> int:
    x &= 0xFFFFFFFF
    if x >= 0x80000000:
        x -= 0x100000000
    return x


def _js_string_hash(s: str) -> int:
    h = 0
    for ch in s:
        h = _js_int32(((h << 5) - h) + ord(ch))
    return h


def stable_finding_id(agent_key: str, item: dict | None) -> str:
    """Same algorithm as frontend `stableFindingId` for persistence / audit exports."""
    if not isinstance(item, dict):
        return f"{agent_key}:0"
    payload = json.dumps(
        _item_for_finding_id_hash(item),
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    return f"{agent_key}:{_js_string_hash(payload)}"


def hazard_control_label(val: str) -> str:
    """Normalize stored tag to display label; empty if unset."""
    v = (val or "").strip().lower()
    if v == "ccp":
        return "CCP"
    if v == "oprp":
        return "oPRP"
    if v == "prp":
        return "PRP"
    return ""


def effective_hazard_control_for_risk_gap(gap: dict, fht: dict) -> str:
    """User map (`finding_hazard_control_tags`) overrides model `hazard_control_type`."""
    if not isinstance(gap, dict):
        return ""
    fid = stable_finding_id("risk", gap)
    raw = fht.get(fid) if isinstance(fht, dict) else None
    if raw is None:
        raw = fht.get(str(fid)) if isinstance(fht, dict) else None
    user = (str(raw).strip() if raw is not None else "")
    if user:
        return user
    return str(gap.get("hazard_control_type") or "").strip()


def _h(title: str, level: int = 2) -> str:
    return f"\n{'#' * level} {title}\n"


def _badge(label: str, value: str) -> str:
    return f"**{label}:** {value}  \n"


def _divider() -> str:
    return "\n---\n"


def _haccp_rpn_bar(score: int) -> str:
    if not score:
        return ""
    # Visual bar: max HACCP score S×L×D = 6×6×6 = 216
    filled = min(20, round(score / 10.8))
    bar = "█" * filled + "░" * (20 - filled)
    return f" `{bar}` {score}"


def _sites_display(data: dict) -> str:
    sites = data.get("sites")
    if isinstance(sites, list) and sites:
        return ", ".join(str(s) for s in sites)
    if isinstance(sites, str) and sites.strip():
        return sites.strip()
    return "—"


def _format_clause_mapping_lines(cm: dict | None) -> list[str]:
    """Markdown lines for compliance policy clause_mapping."""
    if not cm or not isinstance(cm, dict):
        return ["  - *Policy clause mapping:* *(none)*"]
    status = (cm.get("status") or "unmapped").strip()
    lines: list[str] = [f"  - *Policy clause status:* `{status}`"]
    if status == "linked":
        cite = (cm.get("canonical_citation") or "").strip() or "—"
        std = (cm.get("standard_name") or "").strip() or "—"
        lines.append(f"  - *Standard:* {std}")
        lines.append(f"  - *Citation:* {cite}")
        sq = (cm.get("supporting_quote") or "").strip()
        if sq:
            cap = 600
            lines.append(f"  - *Verified match (from clause):* {sq[:cap]}{'…' if len(sq) > cap else ''}")
        prev = (cm.get("requirement_preview") or "").strip()
        if prev:
            cap2 = 900
            lines.append(f"  - *Clause text (preview):* {prev[:cap2]}{'…' if len(prev) > cap2 else ''}")
        scope = cm.get("site_scope")
        if isinstance(scope, list) and scope:
            lines.append(f"  - *Sites in scope:* {', '.join(str(s) for s in scope)}")
    else:
        reason = (cm.get("unmapped_reason") or "—").strip()
        lines.append(f"  - *Unmapped reason:* `{reason}`")
        tent = (cm.get("canonical_citation") or cm.get("clause_id") or "").strip()
        if tent:
            lines.append(f"  - *Tentative reference:* {tent}")
    return lines


def export_from_dict(data: dict, *, audit_pack: bool = False) -> str:
    """Build markdown report from analysis result dict. Set audit_pack=True for audit-oriented header and scope."""
    lines: list[str] = []

    doc_id = data.get("document_id", "—")
    title = data.get("title", "—")
    requester = data.get("requester", "—")
    analysis_date = data.get("analysis_date", "—")
    if analysis_date and analysis_date != "—":
        try:
            from datetime import datetime

            dt = datetime.fromisoformat(str(analysis_date).replace("Z", "+00:00"))
            analysis_date = dt.strftime("%Y-%m-%d %H:%M UTC")
        except Exception:
            pass

    if audit_pack:
        lines += [
            "# Audit & regulatory readiness pack",
            "",
            "Automated analysis summary for audit preparation. Policy clause links are shown where verified against ingested standard text.",
            "",
            _badge("Document", f"{doc_id} — {title}"),
            _badge("Document layer", str(data.get("doc_layer") or "—")),
            _badge("Sites", _sites_display(data)),
            _badge("Policy reference", str(data.get("policy_ref") or "—")),
            _badge("Requester", requester or "—"),
            _badge("Analysis date", analysis_date),
            _badge("Tracking ID", data.get("tracking_id", "—")),
            _badge("Draft ready", str(data.get("draft_ready", "—"))),
            _badge("Overall risk", f'**{data.get("overall_risk", "—").upper()}**' if data.get("overall_risk") else "—"),
            _badge("Agents run", ", ".join(data.get("agents_run", []) or [])),
            _badge("Conflicts", str(data.get("conflict_count", len(data.get("conflicts", []))))),
            _badge("Blockers", str(data.get("blocker_count", 0))),
            _divider(),
        ]
        so_user = (data.get("sign_off_user") or "").strip()
        so_stmt = (data.get("sign_off_statement") or "").strip()
        so_at = data.get("sign_off_at") or ""
        if so_user or so_stmt or so_at:
            lines.append(_h("Human review / sign-off", 2))
            lines.append(_badge("Signed off by", so_user or "—"))
            lines.append(_badge("Statement", so_stmt or "—"))
            lines.append(_badge("Signed off at", str(so_at) if so_at else "—"))
            lines.append(_divider())
        fd = data.get("finding_dispositions") if isinstance(data.get("finding_dispositions"), dict) else {}
        fgn = data.get("finding_governance_notes") if isinstance(data.get("finding_governance_notes"), dict) else {}
        fht = data.get("finding_hazard_control_tags") if isinstance(data.get("finding_hazard_control_tags"), dict) else {}
        risk_hz_model: dict[str, str] = {}
        for _g in data.get("risk_gaps") or []:
            if isinstance(_g, dict):
                rid = stable_finding_id("risk", _g)
                risk_hz_model[rid] = str(_g.get("hazard_control_type") or "").strip()
        row_ids = sorted(set(fd.keys()) | set(fgn.keys()) | set(fht.keys()), key=lambda x: str(x))
        if row_ids:
            lines.append(_h("Finding disposition (QA)", 2))
            lines.append("| Finding ID | Disposition | Governance note | Hazard control |")
            lines.append("|---|---|---|---|")
            for fid in row_ids:
                disp = fd.get(fid, "")
                note = (fgn.get(fid) or "").strip()
                if isinstance(disp, dict):
                    disp = str(disp)
                hz_raw = str(fht.get(fid) or "").strip() or risk_hz_model.get(str(fid), "")
                hz = hazard_control_label(hz_raw) or "—"
                lines.append(f"| `{fid}` | {disp or '—'} | {note or '—'} | {hz} |")
            lines.append("")
            lines.append(_divider())
    else:
        lines += [
            "# Analysis Report",
            "",
            _badge("Document", f"{doc_id} — {title}"),
            _badge("Requester", requester or "—"),
            _badge("Analysis Date", analysis_date),
            _badge("Tracking ID", data.get("tracking_id", "—")),
            _badge("Draft Ready", str(data.get("draft_ready", "—"))),
            _badge("Overall Risk", f'**{data.get("overall_risk", "—").upper()}**' if data.get("overall_risk") else "—"),
            _badge("Agents Run", ", ".join(data.get("agents_run", []) or [])),
            _badge("Conflicts", str(data.get("conflict_count", len(data.get("conflicts", []))))),
            _badge("Blockers", str(data.get("blocker_count", 0))),
            _divider(),
        ]

    lines.append(_h("Flag Summary", 2))
    count_rows = [
        ("Conflicts", len(data.get("conflicts", []) or [])),
        ("Terminology flags", len(data.get("terminology_flags", []) or [])),
        ("Risk gaps", len(data.get("risk_gaps", []) or [])),
        ("Cleanser flags", len(data.get("cleanser_flags", []) or [])),
        ("Specifying flags", len(data.get("specifying_flags", []) or [])),
        ("Structure flags", len(data.get("structure_flags", []) or [])),
        ("Content integrity flags", len(data.get("content_integrity_flags", []) or [])),
        ("Sequencing flags", len(data.get("sequencing_flags", []) or [])),
        ("Formatting flags", len(data.get("formatting_flags", []) or [])),
        ("Compliance flags", len(data.get("compliance_flags", []) or [])),
        ("Errors", len(data.get("errors", []) or [])),
        ("Warnings", len(data.get("warnings", []) or [])),
    ]
    lines.append("| Category | Count |")
    lines.append("|---|---|")
    for label, count in count_rows:
        lines.append(f"| {label} | {count} |")
    lines.append("")

    conflicts = data.get("conflicts", []) or []
    lines.append(_h("Conflicts", 2))
    lines.append(f"**Count:** {len(conflicts)}\n")
    for i, c in enumerate(conflicts, 1):
        lines.append(_h(f"Conflict {i}", 3))
        lines.append(_badge("Type", str(c.get("conflict_type", ""))))
        lines.append(_badge("Severity", str(c.get("severity", "")).upper()))
        lines.append(_badge("Layer", str(c.get("layer", ""))))
        lines.append(_badge("Sites", ", ".join(c.get("sites", []) or []) or "—"))
        lines.append(_badge("Documents", ", ".join(c.get("document_refs", []) or []) or "—"))
        lines.append(_badge("Blocks Draft", str(c.get("blocks_draft", False))))
        if c.get("citations"):
            lines.append(_badge("Citations", ", ".join(c.get("citations", []))))
        lines.append(f"\n> {c.get('description', '')}\n")
        lines.append(f"**Recommendation:** {c.get('recommendation', '')}\n")

    terms = data.get("terminology_flags", []) or []
    lines.append(_h("Terminology Flags", 2))
    lines.append(f"**Count:** {len(terms)}\n")
    for t in terms:
        lines.append(f"- **{t.get('term', '—')}**")
        if t.get("location"):
            lines.append(f"  - *Location:* {t.get('location', '')}")
        if t.get("citations"):
            lines.append(f"  - *Citations:* {', '.join(t.get('citations', []))}")
        lines.append(f"  - *Issue:* {t.get('issue', '')}")
        lines.append(f"  - *Recommendation:* {t.get('recommendation', '')}")
        lines.append("")

    gaps = data.get("risk_gaps", []) or []
    fht_all = data.get("finding_hazard_control_tags") if isinstance(data.get("finding_hazard_control_tags"), dict) else {}
    lines.append(_h("Risk Gaps", 2))
    lines.append(f"**Count:** {len(gaps)}\n")
    gaps_sorted = sorted(gaps, key=lambda g: g.get("fmea_score", 0) or 0, reverse=True)
    for g in gaps_sorted:
        band = str(g.get("fmea_band", "")).upper()
        score = g.get("fmea_score", 0) or 0
        sev = g.get("severity", 0)
        lik = g.get("likelihood") or g.get("scope", 0)
        det = g.get("detectability", 0)
        rpn_str = (
            f"HACCP RPN {band} — Score: {_haccp_rpn_bar(int(score))}  "
            f"(S={sev} × L={lik} × D={det or '3 (default)'})"
            if score
            else "*(not scored)*"
        )
        lines.append(f"- **{g.get('location', '—')}** — {rpn_str}")
        if isinstance(g, dict):
            hz_l = hazard_control_label(effective_hazard_control_for_risk_gap(g, fht_all))
            if hz_l:
                lines.append(f"  - *Hazard control (CCP / oPRP / PRP):* {hz_l}")
        lines.append(f"  - *Issue:* {g.get('issue', '')}")
        lines.append(f"  - *Risk:* {g.get('risk', '')}")
        lines.append(f"  - *Recommendation:* {g.get('recommendation', '')}")
        lines.append("")

    specs = data.get("specifying_flags", []) or []
    lines.append(_h("Specifying Flags (Vague Language)", 2))
    lines.append(f"**Count:** {len(specs)}\n")
    for s in specs:
        lines.append(f"- **{s.get('location', '—')}**")
        lines.append(f"  - *Current text:* `{s.get('current_text', '')}`")
        if s.get("citations"):
            lines.append(f"  - *Citations:* {', '.join(s.get('citations', []))}")
        lines.append(f"  - *Issue:* {s.get('issue', '')}")
        lines.append(f"  - *Recommendation:* {s.get('recommendation', '')}")
        lines.append("")

    structs = data.get("structure_flags", []) or []
    lines.append(_h("Structure Flags (Template Compliance)", 2))
    lines.append(f"**Count:** {len(structs)}\n")
    if structs:
        lines.append("| Severity | Type | Section | Detail |")
        lines.append("|---|---|---|---|")
        for s in structs:
            sev = str(s.get("severity", "")).upper()
            ftype = str(s.get("flag_type", ""))
            section = str(s.get("section", "—"))
            detail = str(s.get("detail", "")).replace("|", "\\|")
            lines.append(f"| {sev} | {ftype} | {section} | {detail} |")
        lines.append("")
        for s in structs:
            lines.append(f"- **{s.get('section', '—')}** ({s.get('flag_type', '')})")
            lines.append(f"  - {s.get('detail', '')}")
            lines.append(f"  - *Recommendation:* {s.get('recommendation', '')}")
            lines.append("")

    integ = data.get("content_integrity_flags", []) or []
    lines.append(_h("Content Integrity Flags", 2))
    lines.append(f"**Count:** {len(integ)}\n")
    integ_by_type: dict[str, list] = defaultdict(list)
    for flag in integ:
        integ_by_type[str(flag.get("flag_type", "other"))].append(flag)
    type_labels = {
        "non_text_element": "Non-Text Elements (images, tables, diagrams)",
        "truncated_step": "Truncated Steps",
        "fragmented_sentence": "Fragmented Sentences",
        "incomplete_list": "Incomplete Lists",
        "us_spelling": "US Spelling",
        "encoding_anomaly": "Encoding Anomalies",
    }
    for ftype, flags in integ_by_type.items():
        label = type_labels.get(ftype, ftype.replace("_", " ").title())
        lines.append(_h(f"{label} ({len(flags)})", 3))
        for f in flags:
            sev = str(f.get("severity", "")).upper()
            loc = f.get("location", "—")
            excerpt = f.get("excerpt", "")
            lines.append(f"- **[{sev}]** `{loc}`")
            if excerpt:
                lines.append(f"  - *Excerpt:* `{excerpt}`")
            lines.append(f"  - *Detail:* {f.get('detail', '')}")
            lines.append(f"  - *Recommendation:* {f.get('recommendation', '')}")
            lines.append("")

    seqs = data.get("sequencing_flags", []) or []
    lines.append(_h("Sequencing Flags", 2))
    lines.append(f"**Count:** {len(seqs)}\n")
    for s in seqs:
        lines.append(f"- **{s.get('location', '—')}**")
        if s.get("excerpt"):
            lines.append(f"  - *Excerpt:* `{s.get('excerpt', '')}`")
        if s.get("citations"):
            lines.append(f"  - *Citations:* {', '.join(s.get('citations', []))}")
        lines.append(f"  - *Issue:* {s.get('issue', '')}")
        lines.append(f"  - *Impact:* {s.get('impact', '')}")
        lines.append(f"  - *Recommendation:* {s.get('recommendation', '')}")
        lines.append("")

    fmts = data.get("formatting_flags", []) or []
    lines.append(_h("Formatting Flags", 2))
    lines.append(f"**Count:** {len(fmts)}\n")
    for f in fmts:
        lines.append(f"- **{f.get('location', '—')}**")
        lines.append(f"  - *Issue:* {f.get('issue', '')}")
        lines.append(f"  - *Recommendation:* {f.get('recommendation', '')}")
        lines.append("")

    comps = data.get("compliance_flags", []) or []
    section_title = "Compliance Flags (with policy clause mapping)" if audit_pack else "Compliance Flags"
    lines.append(_h(section_title, 2))
    lines.append(f"**Count:** {len(comps)}\n")
    for idx, c in enumerate(comps, 1):
        lines.append(_h(f"Compliance item {idx}", 3))
        lines.append(f"- **Location:** {c.get('location', '—')}")
        if c.get("excerpt"):
            lines.append(f"  - *Excerpt:* `{c.get('excerpt', '')}`")
        lines.append(f"  - *Issue:* {c.get('issue', '')}")
        lines.append(f"  - *Reference:* {c.get('requirement_reference', '—')}")
        if c.get("citations"):
            lines.append(f"  - *Citations:* {', '.join(c.get('citations', []))}")
        lines.extend(_format_clause_mapping_lines(c.get("clause_mapping")))
        lines.append(f"  - *Recommendation:* {c.get('recommendation', '')}")
        lines.append("")

    scores = data.get("risk_scores", []) or []
    if scores:
        lines.append(_h("Risk Scores (Legacy)", 2))
        for r in scores:
            lines.append(f"- {r.get('location', '—')}: {r.get('band', '—')}")
        lines.append("")

    errs = data.get("errors", []) or []
    warns = data.get("warnings", []) or []
    if errs or warns:
        lines.append(_h("Errors & Warnings", 2))
        for e in errs:
            if isinstance(e, dict):
                lines.append(
                    f"- **Error [{e.get('severity', '')}] ({e.get('agent', '')})**:  {e.get('message', e)}"
                )
            else:
                lines.append(f"- **Error:** {e}")
        for w in warns:
            lines.append(f"- **Warning:** {w}")
        lines.append("")

    return "\n".join(lines)


def export_audit_pack_from_dict(data: dict) -> str:
    """Convenience wrapper for audit-oriented export."""
    return export_from_dict(data, audit_pack=True)
