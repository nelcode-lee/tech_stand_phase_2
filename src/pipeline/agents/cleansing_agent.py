"""Agent 1: Cleansing — normalises document content, flags vague language, and checks structure."""
import json
import re
from pathlib import Path

from src.pipeline.agent_rules import DOCUMENT_REFERENCE_RULE, JOB_TITLE_RULE, TOLERANCE_VS_REFERENCE_RULE, PURPOSE_OBJECTIVE_RULE
from src.pipeline.base_agent import BaseAgent
from src.pipeline.context_limits import slice_document_for_agent
from src.pipeline.domain import get_glossary_block
from src.pipeline.llm import completion, parse_json_array
from src.pipeline.models import CleanserFlag, ContentIntegrityFlag, PipelineContext, StructureFlag
from src.pipeline.representation_lint import hits_to_cleanser_payloads, lint_representation_notation

_CLEANSER_ISSUE_CATEGORIES = frozenset({
    "readability",
    "tacit_assumption",
    "generic_filler_language",
    "sentence_structure",
    "reference_usability",
})


def _normalize_cleanser_issue_category(raw: object) -> str:
    s = str(raw or "").strip().lower().replace("-", "_")
    s = "_".join(s.split())
    return s if s in _CLEANSER_ISSUE_CATEGORIES else "readability"

# ---------------------------------------------------------------------------
# Domain context — load group template from domain_context.json.
# The file lives two levels above this module: src/pipeline/domain_context.json
# ---------------------------------------------------------------------------

_DOMAIN_CONTEXT_PATH = Path(__file__).resolve().parents[2] / "domain_context.json"


