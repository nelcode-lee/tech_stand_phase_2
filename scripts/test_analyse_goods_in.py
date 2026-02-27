"""
Run full-agent analysis on GEN-OP-01 Goods In Procedure and export a Markdown report.
"""
import json
import sys
from pathlib import Path

# Allow imports from project root
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

import requests

BASE = "http://127.0.0.1:8002"
DOC_PATH = ROOT / "sample_docs" / "GEN-OP-01 Goods In Procedure~Issue#22~28-01-2022.doc"
REPORT_OUT = ROOT / "test_result_goods_in.md"
JSON_OUT    = ROOT / "test_result_goods_in.json"

# ── 1. Ingest the file ──────────────────────────────────────────────────────
print(f"Ingesting: {DOC_PATH.name}")
with open(DOC_PATH, "rb") as fh:
    r = requests.post(
        f"{BASE}/ingest/file",
        files={"file": (DOC_PATH.name, fh, "application/msword")},
        data={
            "document_id": "GEN-OP-01",
            "doc_layer":   "sop",
            "sites":       "Barnsley,Hull,Norfolk",
            "policy_ref":  "Food Safety Policy",
            "title":       "Goods In Procedure",
        },
        timeout=120,
    )
r.raise_for_status()
print(f"  Ingest OK — {r.json()}")

# ── 2. Run the full agent pipeline ──────────────────────────────────────────
print("\nRunning full agent pipeline...")
body = {
    "tracking_id":   "goods-in-001",
    "request_type":  "review_request",
    "doc_layer":     "sop",
    "sites":         ["Barnsley", "Hull", "Norfolk"],
    "policy_ref":    "Food Safety Policy",
    "agents": [
        "cleansing",
        "terminology",
        "conflict",
        "risk",
        "specifying",
        "sequencing",
        "formatting",
        "validation",
    ],
}
r = requests.post(f"{BASE}/analyse", json=body, timeout=300)
r.raise_for_status()
result = r.json()

# Save raw JSON
JSON_OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"  Raw JSON saved -> {JSON_OUT.name}")

# ── 3. Export Markdown report ────────────────────────────────────────────────
def badge(text: str, style: str) -> str:
    STYLES = {
        "critical": "🔴",
        "high":     "🟠",
        "medium":   "🟡",
        "low":      "🟢",
        "info":     "ℹ️ ",
    }
    return f"{STYLES.get(style, '▪')} **{text}**"


def fmea_bar(band: str) -> str:
    BARS = {
        "critical": "████████████  CRITICAL",
        "high":     "█████████     HIGH",
        "medium":   "██████        MEDIUM",
        "low":      "███           LOW",
    }
    return BARS.get(band or "low", "—")


lines = []
lines.append(f"# Analysis Report — Goods In Procedure (GEN-OP-01)\n")
lines.append(f"**Tracking ID:** `{result.get('tracking_id', '—')}`  ")
lines.append(f"**Overall Risk:** `{result.get('overall_risk', '—').upper()}`  ")
lines.append(f"**Draft Ready:** {'Yes' if result.get('draft_ready') else 'No'}  ")
lines.append(f"**Agents Run:** {', '.join(result.get('agents_run', []))}\n")

# ── Risk Gaps ────────────────────────────────────────────────────────────────
gaps = result.get("risk_gaps", [])
lines.append(f"---\n## Risk Gaps ({len(gaps)})\n")
if not gaps:
    lines.append("_None identified._\n")
else:
    sorted_gaps = sorted(gaps, key=lambda g: g.get("fmea_score") or 0, reverse=True)
    for g in sorted_gaps:
        sev   = (g.get("severity_level") or g.get("severity") or "").lower()
        band  = (g.get("fmea_band") or "").lower()
        score = g.get("fmea_score")
        lines.append(f"### {badge(g.get('gap_type','Gap'), sev)} — {g.get('gap_type','')}")
        lines.append(f"> {g.get('description','')}\n")
        if score is not None:
            lines.append(f"**FMEA:** `{fmea_bar(band)}` (score {score})  ")
            lines.append(f"S={g.get('severity')} · Sc={g.get('scope')} · D={g.get('detectability')}  ")
        if g.get("location"):
            lines.append(f"**Location:** {g['location']}  ")
        if g.get("recommendation"):
            lines.append(f"**Recommendation:** {g['recommendation']}  ")
        lines.append("")

# ── Structure Flags ──────────────────────────────────────────────────────────
sf = result.get("structure_flags", [])
lines.append(f"---\n## Structure Flags ({len(sf)})\n")
if not sf:
    lines.append("_No structure issues identified._\n")
else:
    for f in sf:
        sev = (f.get("severity") or "info").lower()
        lines.append(f"### {badge(f.get('flag_type',''), sev)} — `{f.get('section','')}`")
        lines.append(f"> {f.get('detail','')}\n")
        if f.get("recommendation"):
            lines.append(f"**Recommendation:** {f['recommendation']}\n")

# ── Content Integrity Flags ──────────────────────────────────────────────────
cif = result.get("content_integrity_flags", [])
lines.append(f"---\n## Content Integrity Flags ({len(cif)})\n")
if not cif:
    lines.append("_No content integrity issues._\n")
