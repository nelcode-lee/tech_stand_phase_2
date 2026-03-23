"""Helpers for extracting structured policy clauses from stable standards docs like BRCGS."""
from __future__ import annotations

import re

_CLAUSE_LINE_RE = re.compile(r"^\s*(\d+(?:\.\d+){1,4}[a-zA-Z]?)\s*(.*)$")
_VERSION_RE = re.compile(r"\bV(?:ERSION)?\s*([0-9]{1,2})\b", re.I)
_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "shall", "must", "into",
    "where", "when", "then", "than", "they", "them", "their", "there", "have",
    "has", "had", "are", "was", "were", "will", "would", "should", "could",
    "into", "onto", "under", "over", "such", "only", "used", "using", "being",
    "been", "each", "any", "all", "not", "out", "its", "may", "policy",
    "procedure", "document", "documents", "requirement", "requirements", "include",
    "includes", "including", "system", "systems", "product", "products", "food",
    "safety", "site", "sites", "control", "controls",
}


def looks_like_structured_policy(title: str | None = None, source_path: str | None = None, content: str | None = None) -> bool:
    """Return True when the document looks like a stable clause/requirement policy such as BRCGS or Cranswick Manufacturing Standard."""
    haystacks = [title or "", source_path or "", (content or "")[:2000]]
    joined = "\n".join(haystacks).lower()
    if "brcgs" in joined:
        return True
    if "cranswick manufacturing standard" in joined:
        return True
    clause_hits = len(re.findall(r"^\s*\d+(?:\.\d+){1,4}[a-zA-Z]?\s*$", content or "", re.M))
    has_headers = "clause" in joined and "requirement" in joined
    return bool(has_headers and clause_hits >= 5)


def derive_standard_name(title: str | None = None, source_path: str | None = None) -> str:
    """Best-effort standard name from title/path."""
    joined = f"{title or ''} {source_path or ''}".strip()
    if re.search(r"\bbrcgs\b", joined, re.I):
        return "BRCGS Food Safety"
    if re.search(r"cranswick manufacturing standard", joined, re.I):
        return "Cranswick Manufacturing Standard"
    return (title or source_path or "Policy Standard").strip()


def derive_version(title: str | None = None, source_path: str | None = None, content: str | None = None) -> str | None:
    """Extract a simple version label such as v9 when present."""
    joined = f"{title or ''}\n{source_path or ''}\n{(content or '')[:1000]}"
    m = _VERSION_RE.search(joined)
    return f"v{m.group(1)}" if m else None


def parse_policy_clauses(
    document_id: str,
    title: str | None,
    content: str,
    *,
    source_path: str | None = None,
) -> list[dict]:
    """
    Parse stable clause/requirement tables into structured records.

    Expected input resembles:
      4.3.2
      There shall be a map of the site...
      • production risk zones...
      4.3.3
      Contractors and visitors...
    """
    if not document_id or not content or not looks_like_structured_policy(title, source_path, content):
        return []

    standard_name = derive_standard_name(title, source_path)
    version = derive_version(title, source_path, content)
    lines = [ln.strip() for ln in re.sub(r"\r\n?", "\n", content).split("\n")]
    clauses: list[dict] = []
    current_clause_id: str | None = None
    current_heading: str | None = None
    current_lines: list[str] = []

    def flush_current() -> None:
        nonlocal current_clause_id, current_heading, current_lines
        if not current_clause_id:
            return
        if not _is_citable_clause_id(current_clause_id, standard_name):
            current_clause_id = None
            current_heading = None
            current_lines = []
            return
        heading, body_lines = _extract_heading(current_heading, current_lines)
        text = _normalise_requirement_text(body_lines)
        if not text:
            current_clause_id = None
            current_heading = None
            current_lines = []
            return
        trimmed = trim_standard_pdf_bleed(text, standard_name).strip()
        if trimmed:
            text = trimmed
        clauses.append(
            {
                "document_id": document_id,
                "standard_name": standard_name,
                "version": version,
                "clause_id": current_clause_id,
                "heading": heading,
                "requirement_text": text,
                "keywords": _keywords_for_text(" ".join(part for part in [heading or "", text] if part)),
                "canonical_citation": _canonical_citation(standard_name, current_clause_id),
                "source_title": title or document_id,
                "active": True,
            }
        )
        current_clause_id = None
        current_heading = None
        current_lines = []

    for line in lines:
        if not line:
            continue
        lower = line.lower()
        if lower in {"clause", "requirements", "requirement"}:
            continue

        m = _CLAUSE_LINE_RE.match(line)
        if m:
            clause_id = m.group(1)
            rest = (m.group(2) or "").strip(" :-\t")
            if _looks_like_clause_id(clause_id):
                flush_current()
                current_clause_id = clause_id
                if rest and _looks_like_heading_line(rest):
                    current_heading = rest.rstrip(":")
                elif rest and rest.lower() not in {"requirements", "requirement"}:
                    current_lines.append(rest)
                continue

        if current_clause_id is None and _looks_like_heading_line(line):
            current_heading = line.rstrip(":")
            continue

        if current_clause_id:
            current_lines.append(line)

    flush_current()
    return clauses