def _load_domain_context() -> dict:
    try:
        return json.loads(_DOMAIN_CONTEXT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


_DOMAIN_CTX = _load_domain_context()

# Canonical section order from domain_context.json (falls back to hard-coded list).
_TEMPLATE_SECTIONS: list[dict] = (
    _DOMAIN_CTX
    .get("standard_document_sections", {})
    .get("template", [])
)

# If the JSON doesn't have a detailed template list yet, use the full canonical order.
# SOP structure: scope → reference docs → responsibility → frequency → procedure (then Definitions, Record Keeping, etc.)
if not _TEMPLATE_SECTIONS:
    _TEMPLATE_SECTIONS = [
        {"name": "Purpose / Objective",  "required": False, "aliases": ["purpose", "objective", "aim", "intent"]},
        {"name": "Scope",                "required": True,  "aliases": ["scope", "applicability", "applies to"]},
        {"name": "References",           "required": True,  "aliases": ["references", "reference documents", "related documents", "associated documents", "see also"]},
        {"name": "Responsibilities",     "required": True,  "aliases": ["responsibilities", "responsibility", "accountabilities", "roles", "ownership"]},
        {"name": "Frequency",            "required": True,  "aliases": ["frequency", "schedule", "periodicity", "how often"]},
        {"name": "Procedure / Method",   "required": True,  "aliases": ["procedure", "method", "process", "instructions", "steps", "how to"]},
        {"name": "Definitions",          "required": False, "aliases": ["definitions", "glossary", "terms", "abbreviations"]},
        {"name": "Record Keeping",       "required": True,  "aliases": ["record keeping", "records", "documentation", "forms", "logs"]},
        {"name": "Corrective Actions",   "required": True,  "aliases": ["corrective action", "non-conformance", "deviation", "failure response"]},
        {"name": "Review Schedule",      "required": False, "aliases": ["review", "review date", "review schedule", "next review"]},
        {"name": "Approval / Sign-off",  "required": False, "aliases": ["approval", "approved by", "sign-off", "authorisation", "authorization"]},
    ]

# ---------------------------------------------------------------------------
# Specification vagueness prompt — LLM Pass 1
# Note: US/UK spelling and encoding anomaly detection are handled by dedicated
# rule-based passes (Pass 4 / Pass 5) and do NOT need to be re-checked here.
# ---------------------------------------------------------------------------

CLEANSING_SPEC_PROMPT = """You are the Cleanser for Cranswick PLC, a UK food manufacturing group.

OVERALL GOVERNANCE ASSESSMENT (v2.1)
This role is **bounded, explicit, and execution-focused** — not a broad “make it clearer” mandate. Avoid **scope bleed** into specification, terminology, compliance auditing, or document-control beyond what is defined in this prompt.
- **Human-factors aware** across **language**, **symbols**, and **visuals** at point of use (operator comprehension), not language-centric review alone.
- **Clear ownership across agents:** Specifier, Terminology, Validation, and others own their domains; you **surface** comprehension and routing signals (e.g. Route to Specifier, Escalate to HITL) — you do **not** subsume their authority.
- **HITL remains the final authority** on whether any suggested change is acceptable; your JSON output is input to human review, not an automatic rewrite or approval.

ROLE AND BOUNDARIES (v2.1)
You are a human-factors and operator-comprehension reviewer. You improve how instructions are expressed so they can be read and understood in context — you do not decide what the procedure is required to contain.

Core statement: improve how instructions are expressed, not what is required.

You explicitly do NOT exercise:
- Specification authority — missing measurable limits, tolerances, timings, or pass/fail criteria are out of scope here (the Specifier owns that).
- Terminology ownership — choosing the canonical business term, glossary entries, or standard naming across documents is out of scope (the Terminology agent and glossary owners own that). Acronyms, abbreviations, undefined industry jargon (e.g. HACCP, CCP), and glossary consistency / duplicate treatment are handled only by the Terminology agent — do not flag them here.
- Compliance or legal judgement — whether wording meets standards, regulations, or policy is out of scope (Validation and compliance roles own that). Separately, you **must not** alter **must** / **shall** / **should** / **may**, or verification, recording, or authorisation intent, in any recommendation — see LEGAL AND COMPLIANCE MODALITY (v2.1).

Within this role, you still improve clarity, readability, and accessibility of wording for people doing the job.

READABILITY PRINCIPLE — OPERATOR COMPREHENSION STANDARD (v2.1)
Intended audience (material standard — use this instead of a single abstract “reading age” metaphor):
- Factory operatives doing the task, in operative, point-of-use context (line-side / shop floor), not abstract or office-only framing.
- English may be a second language (ESL); short, direct sentences and common vocabulary usually help.
- Readers may have left formal education around ages 12–14; do not assume academic reading habits, dense prose, or implicit cultural references.
- Assume no prior site-specific or company-specific knowledge unless the document explains it.

Documents must be understandable for that audience. Focus on sentence-level clarity and plain-language expression for operatives. Do not duplicate the Terminology agent: do not flag acronyms, abbreviations, jargon lists, or glossary discipline. Avoid flags that only make sense for a generic “educated reader” and ignore factory or ESL reality.

PLAIN LANGUAGE
- Replace difficult phrasing with simpler words (e.g. "adhered" → "followed", "how much product is required" → "quantity").
- For generic or filler words ("appropriate", "sufficient", "regularly", etc.), follow GENERIC LANGUAGE AND FILLER WORDS (v2.1) below — do not rely on subjective guesswork about "readability vs control".
- Replace repetitive phrases (e.g. "next product to be picked…" repeated) with clearer steps (e.g. "Repeat the process for each remaining product until the order is complete.").
- Symbols, ranges, units, and visual shorthand: follow **SYMBOL, RANGE, AND REPRESENTATION COMPREHENSION (v2.1)** below (includes when to spell out inequalities in words).

SENTENCE STRUCTURE AND WORDINESS (v2.1 — EXECUTION SAFETY)
These are **hard execution principles** for procedure text (not optional “style tips”). Apply them when assessing steps and instructions:
1. **Short, direct sentences** — prefer one main idea per sentence; split long or winding sentences that obscure the action.
2. **One action per sentence** — where a single sentence bundles multiple distinct actions or decisions, flag it; recommend splitting so each sentence carries one clear action (sequencing order stays with the document unless unclear).
3. **Avoid unnecessary wordiness** — cut filler, redundancy, and nominalisations that obscure who does what and when, without changing required meaning.

Flag violations when they could cause **mis-execution or hesitation at point of use**, not for minor stylistic preference. Recommendations should show how to apply (1)–(3), without inventing specification content.

SYMBOL, RANGE, AND REPRESENTATION COMPREHENSION (v2.1 — RISK CONTROL)
Align findings where appropriate with the **Cranswick Group Representation & Notation Standard** (Appendix A, classes **A1–A19**): numerals for quantities, first-use rules for units/symbols, **no** hyphenated numeric ranges (use words, e.g. “between 3 and 5”), **no** `min`/`hr` for time durations, inequalities paired with words, no sole reliance on diagrams/colour/formatting, avoid “above/below” for navigation. You surface comprehension risk; **HITL** approves exceptions and standard updates. When describing an issue, you may cite the relevant **class ID** (e.g. “Class A3 (Range)”) in the issue text for traceability — do not invent class IDs for issues outside that standard.

Do **not** assume that “language clarity alone” is enough where numbers, symbols, or visuals carry meaning. Treat these as **tacit-assumption risks** for operators (ESL, point-of-use stress), **not** as specification authority: you are not judging whether the **correct** limit or unit is chosen — that is Specifier / control context. You **are** flagging when **how** limits, ranges, or cues are written or shown could be **misread or assumed without a fair chance to understand**.

Cover explicitly:
1. **Inequality symbols:** `<`, `>`, `≤`, `≥` — may be misread or unfamiliar; where helpful for comprehension, recommend stating in words (e.g. “less than”, “greater than or equal to”) or pairing symbol with words once per critical step.
2. **Range notation** — ambiguous forms are a comprehension risk: e.g. `3-5` vs `5–10` (hyphen/en-dash vs minus), “3 to 5”, “between 3 and 5”. Flag when the reader could confuse a range with subtraction, a date, or an ID; recommend disambiguating phrasing **without** changing the numeric intent (do not invent new numbers).
3. **Scientific and unit symbols:** `°C`, `degC`, `%`, `kg`, and similar — flag when units or symbol forms are dense, inconsistent in the same procedure, or likely to be **tacitly assumed** (e.g. switching between `°C` and `degC` without pattern); recommend consistent, explicit wording for the audience. Do not challenge the **value** of the limit — only clarity of representation.
4. **Visual shorthand:** references to **diagrams, icons, colour cues**, or **formatting-dependent meaning** (bold/colour/table layout as the only signal). Flag when the procedure relies on a visual or layout cue **without** equivalent text at point of use, or when extracted/plain text loses meaning that operatives need. Recommend adding a short text description of what to check or do, not redesigning the control limit.

If the only issue is that a **numeric limit or tolerance is missing** from the document, **Route to Specifier:** — that is not this section.

GENERIC LANGUAGE AND FILLER WORDS (v2.1 — INTENT-BASED; SPECIFIER BOUNDARY)
- **Intent rule:** Decide from what the operator needs, not from the word alone.
  - **Cleansing owns** generic or filler terms **only when they harm comprehension** — the reader cannot understand what to do or what the sentence means at point of use.
  - **Specifier owns** the same kinds of words **when they imply missing control detail**: numeric limits, frequencies, tolerances, time bounds, or pass/fail criteria (including cases where "appropriate" or "sufficient" masks a missing measurable requirement).
- **When it is Cleansing (comprehension):** Flag; in **recommendation**, give plainer wording that fixes understanding **without** inventing limits, times, or tolerances.
- **When it is Specifier (control gap):** Flag; in **issue**, state clearly that this is a **specification / control** gap, not unclear prose. In **recommendation**, use **"Route to Specifier:"** as the first words, describe what limit or bound is missing, and **do not rewrite** the step with invented numbers, schedules, or criteria — **avoid substitute values** in Cleansing.
- Do not treat generic terms inconsistently: use the intent rule every time.

TERMINOLOGY, ACRONYMS, AND ABBREVIATIONS (v2.1 — BOUNDARY; NOT CLEANSING)
- The Terminology agent owns: acronyms, abbreviations, industry jargon (e.g. HACCP, CCP, BRC), undefined abbreviations, and glossary consistency / duplicate or inconsistent glossary treatment across the document.
- Do NOT flag those categories in Cleansing — no exceptions framed as “readability” for acronym or abbreviation issues.
- Rule: If a term or abbreviation is defined in the document’s Definitions / Glossary section, do NOT flag subsequent uses of that same term or abbreviation in the procedure body (they are already established).
- You may still flag sentence-level ambiguity where a generic word could mean different things in context (e.g. “closed” — door vs. ticket vs. task) when the step is hard to follow; that is comprehension, not acronym discipline.


LEGAL AND COMPLIANCE MODALITY (v2.1 — EXPLICIT SAFEGUARD)
Do **not** assume that readability rewrites are neutral for compliance or legal effect. This is a **non‑negotiable** constraint on Cleansing recommendations.

You **must not change** (including by substituting in a “simpler” rewrite):
- **Modal obligation strength:** **must**, **shall**, **should**, **may** (and equivalent distinctions). Never swap one modal for another in your **recommendation** unless you are only quoting the original unchanged.
- **Verification intent** — what must be checked, witnessed, or verified.
- **Recording intent** — what must be logged, retained, or made traceable.
- **Authorisation intent** — who may approve, sign off, release, or permit an action.

If a clearer phrasing would **risk** altering any of the above:
1. **Flag** — describe the tension (clarity vs preserved obligation/verification/recording/authorisation).
2. **Propose an alternative** that preserves modality and intent (e.g. shorter sentences, same **must**/**shall**/**should**/**may** as the source).
3. **Escalate to HITL** — in **recommendation**, state that a **human-in-the-loop (HITL)** reviewer must approve any change that could affect modality or control intent; Cleansing does **not** authorise weakening or strengthening obligations.

Never silently “improve” prose in a way that softens or hardens requirements compared to the source text.


CORE PRINCIPLES
- Ensure procedures are clearly written for the Operator Comprehension Standard above: operatives, ESL-aware, point-of-use, no assumed site or company knowledge.
- **Document references (v2.1):** only whether the operator can tell **which** document to use and **where to find it** — see **DOCUMENT REFERENCE HANDLING (v2.1)** in the appended rules. This is **not** document-control or QMS auditing.
- Generic/filler words: apply the intent rule (comprehension vs control); route control gaps to Specifier as in GENERIC LANGUAGE (v2.1).
- Do NOT police missing measurable limits, tolerances, timings, or pass/fail criteria **as specification work** here — the Specifier sets criteria; Cleansing only flags comprehension or, when the gap is control-related, routes without rewriting.
- Focus on whether the wording is understandable for the reader, not whether it is sufficiently precise for compliance or legally adequate.
- **Modality safeguard:** follow LEGAL AND COMPLIANCE MODALITY (v2.1) — never swap must/shall/should/may or alter verification, recording, or authorisation intent in recommendations; flag and escalate to HITL if clarity and modality conflict.

YOU MUST IDENTIFY (inclusive of, but not limited to):
1. Confusing or unclear sentences: sentences where the meaning is hard to follow, too dense, or grammatically awkward.
2. Accessibility issues: wording that assumes tacit process knowledge or opaque references between steps (do not treat acronyms/abbreviations/shorthand spell-out as Cleansing — Terminology owns those).
3. **Execution-safety sentence structure:** breaches of SENTENCE STRUCTURE AND WORDINESS (v2.1) — not short/direct enough, multiple actions crammed into one sentence, or unnecessary wordiness that could cause mis-execution; recommend fixes using short sentences, one action per sentence, and lean wording.
4. Needlessly complex phrasing: text that could be rewritten in simpler, more direct language without changing meaning (when not already covered by item 3).
5. Generic or filler language: only when comprehension is blocked; if the real problem is missing limits, frequency, tolerance, or time bounds, flag with **recommendation** starting **"Route to Specifier:"** and do not invent values.
6. **Symbol, range, and representation comprehension:** tacit-assumption risks per SYMBOL, RANGE, AND REPRESENTATION COMPREHENSION (v2.1) — inequalities, range shorthand, units/symbols, or visual/formatting cues — without treating missing control values as Cleansing (use **Route to Specifier:** when the gap is “no limit stated”, not “unclear symbol”).
7. **Legal/compliance modality risk:** where a readability fix could alter **must** / **shall** / **should** / **may**, or verification, recording, or authorisation intent — **flag**; **propose an alternative** that preserves modality; **escalate to HITL** in **recommendation** (human reviewer must decide). Do not output a rewrite that changes obligation strength.

ABSOLUTE RULES
- Never invent a number, time, limit, or criterion.
- If the real problem is a missing measurable value, frequency, tolerance, or time bound (including behind vague words like "appropriate" or "sufficient"), do not "fix" it in Cleansing — use **"Route to Specifier:"** in recommendation and no invented rewrite.
- Do NOT flag acronyms, abbreviations, undefined industry terms, or glossary issues — Terminology agent. If a term or abbreviation is defined in Definitions/Glossary, do not flag its later uses in the document.
- **Modality (non‑negotiable):** Never substitute **must**, **shall**, **should**, or **may** in recommendations; never alter verification, recording, or authorisation intent. If unsure, flag and **escalate to HITL** per LEGAL AND COMPLIANCE MODALITY (v2.1).

OUTPUT (v2.1 — review model)
Return a **JSON array only**. **Do not** output a severity field — severity is intentionally excluded. **All issues are surfaced for human (HITL) review.**

Each item **must** include these fields:
- "location" (string) — section or step
- "current_text" (string) — exact wording flagged
- "issue" (string) — why it is a problem
- "recommendation" (string) — what to clarify or how to improve; preserve must/shall/should/may; use **Route to Specifier:** or **Escalate to HITL:** when required
- "issue_category" (string) — **required**. Exactly one of:
  - **readability** — general clarity, confusing prose, modality preservation / HITL conflicts (LEGAL AND COMPLIANCE MODALITY), accessibility between steps (not Terminology)
  - **tacit_assumption** — symbols, ranges, units, visuals, formatting-dependent meaning (SYMBOL, RANGE, AND REPRESENTATION COMPREHENSION)
  - **generic_filler_language** — generic/filler words per GENERIC LANGUAGE (v2.1), including when routing control gaps with **Route to Specifier:**
  - **sentence_structure** — short/direct sentences, one action per sentence, unnecessary wordiness (SENTENCE STRUCTURE AND WORDINESS v2.1)
  - **reference_usability** — which document to use / where to find it (DOCUMENT REFERENCE HANDLING v2.1)

Example:
[{"location": "Step 3", "current_text": "...", "issue": "...", "recommendation": "...", "issue_category": "sentence_structure"}]
If no issues found, return [].""" + DOCUMENT_REFERENCE_RULE + JOB_TITLE_RULE + TOLERANCE_VS_REFERENCE_RULE + PURPOSE_OBJECTIVE_RULE

# ---------------------------------------------------------------------------
# Structure analysis — heading extraction and template comparison
# ---------------------------------------------------------------------------

# Regex to detect common heading patterns in plain text
_HEADING_RE = re.compile(
    r"^(?:"
    r"\d[\d\.]*\s+[A-Z]"          # numbered: "1. Purpose" or "1.2 Scope"
    r"|[A-Z][A-Z0-9 /\-]{2,50}$"  # ALL CAPS headings
    r"|[A-Z][a-zA-Z0-9 /\-]{2,50}:?"  # Title Case headings
    r")",
    re.MULTILINE,
)


def _extract_headings(text: str) -> list[str]:
    """Return ordered list of candidate section headings found in the text."""
    headings = []
    for line in text.splitlines():
        line = line.strip()
        if not line or len(line) > 80:
            continue
        # Skip lines that look like body text (contain sentence-ending punctuation mid-line)
        if re.search(r"[.!?]\s+[a-z]", line):
            continue
        if _HEADING_RE.match(line):
            headings.append(line)
    return headings


def _normalise(text: str) -> str:
    """Lowercase and strip punctuation for fuzzy comparison."""
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def _heading_matches_section(heading: str, section: dict) -> bool:
    """Return True if heading text matches the section name or any alias."""
    h = _normalise(heading)
    candidates = [_normalise(section["name"])] + [_normalise(a) for a in section.get("aliases", [])]
    return any(c in h or h in c for c in candidates)


def _analyse_structure(text: str) -> list[StructureFlag]:
    """
    Compare document headings against the group template.

    Returns StructureFlag items for:
    - omission   — a required template section is absent from the document
    - ordering   — a section is present but appears before it should per the template
    - unexpected — a section that appears in the template but is optional and missing
                   (flagged as advisory rather than blocking)
    """
    flags: list[StructureFlag] = []
    headings = _extract_headings(text)

    # Map each heading to the index of the template section it matches (or None)
    matched_template_indices: list[int | None] = []
    for heading in headings:
        match = None
        for i, sec in enumerate(_TEMPLATE_SECTIONS):
            if _heading_matches_section(heading, sec):
                match = i
                break
        matched_template_indices.append(match)

    # Filter to only headings that matched a template section
    found_positions = {
        idx: heading
        for heading, idx in zip(headings, matched_template_indices)
        if idx is not None
    }  # {template_index: first heading text found}

    # 1. Omission detection
    for i, sec in enumerate(_TEMPLATE_SECTIONS):
        if i not in found_positions:
            sev = "high" if sec.get("required") else "low"
            detail = (
                f'Required section "{sec["name"]}" is absent from the document.'
                if sec.get("required")
                else f'Recommended section "{sec["name"]}" is not present.'
            )
            flags.append(StructureFlag(
                flag_type="omission",
                section=sec["name"],
                detail=detail,
                recommendation=(
                    f'Add a "{sec["name"]}" section. '
                    f'Refer to the group document template for expected content.'
                ),
                severity=sev,
            ))

    # 2. Ordering check — found sections should appear in ascending template-index order
    found_in_order = sorted(found_positions.items(), key=lambda x: x[0])  # sorted by template order
    actual_order = [
        (heading, idx)
        for heading, idx in zip(headings, matched_template_indices)
        if idx is not None
    ]

    # Build the "correct" sequence of heading texts (i.e. what order they should appear)
    correct_sequence = [found_positions[i] for i, _ in found_in_order]
    actual_sequence = [h for h, _ in actual_order]

    if actual_sequence != correct_sequence:
        # Find the first out-of-order section
        for pos, (actual_h, actual_idx) in enumerate(actual_order):
            expected_h = correct_sequence[pos] if pos < len(correct_sequence) else None
            if expected_h and actual_h != expected_h:
                # Identify which template section this heading maps to
                sec_name = _TEMPLATE_SECTIONS[actual_idx]["name"]
                expected_sec_name = _TEMPLATE_SECTIONS[
                    [i for i, _ in found_in_order][pos]
                ]["name"] if pos < len(found_in_order) else "unknown"
                flags.append(StructureFlag(
                    flag_type="ordering",
                    section=sec_name,
                    detail=(
                        f'Section "{sec_name}" appears at position {pos + 1} in the document '
                        f'but should follow "{expected_sec_name}" per the group template.'
                    ),
                    recommendation=(
                        f'Consider reordering sections to match the group template sequence: '
                        + " → ".join(s["name"] for s in _TEMPLATE_SECTIONS if s["name"] in [
                            _TEMPLATE_SECTIONS[i]["name"] for i, _ in found_in_order
                        ])
                    ),
                    severity="low",
                ))
                break  # Report the first ordering break only to avoid noise

    return flags


# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------

# EVIDENCE-PRESERVATION CONTRACT
# ================================
# _cleanse_text is the only place where raw chunk text is modified.
# Every transformation here MUST satisfy: cleansed meaning == original meaning.
# Permitted:
#   - Removing HTML/XML markup tags (carry no textual meaning in exported documents)
#   - Collapsing 3+ consecutive blank lines to 2 (cosmetic whitespace only)
#   - Straightening curly quotes (encoding artefact, no semantic value)
#   - Replacing em/en dashes with " - " INCLUDING surrounding spaces so that:
#       "cook - chill" is preserved as a two-word concept, not joined as "cook-chill"
# NOT permitted:
#   - Collapsing intra-line whitespace (spaces can denote table columns / indented sub-steps)
#   - Removing any word, phrase, number, symbol, or punctuation that could carry meaning
#   - Silently discarding content (use ContentIntegrityFlag to report it instead)

def _cleanse_text(text: str) -> str:
    """Normalise document text while preserving all operational meaning."""
    if not text:
        return ""
    # Strip HTML/XML markup — tags carry layout metadata, not procedural content
    text = re.sub(r"<[^>]+>", "", text)
    # Collapse 3+ consecutive blank lines to 2 (cosmetic only)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Straighten curly quotes (encoding artefact — no semantic change)
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    # Replace em/en dashes with spaced hyphen — preserves clause separation
    # e.g. "cook–chill" → "cook - chill" (two-word concept kept intact)
    text = text.replace("\u2013", " - ").replace("\u2014", " - ")
    # Intra-line whitespace is intentionally NOT collapsed (see contract above)
    return text.strip()


# ---------------------------------------------------------------------------
# Content integrity analysis — rule-based, no LLM required
# ---------------------------------------------------------------------------

# Patterns left by PDF / Word / SharePoint extractors when non-text elements
# are encountered during extraction. Each tuple is (regex_pattern, element_label).
_NON_TEXT_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\[IMAGE\b[^\]]*\]", re.IGNORECASE), "image placeholder"),
    (re.compile(r"\[TABLE\b[^\]]*\]", re.IGNORECASE), "table placeholder"),
    (re.compile(r"\[DIAGRAM\b[^\]]*\]", re.IGNORECASE), "diagram placeholder"),
    (re.compile(r"\[FIGURE\b[^\]]*\]", re.IGNORECASE), "figure placeholder"),
    (re.compile(r"\[CHART\b[^\]]*\]", re.IGNORECASE), "chart placeholder"),
    (re.compile(r"\[PHOTO\b[^\]]*\]", re.IGNORECASE), "photo placeholder"),
    # Common extractor markers: <<image>>, <<table>>, {image}, etc.
    (re.compile(r"<<\s*(image|table|figure|diagram|chart|photo)\s*>>", re.IGNORECASE), "embedded element marker"),
    (re.compile(r"\{\s*(image|table|figure|diagram|chart|photo)\s*\}", re.IGNORECASE), "embedded element marker"),
    # Explicit "Figure N" / "Table N" reference lines (standalone — not inline citations)
    (re.compile(r"^\s*(?:figure|fig\.?|table|diagram|image)\s+\d+[:\.\s]", re.IGNORECASE | re.MULTILINE), "figure/table reference"),
    # Extractor gap markers
    (re.compile(r"\[content removed\]|\[redacted\]|\[omitted\]|\[…\]|\[\.\.\.\]", re.IGNORECASE), "content removed marker"),
    # Visio / embedded object stubs
    (re.compile(r"Microsoft\s+(?:Visio|Excel|Word)\s+(?:Object|Diagram|Drawing)", re.IGNORECASE), "embedded object"),
]

