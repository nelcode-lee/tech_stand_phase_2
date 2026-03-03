"""Domain context loading and glossary utilities for pipeline agents."""
import json
from pathlib import Path

_DOMAIN_CONTEXT_PATH = Path(__file__).resolve().parent / "domain_context.json"


def _domain_context_path() -> Path:
    return _DOMAIN_CONTEXT_PATH


def load_domain_context() -> dict:
    """Load domain_context.json. Returns empty dict on error."""
    try:
        return json.loads(_DOMAIN_CONTEXT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def get_glossary_block(domain_ctx: dict | None = None) -> str:
    """
    Build glossary text for injection into agent prompts.
    Terms are flagged when used without definition in documents.
    """
    ctx = domain_ctx if domain_ctx is not None else load_domain_context()
    terms = ctx.get("glossary", {}).get("terms", [])
    if not terms:
        return ""
    lines = [
        "STANDARD GLOSSARY — flag when used without definition in the document:",
        "These terms are frequently used; documents must define or spell them out on first use.",
    ]
    for t in terms:
        if isinstance(t, dict) and t.get("definition"):
            key = t.get("term") or t.get("abbreviation") or ""
            if key:
                lines.append(f"  - {key}: {t['definition']}")
    return "\n".join(lines) if lines else ""


def add_glossary_term(abbreviation: str, definition: str) -> bool:
    """
    Add a term to the glossary in domain_context.json.
    Returns True if added, False if term already exists (no duplicate).
    """
    if not abbreviation or not definition:
        return False
    ctx = load_domain_context()
    glossary = ctx.setdefault("glossary", {})
    terms = glossary.setdefault("terms", [])
    abbrev_upper = abbreviation.strip().upper()
    for t in terms:
        if isinstance(t, dict) and (t.get("abbreviation") or "").strip().upper() == abbrev_upper:
            return False  # already exists
    terms.append({"abbreviation": abbreviation.strip(), "definition": definition.strip()})
    try:
        _DOMAIN_CONTEXT_PATH.write_text(json.dumps(ctx, indent=2, ensure_ascii=False), encoding="utf-8")
        return True
    except Exception:
        return False
