"""
How much document and policy text is sent to LLM agents.

Previously, cleansed SOP text was hard-capped at ~12k characters (~3–4 pages), so anything
later in the document was invisible and agents could raise false findings. Limits are now
configurable and much higher by default.

Environment variables (optional):
  AGENT_DOCUMENT_MAX_CHARS
      Max characters of cleansed / draft procedure text per agent call.
      Default: 120000 (~30k tokens ballpark). Set to 0 for no limit (use only if your model
      context and budget allow).

  AGENT_POLICY_APPENDIX_MAX_CHARS
      Max characters for combined "PARENT POLICY (context)" blocks appended after the doc.
      Default: 48000.

  AGENT_POLICY_CONTEXT_PER_DOC_MAX_CHARS
      Max characters per policy document inside _policy_context_block (base agent).
      Default: 16000.
"""
from __future__ import annotations

import os


def _parse_limit(key: str, default: int) -> int:
    """Parse env int; 0 or 'unlimited' / 'none' / 'full' means no cap (use huge practical max)."""
    raw = (os.environ.get(key) or "").strip()
    if not raw:
        return default
    low = raw.lower()
    if low in ("0", "unlimited", "none", "full"):
        return 0
    try:
        return int(raw)
    except ValueError:
        return default


# Practical "no limit" for slice helpers (avoid passing multi-MB by mistake in one call)
_PRACTICAL_MAX = 2_000_000


def max_agent_document_chars() -> int:
    n = _parse_limit("AGENT_DOCUMENT_MAX_CHARS", 120_000)
    return _PRACTICAL_MAX if n <= 0 else n


def max_policy_appendix_chars() -> int:
    n = _parse_limit("AGENT_POLICY_APPENDIX_MAX_CHARS", 48_000)
    return _PRACTICAL_MAX if n <= 0 else n


def max_policy_context_per_doc_chars() -> int:
    n = _parse_limit("AGENT_POLICY_CONTEXT_PER_DOC_MAX_CHARS", 16_000)
    return _PRACTICAL_MAX if n <= 0 else n


def slice_document_for_agent(text: str | None) -> str:
    """Truncate procedure / document body for agent prompts."""
    t = (text or "").strip()
    if not t:
        return ""
    lim = max_agent_document_chars()
    return t if len(t) <= lim else t[:lim]


def slice_policy_appendix_for_agent(text: str | None) -> str:
    """Truncate combined parent-policy appendix text (after building policy_block)."""
    t = (text or "").strip()
    if not t:
        return ""
    lim = max_policy_appendix_chars()
    return t if len(t) <= lim else t[:lim]