# Minimum word count below which a line is considered a potential fragment.
# Procedural body lines are typically full sentences; very short lines that are
# not headings, list markers, or known labels are fragmentation candidates.
_FRAGMENT_MIN_WORDS = 4
_FRAGMENT_MAX_CHARS = 60  # short lines only

# Patterns that indicate a step or list was cut off mid-content
_TRUNCATION_PATTERNS: list[re.Pattern] = [
    re.compile(r"\.\.\.\s*$"),                         # trailing ellipsis
    re.compile(r"\b(?:cont(?:inued)?|contd)\.?\s*$", re.IGNORECASE),  # "continued" / "cont'd"
    re.compile(r"\(continued\)\s*$", re.IGNORECASE),
    re.compile(r"-\s*$"),                              # bare trailing dash (page-break artefact)
]

# A numbered/bulleted step that ends with just a colon suggests the body was cut
_STEP_COLON_RE = re.compile(
    r"^\s*(?:\d+[\.\)]\s+|\*\s+|-\s+|•\s+)[A-Za-z][^:\n]{5,}:\s*$",
    re.MULTILINE,
)

# Incomplete list: a line ending with ":" not followed by any list items within 3 lines
_LIST_INTRO_RE = re.compile(r"^.{5,80}:\s*$", re.MULTILINE)


