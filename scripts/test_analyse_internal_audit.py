"""
Run full-agent analysis on GEN-OP-17 Internal Auditing Procedure and export a Markdown report.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

import requests

BASE     = "http://127.0.0.1:8002"
DOC_PATH = ROOT / "sample_docs" / "GEN-OP-17 Internal Auditing Procedure~Issue#12~12-06-2025.docx"
JSON_OUT = ROOT / "test_result_internal_audit.json"
REPORT   = ROOT / "test_result_internal_audit.md"

# ── 1. Ingest ────────────────────────────────────────────────────────────────
print(f"Ingesting: {DOC_PATH.name}")
with open(DOC_PATH, "rb") as fh:
    r = requests.post(
        f"{BASE}/ingest/file",
        files={"file": (DOC_PATH.name, fh,
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        data={
            "document_id": "GEN-OP-17",
            "doc_layer":   "sop",
            "sites":       "Barnsley,Hull,Norfolk,Scunthorpe",
            "policy_ref":  "Food Safety Policy",
            "title":       "Internal Auditing Procedure",
        },
        timeout=120,
    )
r.raise_for_status()
print(f"  Ingest OK - {r.json()}")

# ── 2. Full agent pipeline ───────────────────────────────────────────────────
print("\nRunning full agent pipeline (this may take ~60s)...")
body = {
    "tracking_id":  "internal-audit-001",
    "request_type": "review_request",
    "doc_layer":    "sop",
    "sites":        ["Barnsley", "Hull", "Norfolk", "Scunthorpe"],
    "policy_ref":   "Food Safety Policy",
    "agents": [
        "cleansing", "terminology", "conflict", "risk",
        "specifying", "sequencing", "formatting", "validation",
    ],
}
r = requests.post(f"{BASE}/analyse", json=body, timeout=360)
r.raise_for_status()
result = r.json()

JSON_OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"  JSON saved -> {JSON_OUT.name}")

# ── 3. Build Markdown report ─────────────────────────────────────────────────
def badge(text, style):
    icons = {"critical":"[CRITICAL]","high":"[HIGH]","medium":"[MEDIUM]",
             "low":"[LOW]","info":"[INFO]","omission":"[OMISSION]","ordering":"[ORDER]"}
    return f"{icons.get(str(style).lower(),'[?]')} **{text}**"

def fmea_bar(band):
    bars = {"critical":"||||||||||||||  CRITICAL","high":"|||||||||     HIGH",
            "medium":"||||||        MEDIUM","low":"|||           LOW"}
    return bars.get((band or "low").lower(), "--")

lines = []
lines.append(f"# Analysis Report: Internal Auditing Procedure (GEN-OP-17)\n")
lines.append(f"**Tracking ID:** `{result.get('tracking_id','--')}`  ")
lines.append(f"**Overall Risk:** `{(result.get('overall_risk') or 'unknown').upper()}`  ")
lines.append(f"**Draft Ready:** {'Yes' if result.get('draft_ready') else 'No'}  ")
lines.append(f"**Agents Run:** {', '.join(result.get('agents_run', []))}\n")

# Risk Gaps
gaps = sorted(result.get("risk_gaps",[]), key=lambda g: g.get("fmea_score") or 0, reverse=True)
lines.append(f"---\n## Risk Gaps ({len(gaps)})\n")
if not gaps:
    lines.append("_None identified._\n")
for i, g in enumerate(gaps, 1):
    band  = (g.get("fmea_band") or "low").lower()
    score = g.get("fmea_score")
    lines.append(f"### Gap {i} - {badge(band.upper(), band)} - {g.get('location','')}")
    if g.get("issue"):
        lines.append(f"> **Issue:** {g['issue']}\n")
    if g.get("risk"):
        lines.append(f"> **Risk:** {g['risk']}\n")
    if score is not None:
        lines.append(f"**FMEA:** `{fmea_bar(band)}` (score {score})  ")
        lines.append(f"Severity={g.get('severity')} x Scope={g.get('scope')} x Detectability={g.get('detectability')}  ")
    if g.get("recommendation"):
        lines.append(f"**Recommendation:** {g['recommendation']}  ")
    lines.append("")

# Structure Flags
sf = result.get("structure_flags",[])
lines.append(f"---\n## Structure Flags ({len(sf)})\n")
if not sf:
    lines.append("_No structure issues._\n")
for f in sf:
    sev = (f.get("severity") or "info").lower()
    lines.append(f"### {badge(f.get('flag_type',''), sev)} - `{f.get('section','')}`")
    lines.append(f"> {f.get('detail','')}\n")
    if f.get("recommendation"):
        lines.append(f"**Recommendation:** {f['recommendation']}\n")

# Content Integrity
cif = result.get("content_integrity_flags",[])
lines.append(f"---\n## Content Integrity Flags ({len(cif)})\n")
if not cif:
    lines.append("_None._\n")
else:
    groups = {}
    for f in cif:
        groups.setdefault(f.get("flag_type","other"),[]).append(f)
    for ftype, items in sorted(groups.items()):
        lines.append(f"### {ftype.replace('_',' ').title()} ({len(items)})\n")
        for item in items[:15]:
            lines.append(f"- **{item.get('location','?')}** - {item.get('detail','')}")
            if item.get("excerpt"):
                lines.append(f"  > _{item['excerpt']}_")
        if len(items) > 15:
            lines.append(f"  ...and {len(items)-15} more")
        lines.append("")

# Specifying Flags
specf = result.get("specifying_flags",[])
lines.append(f"---\n## Specifying Flags ({len(specf)})\n")
if not specf:
    lines.append("_None._\n")
for f in specf:
    detail = f.get("detail") or ""
    rec    = f.get("recommendation") or ""
    loc    = f.get("location") or ""
    lines.append(f"- **{f.get('flag_type','')}** @ `{loc}`: {detail}")
    if rec:
        lines.append(f"  _Rec: {rec}_")
if specf: lines.append("")

# Sequencing
seqf = result.get("sequencing_flags",[])
lines.append(f"---\n## Sequencing Flags ({len(seqf)})\n")
if not seqf:
    lines.append("_None._\n")
for f in seqf:
    lines.append(f"- **{f.get('flag_type','')}** @ `{f.get('location','')}`: {f.get('detail','')}")
if seqf: lines.append("")

# Formatting
fmtf = result.get("formatting_flags",[])
lines.append(f"---\n## Formatting Flags ({len(fmtf)})\n")
if not fmtf:
    lines.append("_None._\n")
for f in fmtf[:25]:
    lines.append(f"- **{f.get('flag_type','')}** @ `{f.get('location','')}`: {f.get('detail','')}")
if len(fmtf) > 25:
    lines.append(f"  ...and {len(fmtf)-25} more")
if fmtf: lines.append("")

# Terminology
termf = result.get("terminology_flags",[])
lines.append(f"---\n## Terminology Flags ({len(termf)})\n")
if not termf:
    lines.append("_None._\n")
for f in termf[:25]:
    lines.append(f"- **{f.get('flag_type','')}** @ `{f.get('location','')}`: {f.get('detail','')}")
if len(termf) > 25:
    lines.append(f"  ...and {len(termf)-25} more")
if termf: lines.append("")

# Conflicts
conf = result.get("conflicts",[])
lines.append(f"---\n## Conflicts ({len(conf)})\n")
if not conf:
    lines.append("_None._\n")
for c in conf:
    lines.append(f"- **{c.get('conflict_type','')}**: {c.get('description','')}")
    if c.get("recommendation"):
        lines.append(f"  _Rec: {c['recommendation']}_")
if conf: lines.append("")

# Compliance
compf = result.get("compliance_flags",[])
lines.append(f"---\n## Compliance Flags ({len(compf)})\n")
if not compf:
    lines.append("_None._\n")
for f in compf:
    lines.append(f"- **{f.get('flag_type','')}**: {f.get('detail','')}")
if compf: lines.append("")

# Summary
total = (len(gaps)+len(sf)+len(cif)+len(specf)+len(seqf)+
         len(fmtf)+len(termf)+len(conf)+len(compf))
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

REPORT.write_text("\n".join(lines), encoding="utf-8")
print(f"\n  Report -> {REPORT.name}")
print(f"  Overall risk  : {(result.get('overall_risk') or 'unknown').upper()}")
print(f"  Total findings: {total}")
print(f"    Risk gaps        : {len(gaps)}")
print(f"    Structure        : {len(sf)}")
print(f"    Content integrity: {len(cif)}")
print(f"    Specifying       : {len(specf)}")
print(f"    Sequencing       : {len(seqf)}")
print(f"    Formatting       : {len(fmtf)}")
print(f"    Terminology      : {len(termf)}")
print(f"    Conflicts        : {len(conf)}")
print(f"    Compliance       : {len(compf)}")
