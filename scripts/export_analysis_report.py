"""Export analysis JSON to a detailed Markdown report — covers all pipeline output fields."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _h(title: str, level: int = 2) -> str:
    return f"\n{'#' * level} {title}\n"


def _badge(label: str, value: str) -> str:
    return f"**{label}:** {value}  \n"


def _divider() -> str:
    return "\n---\n"


def _fmea_bar(score: int) -> str:
    """Simple ASCII bar for FMEA score (max raw score ~100)."""
    if not score:
        return ""
    filled = min(20, round(score / 5))
    bar = "█" * filled + "░" * (20 - filled)
    return f" `{bar}` {score}"


# ---------------------------------------------------------------------------
# Main export function
# ---------------------------------------------------------------------------

def export_from_dict(data: dict) -> str:
    """Build markdown report from analysis result dict. Returns the report string."""
    lines: list[str] = []

    # ── Header ──────────────────────────────────────────────────────────────
    doc_id = data.get("document_id", "—")
    title = data.get("title", "—")
    requester = data.get("requester", "—")
    analysis_date = data.get("analysis_date", "—")
    if analysis_date and analysis_date != "—":
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(analysis_date.replace("Z", "+00:00"))
            analysis_date = dt.strftime("%Y-%m-%d %H:%M UTC")
        except Exception:
            pass
    lines += [
        "# Analysis Report",
        "",
        _badge("Document", f"{doc_id} — {title}"),
        _badge("Requester", requester or "—"),
        _badge("Analysis Date", analysis_date),
        _badge("Tracking ID", data.get("tracking_id", "—")),
        _badge("Draft Ready", str(data.get("draft_ready", "—"))),
        _badge("Overall Risk", f'**{data.get("overall_risk", "—").upper()}**' if data.get("overall_risk") else "—"),
        _badge("Agents Run", ", ".join(data.get("agents_run", []))),
        _badge("Conflicts", str(data.get("conflict_count", len(data.get("conflicts", []))))),
        _badge("Blockers", str(data.get("blocker_count", 0))),
        _divider(),
    ]

    # ── Summary counts ───────────────────────────────────────────────────────
    lines.append(_h("Flag Summary", 2))
    count_rows = [
        ("Conflicts",               len(data.get("conflicts", []))),
        ("Terminology flags",        len(data.get("terminology_flags", []))),
        ("Risk gaps",                len(data.get("risk_gaps", []))),
        ("Specifying flags",         len(data.get("specifying_flags", []))),
        ("Structure flags",          len(data.get("structure_flags", []))),
        ("Content integrity flags",  len(data.get("content_integrity_flags", []))),
        ("Sequencing flags",         len(data.get("sequencing_flags", []))),
        ("Formatting flags",         len(data.get("formatting_flags", []))),
        ("Compliance flags",         len(data.get("compliance_flags", []))),
        ("Errors",                   len(data.get("errors", []))),
        ("Warnings",                 len(data.get("warnings", []))),
    ]
    lines.append("| Category | Count |")
    lines.append("|---|---|")
    for label, count in count_rows:
        lines.append(f"| {label} | {count} |")
    lines.append("")

    # ── Conflicts ────────────────────────────────────────────────────────────
    conflicts = data.get("conflicts", [])
    lines.append(_h("Conflicts", 2))
    lines.append(f"**Count:** {len(conflicts)}\n")
    for i, c in enumerate(conflicts, 1):
        lines.append(_h(f"Conflict {i}", 3))
        lines.append(_badge("Type", c.get("conflict_type", "")))
        lines.append(_badge("Severity", c.get("severity", "").upper()))
        lines.append(_badge("Layer", c.get("layer", "")))
        lines.append(_badge("Sites", ", ".join(c.get("sites", [])) or "—"))
        lines.append(_badge("Documents", ", ".join(c.get("document_refs", [])) or "—"))
        lines.append(_badge("Blocks Draft", str(c.get("blocks_draft", False))))
        if c.get("citations"):
            lines.append(_badge("Citations", ", ".join(c.get("citations", []))))
        lines.append(f"\n> {c.get('description', '')}\n")
        lines.append(f"**Recommendation:** {c.get('recommendation', '')}\n")

    # ── Terminology flags ────────────────────────────────────────────────────
    terms = data.get("terminology_flags", [])
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

    # ── Risk gaps (with FMEA) ────────────────────────────────────────────────
    gaps = data.get("risk_gaps", [])
    lines.append(_h("Risk Gaps", 2))
    lines.append(f"**Count:** {len(gaps)}\n")

    # Sort by FMEA score descending so highest-risk items appear first
    gaps_sorted = sorted(gaps, key=lambda g: g.get("fmea_score", 0), reverse=True)
    for g in gaps_sorted:
        band = g.get("fmea_band", "").upper()
        score = g.get("fmea_score", 0)
        sev = g.get("severity", 0)
        sco = g.get("scope", 0)
        det = g.get("detectability", 0)
        fmea_str = (
            f"FMEA {band} — Score: {_fmea_bar(score)}  "
            f"(S={sev} × Sc={sco} × D={det})"
            if score else "*(not scored)*"
        )
        lines.append(f"- **{g.get('location', '—')}** — {fmea_str}")
        lines.append(f"  - *Issue:* {g.get('issue', '')}")
        lines.append(f"  - *Risk:* {g.get('risk', '')}")
        lines.append(f"  - *Recommendation:* {g.get('recommendation', '')}")
        lines.append("")

    # ── Specifying flags ─────────────────────────────────────────────────────
    specs = data.get("specifying_flags", [])
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

    # ── Structure flags ──────────────────────────────────────────────────────
    structs = data.get("structure_flags", [])
    lines.append(_h("Structure Flags (Template Compliance)", 2))
    lines.append(f"**Count:** {len(structs)}\n")
    if structs:
        lines.append("| Severity | Type | Section | Detail |")
        lines.append("|---|---|---|---|")
        for s in structs:
            sev = s.get("severity", "").upper()
            ftype = s.get("flag_type", "")
            section = s.get("section", "—")
            detail = s.get("detail", "").replace("|", "\\|")
            lines.append(f"| {sev} | {ftype} | {section} | {detail} |")
        lines.append("")
        for s in structs:
            lines.append(f"- **{s.get('section', '—')}** ({s.get('flag_type', '')})")
            lines.append(f"  - {s.get('detail', '')}")
            lines.append(f"  - *Recommendation:* {s.get('recommendation', '')}")
            lines.append("")

    # ── Content integrity flags ──────────────────────────────────────────────
    integ = data.get("content_integrity_flags", [])
    lines.append(_h("Content Integrity Flags", 2))
    lines.append(f"**Count:** {len(integ)}\n")

    # Group by flag_type for readability
    from collections import defaultdict
    integ_by_type: dict[str, list] = defaultdict(list)
    for flag in integ:
        integ_by_type[flag.get("flag_type", "other")].append(flag)

    type_labels = {
        "non_text_element":    "Non-Text Elements (images, tables, diagrams)",
        "truncated_step":      "Truncated Steps",
        "fragmented_sentence": "Fragmented Sentences",
        "incomplete_list":     "Incomplete Lists",
        "us_spelling":         "US Spelling",
        "encoding_anomaly":    "Encoding Anomalies",
    }
    for ftype, flags in integ_by_type.items():
        label = type_labels.get(ftype, ftype.replace("_", " ").title())
        lines.append(_h(f"{label} ({len(flags)})", 3))
        for f in flags:
            sev = f.get("severity", "").upper()
            loc = f.get("location", "—")
            excerpt = f.get("excerpt", "")
            lines.append(f"- **[{sev}]** `{loc}`")
            if excerpt:
                lines.append(f"  - *Excerpt:* `{excerpt}`")
            lines.append(f"  - *Detail:* {f.get('detail', '')}")
            lines.append(f"  - *Recommendation:* {f.get('recommendation', '')}")
            lines.append("")

    # ── Sequencing flags ─────────────────────────────────────────────────────
    seqs = data.get("sequencing_flags", [])
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

    # ── Formatting flags ─────────────────────────────────────────────────────
    fmts = data.get("formatting_flags", [])
    lines.append(_h("Formatting Flags", 2))
    lines.append(f"**Count:** {len(fmts)}\n")
    for f in fmts:
        lines.append(f"- **{f.get('location', '—')}**")
        lines.append(f"  - *Issue:* {f.get('issue', '')}")
        lines.append(f"  - *Recommendation:* {f.get('recommendation', '')}")
        lines.append("")

    # ── Compliance flags ─────────────────────────────────────────────────────
    comps = data.get("compliance_flags", [])
    lines.append(_h("Compliance Flags", 2))
    lines.append(f"**Count:** {len(comps)}\n")
    for c in comps:
        lines.append(f"- **{c.get('location', '—')}**")
        if c.get("excerpt"):
            lines.append(f"  - *Excerpt:* `{c.get('excerpt', '')}`")
        lines.append(f"  - *Issue:* {c.get('issue', '')}")
        lines.append(f"  - *Reference:* {c.get('requirement_reference', '—')}")
        if c.get("citations"):
            lines.append(f"  - *Citations:* {', '.join(c.get('citations', []))}")
        lines.append(f"  - *Recommendation:* {c.get('recommendation', '')}")
        lines.append("")

    # ── Risk scores (legacy) ─────────────────────────────────────────────────
    scores = data.get("risk_scores", [])
    if scores:
        lines.append(_h("Risk Scores (Legacy)", 2))
        for r in scores:
            lines.append(f"- {r.get('location', '—')}: {r.get('band', '—')}")
        lines.append("")

    # ── Errors & warnings ────────────────────────────────────────────────────
    errs = data.get("errors", [])
    warns = data.get("warnings", [])
    if errs or warns:
        lines.append(_h("Errors & Warnings", 2))
        for e in errs:
            if isinstance(e, dict):
                lines.append(f"- **Error [{e.get('severity', '')}] ({e.get('agent', '')})**:  {e.get('message', e)}")
            else:
                lines.append(f"- **Error:** {e}")
        for w in warns:
            lines.append(f"- **Warning:** {w}")
        lines.append("")

    return "\n".join(lines)


def export(json_path: Path, out_path: Path | None = None) -> str:
    """Load analysis JSON from file and export to markdown."""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    report = export_from_dict(data)
    out_path = out_path or json_path.with_suffix(".md")
    out_path.write_text(report, encoding="utf-8")
    return str(out_path)


def main():
    default = Path(__file__).resolve().parent.parent / "test_result_vehicle_loading.json"
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    if not src.exists():
        print(f"File not found: {src}")
        sys.exit(1)
    out = export(src)
    print(f"Report saved to {out}")


if __name__ == "__main__":
    main()