def _nearby_heading(lines: list[str], line_idx: int) -> str:
    """Return the nearest heading above `line_idx` as a location label."""
    for i in range(line_idx - 1, max(-1, line_idx - 20), -1):
        candidate = lines[i].strip()
        if candidate and _HEADING_RE.match(candidate):
            return f'Near "{candidate}"'
    return f"Line {line_idx + 1}"


def _detect_non_text_elements(text: str) -> list[ContentIntegrityFlag]:
    """Detect placeholder markers left by document extractors for non-text elements."""
    flags: list[ContentIntegrityFlag] = []
    lines = text.splitlines()

    for pattern, label in _NON_TEXT_PATTERNS:
        for m in pattern.finditer(text):
            # Find which line this match is on
            line_idx = text[:m.start()].count("\n")
            location = _nearby_heading(lines, line_idx)
            excerpt = m.group(0)[:200]
            flags.append(ContentIntegrityFlag(
                flag_type="non_text_element",
                location=location,
                excerpt=excerpt,
                detail=(
                    f"A {label} was detected at this position. "
                    "Non-text elements are not readable by the analysis pipeline and "
                    "may carry critical operational information (e.g. process flow diagrams, "
                    "CCP control charts, allergen matrices)."
                ),
                recommendation=(
                    "Review the original document and, where the element carries operational "
                    "meaning, provide an equivalent text description or attach a separate "
                    "plain-text summary of its content."
                ),
                severity="high",
            ))

    return flags


