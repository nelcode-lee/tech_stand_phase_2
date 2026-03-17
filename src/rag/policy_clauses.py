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
    "been", "each", "any", "all", "not", "out", "its", "may",
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
    current_lines: list[str] = []

    def flush_current() -> None:
        nonlocal current_clause_id, current_lines
        if not current_clause_id:
            return
        if not _is_citable_clause_id(current_clause_id, standard_name):
            current_clause_id = None
            current_lines = []
            return
        text = _normalise_requirement_text(current_lines)
        if not text:
            current_clause_id = None
            current_lines = []
            return
        clauses.append(
            {
                "document_id": document_id,
                "standard_name": standard_name,
                "version": version,
                "clause_id": current_clause_id,
                "heading": None,
                "requirement_text": text,
                "keywords": _keywords_for_text(text),
                "canonical_citation": _canonical_citation(standard_name, current_clause_id),
                "source_title": title or document_id,
                "active": True,
            }
        )
        current_clause_id = None
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
                if rest and rest.lower() not in {"requirements", "requirement"}:
                    current_lines.append(rest)
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
        block = f"[{row.get('canonical_citation')}{heading}]\n{(row.get('requirement_text') or '').strip()}"
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
