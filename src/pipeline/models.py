"""Pipeline models: PipelineContext, agent outputs, enums."""
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from src.rag.models import DocLayer, DocumentChunk


class RequestType(str, Enum):
    new_document = "new_document"
    update_existing = "update_existing"
    contradiction_flag = "contradiction_flag"
    review_request = "review_request"  # Legacy; prefer single_document_review, harmonisation_review, principle_layer_review
    single_document_review = "single_document_review"      # All agents
    harmonisation_review = "harmonisation_review"          # Alignment with existing policies
    principle_layer_review = "principle_layer_review"      # Principle layer: capture enough of the What


class RiskLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Document(BaseModel):
    """Full document (parent policy, sibling, current version)."""
    id: str
    title: str
    content: str
    doc_layer: DocLayer
    sites: list[str] = Field(default_factory=list)
    policy_ref: str | None = None


class TerminologyFlag(BaseModel):
    term: str
    issue: str
    recommendation: str
    location: str | None = None  # Exact quote from document where term appears (evidence)
    glossary_candidate: bool = False  # True when term is vague/undefined — route to HITL, add to glossary


class Conflict(BaseModel):
    conflict_type: str  # UNSANCTIONED_CONFLICT | SANCTIONED_VARIANCE | PENDING_REVIEW | PARENT_BREACH
    severity: str  # info | low | medium | high | critical
    layer: str
    sites: list[str] = Field(default_factory=list)
    document_refs: list[str] = Field(default_factory=list)
    description: str
    recommendation: str
    blocks_draft: bool = False


class RiskScore(BaseModel):
    conflict_ref: str
    severity: int  # 1-6
    likelihood: int  # 1-6
    detectability: int  # 1-6
    score: int
    band: str  # low | medium | high | critical
    rationale: str
    remediation_priority: int