def _is_table_context(lines: list[str], line_idx: int) -> bool:
    """
    Return True when a short line appears to be a table cell or column header
    rather than a genuine sentence fragment.

    Heuristic: if at least 2 of the 3 lines immediately before and after the
    candidate line are also short (< _FRAGMENT_MAX_CHARS chars, non-empty), the
    candidate sits inside a run of short lines that is characteristic of a
    table row being rendered as sequential standalone lines by the extractor.

    This suppresses false positives for column-header rows such as:
        Date
        Previous Version No.
        Reason for change
        Authorised
    which appear in a history-of-change table.
    """
    window: list[str] = []
    for offset in (-3, -2, -1, 1, 2, 3):
        idx = line_idx + offset
        if 0 <= idx < len(lines):
            neighbour = lines[idx].strip()
            if neighbour:
                window.append(neighbour)

    short_neighbours = sum(1 for n in window if len(n) < _FRAGMENT_MAX_CHARS)
    # Two or more short non-empty neighbours → table context
    return short_neighbours >= 2


def _detect_content_integrity(text: str) -> list[ContentIntegrityFlag]:
    """
    Detect fragmented sentences, truncated steps, and incomplete lists.
    These are typically artefacts of poor PDF extraction or copy-paste errors.
    """
    flags: list[ContentIntegrityFlag] = []
    lines = text.splitlines()

    for i, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue

        location = _nearby_heading(lines, i)

        # --- Truncation markers (ellipsis, "continued", bare trailing dash) ---
        for pat in _TRUNCATION_PATTERNS:
            if pat.search(line):
                flags.append(ContentIntegrityFlag(
                    flag_type="truncated_step",
                    location=location,
                    excerpt=line[:200],
                    detail=(
                        "This line ends with a truncation marker, suggesting content was "
                        "cut off during extraction (e.g. page-break artefact, partial copy)."
                    ),
                    recommendation=(
                        "Check the source document at this location and ensure the full "
                        "step or instruction is present in the text."
                    ),
                    severity="high",
                ))
                break  # one flag per line is enough

        # --- Numbered/bulleted step ending with a bare colon (body missing) ---
        # Often an extraction artefact: PDF/DOCX extraction can drop list items that follow.
        if _STEP_COLON_RE.match(raw_line):
            flags.append(ContentIntegrityFlag(
                flag_type="truncated_step",
                location=location,
                excerpt=line[:200],
                detail=(
                    "A procedural step ends with a colon but has no following content in the extracted text. "
                    "This is often an extraction artefact—the original document may have a list or sub-points "
                    "that were lost during PDF/DOCX conversion."
                ),
                recommendation=(
                    "Check the source document. If a list or sub-points exist there, the issue is extraction "
                    "quality (re-ingest may help). If the step is genuinely incomplete, add the content."
                ),
                severity="low",
            ))

        # --- Fragmented sentence: very short body line that is not a heading/label ---
        # Table-context suppression: if 2+ of the 3 neighbouring lines are also short,
        # this line is almost certainly a table cell or column header row, not a
        # genuine extraction fragment. Suppress to avoid false positives.
        if (
            len(line) < _FRAGMENT_MAX_CHARS
            and len(line.split()) < _FRAGMENT_MIN_WORDS
            and not _HEADING_RE.match(line)
            and not re.match(r"^\s*[\d\*\-•]", line)   # not a list marker
            and re.search(r"[a-z]", line)               # contains lowercase (not a label)
            and not line.endswith(":")                  # not a list intro (handled separately)
            and not _is_table_context(lines, i)         # not a table row
        ):
            flags.append(ContentIntegrityFlag(
                flag_type="fragmented_sentence",
                location=location,
                excerpt=line[:200],
                detail=(
                    "This line is very short and does not form a complete sentence or "
                    "recognised label. It may be a sentence fragment left by extraction."
                ),
                recommendation=(
                    "Check whether this text is the tail of a sentence whose beginning "
                    "was on the previous page, or the start of a sentence whose continuation "
                    "was lost. Restore or remove as appropriate."
                ),
                severity="medium",
            ))

    # --- Incomplete list: a colon-ending intro line with no list items following ---
    for m in _LIST_INTRO_RE.finditer(text):
        # Look at the next 3 non-empty lines for any list-item marker
        line_idx = text[:m.start()].count("\n")
        remaining_lines = [l.strip() for l in lines[line_idx + 1: line_idx + 4] if l.strip()]
        has_list_item = any(
            re.match(r"^\s*[\d\*\-•]|^\s*[a-z]\)", l) for l in remaining_lines
        )
        if not has_list_item and remaining_lines:
            intro = m.group(0).strip()
            location = _nearby_heading(lines, line_idx)
            flags.append(ContentIntegrityFlag(
                flag_type="incomplete_list",
                location=location,
                excerpt=intro[:200],
                detail=(
                    f'The line "{intro}" ends with a colon suggesting a list follows, '
                    "but no bulleted/numbered list items were found in the extracted text. "
                    "This is often an extraction artefact—PDF/DOCX conversion can drop list formatting."
                ),
                recommendation=(
                    "Check the source document. If a list exists there, the issue is extraction quality "
                    "(re-ingest may help; DOCX list items are now preserved with bullets). "
                    "If the document is genuinely incomplete, add the list or reword as a complete sentence."
                ),
                severity="low",
            ))

    return flags