def build_clause_context_block(clauses: list[dict], *, max_chars: int = 12000) -> str:
    """Render clause records into a compact structured text block for agent prompts."""
    if not clauses:
        return ""
    parts: list[str] = []
    total = 0
    for row in clauses:
        heading = f" - {row.get('heading')}" if row.get("heading") else ""
        body = trim_standard_pdf_bleed(
            (row.get("requirement_text") or "").strip(),
            str(row.get("standard_name") or ""),
        )
        block = f"[{row.get('canonical_citation')}{heading}]\n{body}"
        if total + len(block) + 2 > max_chars and parts:
            break
        parts.append(block)
        total += len(block) + 2
    return "\n\n".join(parts)


def _looks_like_clause_id(text: str) -> bool:
    return bool(re.fullmatch(r"\d+(?:\.\d+){1,4}[a-zA-Z]?", text or ""))


def _is_citable_clause_id(clause_id: str, standard_name: str) -> bool:
    """
    Return True when a clause id is specific enough to cite.

    For BRCGS and Cranswick Manufacturing Standard we only keep actionable
    subclauses such as 4.3.2 or 5.8.3, and reject broad section headers such
    as 4.3 or 5.8.
    """
    if not _looks_like_clause_id(clause_id):
        return False
    standard_key = (standard_name or "").lower()
    if "brcgs" in standard_key or "cranswick manufacturing standard" in standard_key:
        return clause_id.count(".") >= 2
    return True


def _canonical_citation(standard_name: str, clause_id: str) -> str:
    standard_key = (standard_name or "").lower()
    if "brcgs" in standard_key:
        return f"BRCGS Clause {clause_id}"
    if "cranswick manufacturing standard" in standard_key:
        return f"Cranswick Std §{clause_id}"
    return f"{standard_name} clause {clause_id}"


def _normalise_requirement_text(lines: list[str]) -> str:
    out: list[str] = []
    for raw in lines:
        line = re.sub(r"\s+", " ", (raw or "").strip())
        if not line:
            continue
        if line in {"•", "-", "*"}:
            continue
        if re.match(r"^[•*-]\s*", line):
            out.append(re.sub(r"^[•*-]\s*", "- ", line))
        else:
            out.append(line)
    return "\n".join(out).strip()


def _looks_like_heading_line(line: str) -> bool:
    text = re.sub(r"\s+", " ", (line or "").strip()).strip(":")
    if not text or len(text) > 80:
        return False
    if _looks_like_clause_id(text):
        return False
    words = re.findall(r"[A-Za-z][A-Za-z0-9&/\-]*", text)
    if not words or len(words) > 8:
        return False
    if any(len(word) > 24 for word in words):
        return False
    return text == text.upper() or text == text.title() or ":" in (line or "")


def _extract_heading(pending_heading: str | None, lines: list[str]) -> tuple[str | None, list[str]]:
    heading = re.sub(r"\s+", " ", (pending_heading or "").strip()).strip(":") or None
    body_lines = list(lines or [])
    if body_lines:
        first = re.sub(r"\s+", " ", (body_lines[0] or "").strip())
        if _looks_like_heading_line(first):
            heading = first.strip(":")
            body_lines = body_lines[1:]
    return heading, body_lines


def _keywords_for_text(text: str, *, limit: int = 12) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9\-]{3,}", text.lower())
    seen: list[str] = []
    for word in words:
        if word in _STOPWORDS:
            continue
        if word not in seen:
            seen.append(word)
        if len(seen) >= limit:
            break
    return seen


def trim_standard_pdf_bleed(text: str, standard_name: str | None = None) -> str:
    """
    Remove common PDF extraction bleed (running headers, footers, stitched TOC) that often
    follows real clause wording in BRCGS extracts. Safe when rendering stored clauses; also
    used during parse so re-ingest writes cleaner rows.
    """
    if not text or not str(text).strip():
        return text
    sk = (standard_name or "").lower()
    t = str(text)
    if "brcgs" not in sk:
        return t

    # Footer / URL — almost never part of requirement wording
    m = re.search(r"(?i)https?://[^\s]*brcgs\.com|(?<![A-Za-z])brcgs\.com", t)
    if m is not None and m.start() > 40:
        t = t[: m.start()].rstrip(" -—\t,.;")

    # Running issue banner repeated when a new PDF page is stitched in
    banner = re.compile(r"FOOD SAFETY ISSUE\s*\d+", re.I)
    matches = list(banner.finditer(t))
    if len(matches) >= 2 and matches[1].start() > matches[0].end():
        t = t[: matches[1].start()].rstrip(" -—\t,.;")

    # TOC / part index lines concatenated without spaces between headings
    for glue in (
        "Part IPart II",
        "Part IIPart III",
        "Part IIIPart IV",
        "Part IVAppendices",
    ):
        idx = t.find(glue)
        if idx != -1 and idx > 100:
            t = t[:idx].rstrip(" -—\t,.;")
            break

    # Numbered appendix / TOC tail: "1 Other BRCGS standards 140 2 Production risk"
    # Cut before a long run of "digit + title-ish + page-ish" once we're deep in the string.
    toc_run = re.search(
        r"(?:\b\d{1,2}\s+[A-Za-z][^\n]{8,60}\s+\d{3}\b\s*){2,}",
        t[400:],
    )
    if toc_run:
        t = t[: 400 + toc_run.start()].rstrip(" -—\t,.;")

    return t.strip()