else:
    # Group by flag_type
    groups: dict = {}
    for f in cif:
        groups.setdefault(f.get("flag_type", "other"), []).append(f)
    for ftype, items in sorted(groups.items()):
        lines.append(f"### {ftype.replace('_', ' ').title()} ({len(items)})\n")
        for item in items[:15]:  # cap per type
            lines.append(f"- **{item.get('location','?')}** — {item.get('detail','')}")
            if item.get("excerpt"):
                lines.append(f"  > _{item['excerpt']}_")
        if len(items) > 15:
            lines.append(f"  … and {len(items)-15} more")
        lines.append("")

# ── Specifying Flags ─────────────────────────────────────────────────────────
specf = result.get("specifying_flags", [])
lines.append(f"---\n## Specifying Flags ({len(specf)})\n")
if not specf:
    lines.append("_None._\n")
else:
    for f in specf:
        lines.append(f"- **{f.get('flag_type','')}** @ `{f.get('location','')}`: {f.get('detail','')}")
        if f.get("recommendation"):
            lines.append(f"  → _{f['recommendation']}_")
    lines.append("")

# ── Sequencing Flags ─────────────────────────────────────────────────────────
seqf = result.get("sequencing_flags", [])
lines.append(f"---\n## Sequencing Flags ({len(seqf)})\n")
if not seqf:
    lines.append("_None._\n")
else:
    for f in seqf:
        lines.append(f"- **{f.get('flag_type','')}** @ `{f.get('location','')}`: {f.get('detail','')}")
    lines.append("")

# ── Formatting Flags ──────────────────────────────────────────────────────────
fmtf = result.get("formatting_flags", [])
lines.append(f"---\n## Formatting Flags ({len(fmtf)})\n")
if not fmtf:
    lines.append("_None._\n")
else:
    for f in fmtf[:20]:
        lines.append(f"- **{f.get('flag_type','')}** @ `{f.get('location','')}`: {f.get('detail','')}")
    if len(fmtf) > 20:
        lines.append(f"  … and {len(fmtf)-20} more")
    lines.append("")

# ── Terminology Flags ─────────────────────────────────────────────────────────
termf = result.get("terminology_flags", [])
lines.append(f"---\n## Terminology Flags ({len(termf)})\n")
if not termf:
    lines.append("_None._\n")
else:
    for f in termf[:20]:
        lines.append(f"- **{f.get('flag_type','')}** @ `{f.get('location','')}`: {f.get('detail','')}")
    if len(termf) > 20:
        lines.append(f"  … and {len(termf)-20} more")
    lines.append("")

# ── Conflicts ────────────────────────────────────────────────────────────────
conf = result.get("conflicts", [])
lines.append(f"---\n## Conflicts ({len(conf)})\n")
if not conf:
    lines.append("_None._\n")
else:
    for c in conf:
        lines.append(f"- **{c.get('conflict_type','')}**: {c.get('description','')}")
        if c.get("recommendation"):
            lines.append(f"  → _{c['recommendation']}_")
    lines.append("")

# ── Compliance Flags ─────────────────────────────────────────────────────────
compf = result.get("compliance_flags", [])
lines.append(f"---\n## Compliance Flags ({len(compf)})\n")
if not compf:
    lines.append("_None._\n")
else:
    for f in compf:
        lines.append(f"- **{f.get('flag_type','')}**: {f.get('detail','')}")
    lines.append("")

# ── Summary ──────────────────────────────────────────────────────────────────
total = (len(gaps) + len(sf) + len(cif) + len(specf) +
         len(seqf) + len(fmtf) + len(termf) + len(conf) + len(compf))
lines.append(f"---\n## Summary\n")
lines.append(f"| Category | Count |")
lines.append(f"|---|---|")
lines.append(f"| Risk Gaps | {len(gaps)} |")
lines.append(f"| Structure Flags | {len(sf)} |")
lines.append(f"| Content Integrity | {len(cif)} |")
lines.append(f"| Specifying | {len(specf)} |")
lines.append(f"| Sequencing | {len(seqf)} |")
lines.append(f"| Formatting | {len(fmtf)} |")
lines.append(f"| Terminology | {len(termf)} |")
lines.append(f"| Conflicts | {len(conf)} |")
lines.append(f"| Compliance | {len(compf)} |")
lines.append(f"| **TOTAL** | **{total}** |")

REPORT_OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"\n  Markdown report saved -> {REPORT_OUT.name}")
overall = result.get('overall_risk') or 'unknown'
print(f"\n  Overall risk  : {overall.upper()}")
print(f"  Total findings: {total}")
print(f"    Risk gaps       : {len(gaps)}")
print(f"    Structure       : {len(sf)}")
print(f"    Content integrity: {len(cif)}")
print(f"    Specifying      : {len(specf)}")
print(f"    Sequencing      : {len(seqf)}")
print(f"    Formatting      : {len(fmtf)}")
print(f"    Terminology     : {len(termf)}")
print(f"    Conflicts       : {len(conf)}")
print(f"    Compliance      : {len(compf)}")
