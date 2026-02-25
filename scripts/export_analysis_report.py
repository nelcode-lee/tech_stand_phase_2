"""Export analysis JSON to a detailed Markdown report."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _section(title: str, level: int = 2) -> str:
    return f"\n{'#' * level} {title}\n\n"


def _item(title: str, content: str, indent: str = "") -> str:
    return f"{indent}- **{title}:** {content}\n"


def export(json_path: Path, out_path: Path | None = None) -> str:
    """Convert analysis JSON to Markdown report."""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    out_path = out_path or json_path.with_suffix(".md")

    lines = [
        "# Analysis Report",
        "",
        f"**Tracking ID:** {data.get('tracking_id', '—')}",
        f"**Draft Ready:** {data.get('draft_ready')}",
        f"**Overall Risk:** {data.get('overall_risk', '—')}",
        f"**Agents Run:** {', '.join(data.get('agents_run', []))}",
        "",
        "---",
    ]

    # Conflicts
    conflicts = data.get("conflicts", [])
    lines.append(_section("Conflicts", 2))
    lines.append(f"**Count:** {len(conflicts)}\n")
    for i, c in enumerate(conflicts, 1):
        lines.append(f"### Conflict {i}\n")
        lines.append(_item("Type", c.get("conflict_type", "")))
        lines.append(_item("Severity", c.get("severity", "")))
        lines.append(_item("Layer", c.get("layer", "")))
        lines.append(_item("Documents", ", ".join(c.get("document_refs", []))))
        lines.append(_item("Description", c.get("description", "")))
        lines.append(_item("Recommendation", c.get("recommendation", "")))
        lines.append("")

    # Terminology flags
    terms = data.get("terminology_flags", [])
    lines.append(_section("Terminology Flags", 2))
    lines.append(f"**Count:** {len(terms)}\n")
    for t in terms:
        lines.append(f"- **{t.get('term', '—')}**")
        if t.get("location"):
            lines.append(f"  - Location (quote): {t.get('location', '')}")
        lines.append(f"  - Issue: {t.get('issue', '')}")
        lines.append(f"  - Recommendation: {t.get('recommendation', '')}")
        lines.append("")

    # Specifying flags
    specs = data.get("specifying_flags", [])
    lines.append(_section("Specifying Flags", 2))
    lines.append(f"**Count:** {len(specs)}\n")
    for s in specs:
        lines.append(f"- **{s.get('location', '—')}**")
        lines.append(f"  - Current text: {s.get('current_text', '')}")
        lines.append(f"  - Issue: {s.get('issue', '')}")
        lines.append(f"  - Recommendation: {s.get('recommendation', '')}")
        lines.append("")

    # Sequencing flags
    seqs = data.get("sequencing_flags", [])
    lines.append(_section("Sequencing Flags", 2))
    lines.append(f"**Count:** {len(seqs)}\n")
    for s in seqs:
        lines.append(f"- **{s.get('location', '—')}**")
        lines.append(f"  - Issue: {s.get('issue', '')}")
        lines.append(f"  - Impact: {s.get('impact', '')}")
        lines.append(f"  - Recommendation: {s.get('recommendation', '')}")
        lines.append("")

    # Formatting flags
    fmts = data.get("formatting_flags", [])
    lines.append(_section("Formatting Flags", 2))
    lines.append(f"**Count:** {len(fmts)}\n")
    for f in fmts:
        lines.append(f"- **{f.get('location', '—')}**")
        lines.append(f"  - Issue: {f.get('issue', '')}")
        lines.append(f"  - Recommendation: {f.get('recommendation', '')}")
        lines.append("")

    # Compliance flags
    comps = data.get("compliance_flags", [])
    lines.append(_section("Compliance Flags", 2))
    lines.append(f"**Count:** {len(comps)}\n")
    for c in comps:
        lines.append(f"- **{c.get('location', '—')}**")
        lines.append(f"  - Issue: {c.get('issue', '')}")
        lines.append(f"  - Reference: {c.get('requirement_reference', '—')}")
        lines.append(f"  - Recommendation: {c.get('recommendation', '')}")
        lines.append("")

    # Risk gaps
    gaps = data.get("risk_gaps", [])
    lines.append(_section("Risk Gaps", 2))
    lines.append(f"**Count:** {len(gaps)}\n")
    for g in gaps:
        lines.append(f"- **{g.get('location', '—')}**")
        lines.append(f"  - Issue: {g.get('issue', '')}")
        lines.append(f"  - Risk: {g.get('risk', '')}")
        lines.append(f"  - Recommendation: {g.get('recommendation', '')}")
        lines.append("")

    # Risk scores
    scores = data.get("risk_scores", [])
    if scores:
        lines.append(_section("Risk Scores", 2))
        for r in scores:
            lines.append(f"- {r.get('location', '—')}: {r.get('band', '—')}")
        lines.append("")

    # Errors & warnings
    errs = data.get("errors", [])
    warns = data.get("warnings", [])
    if errs or warns:
        lines.append(_section("Errors & Warnings", 2))
        for e in errs:
            if isinstance(e, dict):
                lines.append(f"- **Error [{e.get('severity', '')}]:** {e.get('message', e)}")
            else:
                lines.append(f"- **Error:** {e}")
        for w in warns:
            lines.append(f"- **Warning:** {w}")
        lines.append("")

    report = "\n".join(lines)
    out_path.write_text(report, encoding="utf-8")
    return str(out_path)


def main():
    default = Path(__file__).resolve().parent.parent / "test_result_packaging_principle.json"
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    if not src.exists():
        print(f"File not found: {src}")
        sys.exit(1)
    out = export(src)
    print(f"Report saved to {out}")


if __name__ == "__main__":
    main()