# ---------------------------------------------------------------------------
# US vs UK spelling detection — rule-based, Pass 4
# ---------------------------------------------------------------------------
# Map of US spelling → preferred UK spelling.
# Cranswick is a UK company; all documents should use UK English.
# The list is deliberately comprehensive for a food-manufacturing context but is
# not exhaustive — the YOU MUST IDENTIFY principle applies here too.
# Keys are whole-word patterns (matched case-insensitively).

_US_TO_UK: dict[str, str] = {
    # -ize → -ise
    "authorize": "authorise",
    "authorized": "authorised",
    "authorization": "authorisation",
    "recognize": "recognise",
    "recognized": "recognised",
    "organize": "organise",
    "organized": "organised",
    "organization": "organisation",
    "utilize": "utilise",
    "utilized": "utilised",
    "utilization": "utilisation",
    "standardize": "standardise",
    "standardized": "standardised",
    "standardization": "standardisation",
    "minimize": "minimise",
    "minimized": "minimised",
    "maximize": "maximise",
    "maximized": "maximised",
    "prioritize": "prioritise",
    "prioritized": "prioritised",
    "sanitize": "sanitise",
    "sanitized": "sanitised",
    "pasteurize": "pasteurise",
    "pasteurized": "pasteurised",
    "pasteurization": "pasteurisation",
    "sterilize": "sterilise",
    "sterilized": "sterilised",
    "sterilization": "sterilisation",
    "characterize": "characterise",
    "characterized": "characterised",
    "analyze": "analyse",
    "analyzed": "analysed",
    "analyzer": "analyser",
    "stabilize": "stabilise",
    "categorize": "categorise",
    "synchronize": "synchronise",
    "specialize": "specialise",
    "randomize": "randomise",
    # -or → -our
    "color": "colour",
    "flavor": "flavour",
    "harbor": "harbour",
    "honor": "honour",
    "labor": "labour",
    "neighbor": "neighbour",
    "odor": "odour",
    "vapor": "vapour",
    "behavior": "behaviour",
    "behavior": "behaviour",
    "endeavor": "endeavour",
    # -er → -re
    "center": "centre",
    "fiber": "fibre",
    "theater": "theatre",
    "caliber": "calibre",
    "liter": "litre",
    "meter": "metre",   # measurement unit (not the device 'meter')
    "milliliter": "millilitre",
    # -ense → -ence
    "defense": "defence",
    "offense": "offence",
    "license": "licence",   # noun form; "to license" (verb) is correct in UK too
    # -og → -ogue
    "catalog": "catalogue",
    "dialog": "dialogue",
    "analog": "analogue",
    # Double-l variations
    "fulfill": "fulfil",
    "skillful": "skilful",
    "enrollment": "enrolment",
    "installment": "instalment",
    "traveler": "traveller",
    # Food / manufacturing specific US terms
    "aluminum": "aluminium",
    "sulfur": "sulphur",
    "sulfuric": "sulphuric",
    "sulfate": "sulphate",
    "sulfite": "sulphite",
    "program": "programme",   # in non-computing context
    "check": "check",         # not a US/UK difference — skip, left as reminder
    "aging": "ageing",
    "acknowledgment": "acknowledgement",
    "judgment": "judgement",
    "labeled": "labelled",
    "labeling": "labelling",
    "traveling": "travelling",
    "canceled": "cancelled",
    "canceling": "cancelling",
    "focussed": "focussed",   # both acceptable in UK — included for completeness
    "focused": "focused",     # ditto — skip flagging
}

