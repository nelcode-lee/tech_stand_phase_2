"""
Deterministic checks aligned to Cranswick Group Representation & Notation Standard (Appendix A).

These complement the Cleansing LLM pass: high-confidence patterns only. False positives are
possible; HITL remains the authority (see standard §2, §13).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

_STANDARD_PATH = Path(__file__).resolve().parent / "representation_standard.json"


def representation_standard_ref() -> str:
    try:
        data = json.loads(_STANDARD_PATH.read_text(encoding="utf-8"))
        v = data.get("version", "v1.0")
        return f"Cranswick Group Representation & Notation Standard {v} Appendix A (normative classes A1–A19)"
    except Exception:
        return "Cranswick Group Representation & Notation Standard v1.0 Appendix A"


@dataclass(frozen=True)
class RepresentationLintHit:
    representation_class_id: str
    class_name: str
    location: str
    current_text: str
    issue: str
    recommendation: str


def _line_at(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def _line_start(text: str, pos: int) -> int:
    return text.rfind("\n", 0, pos) + 1


def _same_line_before(text: str, match_start: int) -> str:
    ls = _line_start(text, match_start)
    return text[ls:match_start]


def _has_inequality_words(before: str) -> bool:
    lower = before.lower()
    return any(
        p in lower
        for p in (
            "less than",
            "greater than",
            "more than",
            "fewer than",
            "no more than",
            "no less than",
            "equal to",
            "at least",
            "at most",
            "between ",
        )
    )


def _both_calendar_years(a: int, b: int) -> bool:
    return 1900 <= a <= 2100 and 1900 <= b <= 2100 and a != b


def lint_representation_notation(text: str) -> list[RepresentationLintHit]:
    """Return automated Appendix A–aligned hits. ``text`` should be cleansed document body."""
    if not text or not text.strip():
        return []

    hits: list[RepresentationLintHit] = []
    seen: set[tuple[str, str]] = set()  # (class_id, normalized snippet)

    def add_hit(
        class_id: str,
        class_name: str,
        pos: int,
        snippet: str,
        issue: str,
        recommendation: str,
    ) -> None:
        sn = " ".join(snippet.split())
        key = (class_id, sn[:200])
        if key in seen:
            return
        seen.add(key)
        line = _line_at(text, pos)
        hits.append(
            RepresentationLintHit(
                representation_class_id=class_id,
                class_name=class_name,
                location=f"Line {line}",
                current_text=snippet.strip()[:500],
                issue=issue,
                recommendation=recommendation,
            )
        )

    # --- A5 Time duration: min / hr abbreviations ---
    for m in re.finditer(r"(?i)\b(\d+)\s*(min|mins|hr|hrs)\b", text):
        add_hit(
            "A5",
            "Time Duration",
            m.start(),
            m.group(0),
            "Prohibited time abbreviation for operator-facing text (Group Standard §7, Class A5): "
            f"use full words (e.g. {m.group(1)} minutes or hours) instead of '{m.group(2)}'.",
            "Replace with an explicit duration in words, e.g. '15 minutes', '2 hours'. "
            "Seek HITL if the change could affect a control limit or audit interpretation.",
        )

    # --- A3 Ranges: hyphen / en-dash between small integers (not both calendar years) ---
    range_re = re.compile(r"\b(\d{1,4})\s*([-–])\s*(\d{1,4})\b")
    for m in range_re.finditer(text):
        a, b = int(m.group(1)), int(m.group(3))
        if _both_calendar_years(a, b):
            continue
        if a > 999 or b > 999:
            continue
        ctx_before = _same_line_before(text, m.start())
        if "Clause" in ctx_before and re.search(r"\d+\s*[-–]\s*\d+\s*$", ctx_before[-20:]):
            continue
        add_hit(
            "A3",
            "Range",
            m.start(),
            m.group(0),
            "Hyphenated numeric range may contravene Class A3: express ranges in words with numerals "
            "(e.g. 'between 3 and 5') so operators are not confused with minus, IDs, or dates.",
            "Rewrite using words, e.g. 'between X and Y', without changing numeric intent. "
            "Escalate to HITL if any limit or compliance meaning could differ.",
        )

    # --- A2 Inequalities: bare symbol before number on same line ---
    ineq_re = re.compile(r"(?m)(?<![<≤≥])([<>≤≥])\s*(\d+(?:\.\d+)?)(?!\d)")
    for m in ineq_re.finditer(text):
        before = _same_line_before(text, m.start())
        if _has_inequality_words(before[-80:]):
            continue
        sym, num = m.group(1), m.group(2)
        add_hit(
            "A2",
            "Inequality",
            m.start(),
            m.group(0).strip(),
            f"Bare inequality symbol '{sym}' before {num} may breach Class A2: pair symbols with words "
            "(e.g. 'less than 5') for comprehension at point of use.",
            f"Add plain-language wording (e.g. 'less than {num}', 'greater than or equal to {num}') "
            "alongside or instead of the symbol; preserve the limit exactly.",
        )

    # --- A10 Approximation symbols ---
    approx_re = re.compile(r"(?i)(?:±\s*\d|\bapprox\.?\s*\d|~\s*\d)")
    for m in approx_re.finditer(text):
        add_hit(
            "A10",
            "Tolerance / Approximation",
            m.start(),
            m.group(0),
            "Approximation or tolerance shorthand (±, ~, approx.) may require explicit words under Class A10 "
            "so meaning survives loss of format.",
            "State the intended bound in words; escalate to HITL if any tolerance or legal meaning could change.",
        )

    # --- A17 Document navigation: relative visual references ---
    nav_re = re.compile(
        r"(?i)\b(?:see|refer\s+to)\s+(?:the\s+)?(?:diagram|figure|table|chart|photo|image|picture)\s+(?:above|below)\b"
        r"|\b(?:as|shown)\s+(?:above|below)\b"
        r"|\bsee\s+(?:above|below)\b",
    )
    for m in nav_re.finditer(text):
        add_hit(
            "A17",
            "Step References",
            m.start(),
            m.group(0),
            "Relative reference (above/below) may breach Class A17: prefer explicit step numbers or named sections.",
            "Replace with explicit step or section reference (e.g. 'Step 4', section title). "
            "Confirm with HITL for audit-facing documents.",
        )

    # --- A6 Vague time frequency (conservative: single words) ---
    for m in re.finditer(r"(?i)\b(regularly|periodically)\b", text):
        line_start = _line_start(text, m.start())
        line_end = text.find("\n", m.end())
        if line_end < 0:
            line_end = len(text)
        line_text = text[line_start:line_end]
        if re.search(r"(?i)\b(every|each|at\s+least|at\s+most|\d+)\b", line_text):
            continue
        add_hit(
            "A6",
            "Time Frequency",
            m.start(),
            m.group(0),
            "Vague frequency term may breach Class A6: use explicit timing (e.g. 'every 15 minutes') instead of "
            "'regularly' or 'periodically'.",
            "Specify an explicit frequency or interval. If the true interval is unknown, Route to Specifier / HITL.",
        )

    return hits


def hits_to_cleanser_payloads(hits: list[RepresentationLintHit]) -> list[dict]:
    """Serialisable dicts for CleanserFlag construction."""
    ref = representation_standard_ref()
    out = []
    for h in hits:
        out.append(
            {
                "location": h.location,
                "current_text": h.current_text,
                "issue": h.issue,
                "recommendation": h.recommendation,
                "issue_category": "tacit_assumption",
                "representation_class_id": h.representation_class_id,
                "representation_standard_ref": ref,
            }
        )
    return out