class RiskGap(BaseModel):
    """Gap or assumption identified by Risk agent. HACCP score = severity × likelihood × detectability (JSON fields fmea_score / fmea_band retained for API compatibility)."""
    location: str
    excerpt: str | None = None  # Exact text from document to highlight (copy-paste from source)
    issue: str
    risk: str
    recommendation: str
    severity: int = 0          # 1–6 (0 = not scored)
    likelihood: int = 0       # 1–6; failure likelihood under current controls
    detectability: int = 0    # 1–6, or 0 = omitted (server uses neutral default for product)
    fmea_score: int = 0       # HACCP score = S×L×D (1–216); field name legacy
    fmea_band: str = ""       # low | medium | high | critical; field name legacy

    @model_validator(mode="before")
    @classmethod
    def _legacy_scope_to_likelihood(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if "likelihood" not in data and "scope" in data:
            return {**data, "likelihood": data.get("scope") or 0}
        return data


class SpecifyingFlag(BaseModel):
    """Vague or unmeasurable language flagged by Specifying agent."""
    location: str
    current_text: str
    issue: str
    recommendation: str


CleanserIssueCategory = Literal[
    "readability",
    "tacit_assumption",
    "generic_filler_language",
    "sentence_structure",
    "reference_usability",
]


class CleanserFlag(BaseModel):
    """Clarity or accessibility issue flagged by Cleanser."""
    location: str
    current_text: str
    issue: str
    recommendation: str
    issue_category: CleanserIssueCategory = "readability"


class StructureFlag(BaseModel):
    """Group template compliance issue identified during cleansing."""
    flag_type: str       # omission | ordering | unexpected
    section: str         # Template section name (or detected heading for ordering)
    detail: str          # Human-readable description of the issue
    recommendation: str  # Suggested action
    severity: str = "medium"  # low | medium | high


class ContentIntegrityFlag(BaseModel):
    """
    Non-text element, content integrity, spelling, or encoding issue detected during cleansing.

    flag_type values:
      non_text_element    — image, table, diagram, or figure marker found in the text;
                            the element may carry operational meaning that cannot be read
      fragmented_sentence — sentence appears to have been cut mid-clause (extraction artefact)
      truncated_step      — a numbered or bulleted procedural step ends abruptly
      incomplete_list     — a list item ends with a colon or continuation marker with no
                            following items (list was cut)
      us_spelling         — US English spelling detected; Cranswick requires UK English
      encoding_anomaly    — non-UTF-8 character, replacement character, mojibake, or
                            control character detected in the raw document text
    """
    flag_type: str    # non_text_element | fragmented_sentence | truncated_step | incomplete_list
    location: str     # Best-effort location: line number or nearby heading
    excerpt: str      # The offending text (truncated to 200 chars)
    detail: str       # What the problem is
    recommendation: str
    severity: str = "medium"  # low | medium | high


class SequencingFlag(BaseModel):
    """Sequencing or logic issue flagged by Sequencing agent."""
    location: str
    excerpt: str | None = None  # Exact text from document to highlight (copy-paste from source)
    issue: str
    finding_type: str | None = None  # EXPLICIT_REFERENCE | PREREQUISITE | COMPLETION_SEQUENCE | DECISION_LOGIC | INTERNAL_CONTRADICTION
    dependency_signal: str | None = None  # "1" | "2" | "3" | "4" | "5"
    signal_evidence: str | None = None  # Exact phrase(s) that create the dependency
    impact: str
    recommendation: str | None = None  # null when escalated to HITL (e.g. branch ambiguity per agent rules)
    hitl_reason: str | None = None
    priority: str | None = None  # MUST FIX | SHOULD FIX
    citations: list[str] = Field(default_factory=list)


class FormattingFlag(BaseModel):
    """Format or structural issue flagged by Formatting agent."""
    location: str
    excerpt: str | None = None  # Exact text from document to highlight (copy-paste from source)
    issue: str
    recommendation: str
    citations: list[str] = Field(default_factory=list)


class PolicyClauseMapping(BaseModel):
    """
    Grounded link from a compliance finding to policy_clause_records.
    status=linked only after ID + verbatim quote verification.
    """
    status: str = "unmapped"  # linked | unmapped
    policy_document_id: str | None = None
    clause_id: str | None = None
    canonical_citation: str | None = None
    standard_name: str | None = None
    supporting_quote: str | None = None  # Verified substring of requirement_text
    requirement_preview: str | None = None  # Short UI preview of the clause body
    unmapped_reason: str | None = None  # no_policy_scope | no_candidates | model_none | verify_failed | error | not_run | disabled
    site_scope: list[str] = Field(default_factory=list)  # Sites where this standard applies (from site_standard_links)


class ComplianceFlag(BaseModel):
    """Regulatory or compliance gap flagged by Validation agent."""
    location: str
    excerpt: str | None = None  # Exact text from document to highlight (copy-paste from source)
    issue: str
    recommendation: str
    clause_mapping: PolicyClauseMapping | None = None


class ValidationResult(BaseModel):
    draft_ready: bool
    policy_requirements_found: int = 0
    policy_requirements_addressed: int = 0
    policy_requirements_missing: list[str] = Field(default_factory=list)
    specifying_flags_count: int = 0
    sequencing_flags_count: int = 0
    placeholder_count: int = 0
    self_consistent: bool = True
    parent_ref_valid: bool = True
    blocking_issues: list[str] = Field(default_factory=list)
    advisory_issues: list[str] = Field(default_factory=list)
    validation_summary: str = ""


class PipelineError(BaseModel):
    agent: str
    message: str
    severity: str  # info | low | medium | high | critical


class PipelineContext(BaseModel):
    # Input
    tracking_id: str
    request_type: RequestType
    doc_layer: DocLayer
    sites: list[str] = Field(default_factory=list)
    policy_ref: str | None = None
    attached_doc_url: str | None = None
    document_id: str | None = None   # Document being analysed (from request) — used to avoid cross-doc contamination
    document_title: str | None = None  # Title from request — authoritative for Formatting agent

    # RAG retrieval (pre-pipeline)
    retrieved_chunks: list[DocumentChunk] = Field(default_factory=list)
    full_document_content: str | None = None  # When document_id set: full text from document_content table (avoids chunk overlap)
    parent_policy: Document | None = None
    higher_order_policies: list[Document] = Field(default_factory=list)
    current_version: Document | None = None
    sibling_docs: list[Document] = Field(default_factory=list)
    agent_instructions: str | None = None  # User-provided knowledge for agents; never supersedes policy
    prior_feedback: list[dict] = Field(default_factory=list)  # Prior user notes for this document (from finding_notes), checked before reasoning
    glossary_block: str | None = None  # Standard glossary (from domain_context.json)

    # Agent outputs
    cleansed_content: str | None = None
    terminology_flags: list[TerminologyFlag] = Field(default_factory=list)
    conflicts: list[Conflict] = Field(default_factory=list)
    risk_scores: list[RiskScore] = Field(default_factory=list)
    risk_gaps: list[RiskGap] = Field(default_factory=list)
    cleanser_flags: list[CleanserFlag] = Field(default_factory=list)
    specifying_flags: list[SpecifyingFlag] = Field(default_factory=list)
    structure_flags: list[StructureFlag] = Field(default_factory=list)
    content_integrity_flags: list[ContentIntegrityFlag] = Field(default_factory=list)
    sequencing_flags: list[SequencingFlag] = Field(default_factory=list)
    formatting_flags: list[FormattingFlag] = Field(default_factory=list)
    compliance_flags: list[ComplianceFlag] = Field(default_factory=list)
    draft_content: str | None = None
    validation_result: ValidationResult | None = None

    # Pipeline state
    errors: list[PipelineError] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    agents_run: list[str] = Field(default_factory=list)
    agent_timings: list[dict] = Field(default_factory=list)  # [{"agent": str, "duration_ms": int}]
    draft_ready: bool = False

    # Output summary (populated by router)
    overall_risk: RiskLevel | None = None
    conflict_count: int = 0
    blocker_count: int = 0