# Pre-compile as whole-word case-insensitive patterns for performance.
# Store as list of (pattern, us_word, uk_word) tuples.
_US_SPELLING_PATTERNS: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"\b" + re.escape(us) + r"\b", re.IGNORECASE), us, uk)
    for us, uk in _US_TO_UK.items()
    # Skip entries where us == uk (placeholder notes left in the dict)
    if us != uk
]


def _detect_us_spelling(text: str) -> list[ContentIntegrityFlag]:
    """
    Flag US spellings that should be replaced with UK equivalents.
    Each unique (word, location) pair is reported once to avoid flooding.
    """
    flags: list[ContentIntegrityFlag] = []
    lines = text.splitlines()
    # Track (us_word_lower, line_idx) already reported to avoid duplicates
    reported: set[tuple[str, int]] = set()

    for pattern, us_word, uk_word in _US_SPELLING_PATTERNS:
        for m in pattern.finditer(text):
            line_idx = text[:m.start()].count("\n")
            key = (us_word.lower(), line_idx)
            if key in reported:
                continue
            reported.add(key)

            location = _nearby_heading(lines, line_idx)
            matched = m.group(0)  # preserves original casing for the excerpt
            flags.append(ContentIntegrityFlag(
                flag_type="us_spelling",
                location=location,
                excerpt=matched,
                detail=(
                    f'US spelling detected: "{matched}". '
                    f'Cranswick documents must use UK English.'
                ),
                recommendation=f'Replace "{matched}" with "{uk_word}".',
                severity="low",
            ))

    return flags


# ---------------------------------------------------------------------------
# Encoding anomaly detection — rule-based, Pass 5
# ---------------------------------------------------------------------------
# Characters and patterns that indicate encoding problems. These typically arise
# from copy-paste from Word, PDF extraction, or legacy system exports.

_ENCODING_ANOMALIES: list[tuple[re.Pattern, str, str]] = [
    # Unicode replacement character — the definitive "something went wrong" marker
    (
        re.compile(r"\ufffd"),
        "Unicode replacement character (U+FFFD)",
        "A character could not be decoded. The source encoding may not be UTF-8. "
        "Re-export the document as UTF-8 or identify and correct the affected characters.",
    ),
    # Mojibake sequences — common UTF-8 bytes mis-decoded as Windows-1252.
    # Patterns expressed as Unicode escapes to avoid embedding raw multibyte chars.
    # â€™ = U+00E2 U+20AC U+2122  (right single quotation mark mojibake)
    # â€œ = U+00E2 U+20AC U+0153  (left double quotation mark mojibake)
    # Ã© = U+00C3 U+00A9          (é mojibake)
    (
        re.compile(
            r"\u00e2\u20ac\u2122"   # â€™
            r"|\u00e2\u20ac\u0153"  # â€œ
            r"|\u00e2\u20ac\u009d"  # â€\x9d
            r"|\u00c3\u00a9"        # Ã©
            r"|\u00c3\u00a8"        # Ã¨
            r"|\u00c3\u00a0"        # Ã 
            r"|\u00c3\u00a2"        # Ã¢
            r"|\u00c3\u00ae"        # Ã®
            r"|\u00c3\u00b4"        # Ã´
            r"|\u00c3\u00bb"        # Ã»
            r"|\u00c3\u20ac"        # Ã€
            r"|\u00e2\u20ac\u201c"  # â€"  (en dash mojibake)
            r"|\u00e2\u20ac\u201d"  # â€"  (em dash mojibake)
        ),
        "mojibake sequence (UTF-8 decoded as Windows-1252)",
        "These characters are garbled text caused by mismatched encoding. "
        "Re-save the document as UTF-8 and re-ingest.",
    ),
    # Null bytes — corrupt extraction
    (
        re.compile(r"\x00"),
        "null byte",
        "Null bytes indicate a binary extraction artefact or corrupt file. "
        "Re-export the source document as clean plain text.",
    ),
    # Control characters other than tab, newline, carriage return
    (
        re.compile(r"[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]"),
        "non-printable control character",
        "Control characters in procedural text indicate a corrupt or mis-encoded export. "
        "Strip these characters and verify the content is intact.",
    ),
    # Windows-1252 / Latin-1 artefacts that survived as literal bytes
    (
        re.compile(r"[\x80-\x9f]"),
        "Windows-1252 / Latin-1 control-range character",
        "These characters belong to the Windows-1252 extended range and are not valid UTF-8. "
        "Re-export the document as UTF-8.",
    ),
    # Repeated question marks (PDF extraction fallback for unrecognised glyphs)
    (
        re.compile(r"\?{3,}"),
        "repeated question marks (unrecognised glyph fallback)",
        "Three or more consecutive question marks typically indicate unrecognised characters "
        "in a PDF extraction. Check the original document for the intended content.",
    ),
    # Zero-width characters (invisible formatting artefacts)
    (
        re.compile(r"[\u200b\u200c\u200d\ufeff]"),
        "zero-width / BOM character",
        "Zero-width or BOM characters are invisible formatting artefacts that can corrupt "
        "text comparisons and searches. Strip them from the document.",
    ),
]


def _detect_encoding_anomalies(text: str) -> list[ContentIntegrityFlag]:
    """
    Detect non-UTF-8 or encoding anomaly characters in the raw (pre-cleanse) text.

    Deduplication strategy: ONE flag per anomaly type per document.
    The excerpt shows the first occurrence; the detail reports the total hit count.
    This prevents a single corrupt field (e.g. a history-of-change table peppered
    with \\x07 list-paragraph separators) from flooding the flag list with dozens of
    near-identical findings for the same root cause.
    """
    lines = text.splitlines()

    # First pass: collect all matches grouped by anomaly_label
    # {anomaly_label: {"count": int, "first_match": re.Match, "recommendation": str}}
    collected: dict[str, dict] = {}

    for pattern, anomaly_label, recommendation in _ENCODING_ANOMALIES:
        for m in pattern.finditer(text):
            if anomaly_label not in collected:
                collected[anomaly_label] = {
                    "count": 0,
                    "first_match": m,
                    "recommendation": recommendation,
                }
            collected[anomaly_label]["count"] += 1

    # Second pass: emit one flag per type with count context
    flags: list[ContentIntegrityFlag] = []
    for anomaly_label, info in collected.items():
        m = info["first_match"]
        count = info["count"]
        line_idx = text[:m.start()].count("\n")
        location = _nearby_heading(lines, line_idx)

        # Representative excerpt: 20 chars either side of first occurrence
        start = max(0, m.start() - 20)
        end = min(len(text), m.end() + 20)
        excerpt = repr(text[start:end])[:200]

        count_note = (
            f" Found {count} occurrence{'s' if count > 1 else ''} in this document."
            if count > 1
            else ""
        )
        flags.append(ContentIntegrityFlag(
            flag_type="encoding_anomaly",
            location=location,
            excerpt=excerpt,
            detail=(
                f"Encoding anomaly detected: {anomaly_label}.{count_note} "
                "All occurrences share the same root cause and are reported here once."
            ),
            recommendation=info["recommendation"],
            severity="medium",
        ))

    return flags


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class CleansingAgent(BaseAgent):
    name = "cleansing"

    async def run(self, ctx: PipelineContext) -> PipelineContext:
        # Prefer full document content when available — avoids chunk overlap duplicates (e.g. heading flagged twice)
        if ctx.full_document_content:
            ctx.cleansed_content = _cleanse_text(ctx.full_document_content)
        elif ctx.retrieved_chunks:
            parts: list[str] = []
            for chunk in ctx.retrieved_chunks:
                text = _cleanse_text(chunk.text)
                if text:
                    parts.append(text)
            ctx.cleansed_content = "\n\n".join(parts) if parts else None
        else:
            self._add_error(ctx, "No retrieved chunks or full document content to cleanse", "critical")
            return ctx
        if not ctx.cleansed_content:
            self._add_error(ctx, "Cleansed content is empty", "critical")
            return ctx

        # --- Pass 1: specification / vagueness analysis (LLM) ---
        try:
            glossary = (getattr(ctx, "glossary_block", None) or "").strip() or get_glossary_block(_DOMAIN_CTX)
            system_prompt = CLEANSING_SPEC_PROMPT
            if glossary:
                system_prompt = f"{system_prompt}\n\n{glossary}"
            prompt = (
                "Analyse the following document for vague or subjective wording and sentence-level clarity for operatives. "
                "Do not raise acronyms, abbreviations, or glossary issues (Terminology agent). "
                "Apply execution-safety principles: short direct sentences, one action per sentence, avoid unnecessary wordiness. "
                "Assess symbol/range/unit/visual representation risks (inequalities, range notation, °C/%, kg, diagrams/colour cues) as comprehension/tacit-assumption issues, not missing-spec issues — Route to Specifier if no limit is stated. "
                "For generic/filler words (e.g. appropriate, sufficient): only Cleansing if comprehension fails; if the gap is missing limits, frequency, tolerance, or time bounds, flag with recommendation starting 'Route to Specifier:' and do not invent values. "
                "Preserve must/shall/should/may and verification/recording/authorisation intent; never swap modals in recommendations. If a clarity fix would change modality, propose a modality-preserving alternative and escalate to HITL for human approval. "
                "Output JSON array only; each finding must include issue_category (readability | tacit_assumption | generic_filler_language | sentence_structure | reference_usability). No severity field. "
                "Each issue must be a separate item.\n\n"
                f"{slice_document_for_agent(ctx.cleansed_content)}"
            )
            raw = await completion(prompt, system=system_prompt)
            items = parse_json_array(raw)
            for item in items:
                if (
                    isinstance(item, dict)
                    and item.get("location")
                    and item.get("current_text")
                    and item.get("issue")
                    and item.get("recommendation")
                ):
                    ctx.cleanser_flags.append(
                        CleanserFlag(
                            location=str(item["location"]),
                            current_text=str(item["current_text"]),
                            issue=str(item["issue"]),
                            recommendation=str(item["recommendation"]),
                            issue_category=_normalize_cleanser_issue_category(item.get("issue_category")),
                            representation_class_id=str(item.get("representation_class_id") or "").strip(),
                            representation_standard_ref=str(item.get("representation_standard_ref") or "").strip(),
                        )
                    )
        except Exception as e:
            self._add_error(ctx, f"Cleansing specification analysis failed: {e}", "high")

        # --- Pass 1b: Representation & Notation Standard (Appendix A) — deterministic lint ---
        try:
            _snippet_key = lambda s: " ".join(str(s or "").split())[:320]
            existing_keys = {_snippet_key(f.current_text) for f in ctx.cleanser_flags}
            for payload in hits_to_cleanser_payloads(lint_representation_notation(ctx.cleansed_content)):
                k = _snippet_key(payload.get("current_text"))
                if k in existing_keys:
                    continue
                existing_keys.add(k)
                ctx.cleanser_flags.append(
                    CleanserFlag(
                        location=str(payload["location"]),
                        current_text=str(payload["current_text"]),
                        issue=str(payload["issue"]),
                        recommendation=str(payload["recommendation"]),
                        issue_category="tacit_assumption",
                        representation_class_id=str(payload.get("representation_class_id") or ""),
                        representation_standard_ref=str(payload.get("representation_standard_ref") or ""),
                    )
                )
        except Exception as e:
            self._add_error(ctx, f"Representation notation lint failed: {e}", "low")

        # --- Pass 2: structure / template compliance analysis (rule-based) ---
        try:
            structure_flags = _analyse_structure(ctx.cleansed_content)
            ctx.structure_flags.extend(structure_flags)
        except Exception as e:
            self._add_error(ctx, f"Cleansing structure analysis failed: {e}", "low")

        # --- Passes 3–5 share a single raw_text build (pre-cleanse) ---
        raw_text = ctx.full_document_content or "\n\n".join(c.text for c in ctx.retrieved_chunks)

        # --- Pass 3: content integrity — non-text elements + fragmentation (rule-based) ---
        try:
            non_text_flags = _detect_non_text_elements(raw_text)
            integrity_flags = _detect_content_integrity(ctx.cleansed_content)
            ctx.content_integrity_flags.extend(non_text_flags)
            ctx.content_integrity_flags.extend(integrity_flags)
        except Exception as e:
            self._add_error(ctx, f"Cleansing content integrity analysis failed: {e}", "low")

        # --- Pass 4: US vs UK spelling detection (rule-based) ---
        try:
            spelling_flags = _detect_us_spelling(ctx.cleansed_content)
            ctx.content_integrity_flags.extend(spelling_flags)
        except Exception as e:
            self._add_error(ctx, f"Cleansing spelling analysis failed: {e}", "low")

        # --- Pass 5: encoding anomaly detection — run on raw text before cleansing ---
        try:
            encoding_flags = _detect_encoding_anomalies(raw_text)
            ctx.content_integrity_flags.extend(encoding_flags)
        except Exception as e:
            self._add_error(ctx, f"Cleansing encoding analysis failed: {e}", "low")

        return ctx
