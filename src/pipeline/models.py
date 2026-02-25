"""Pipeline models: PipelineContext, agent outputs, enums."""
from enum import Enum
from pydantic import BaseModel, Field

from src.rag.models import DocLayer, DocumentChunk


class RequestType(str, Enum):
    new_document = "new_document"
    update_existing = "update_existing"
    contradiction_flag = "contradiction_flag"
    review_request = "review_request"


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
    severity: int  # 1-5
    scope: int  # 1-5
    detectability: int  # 1-5
    score: int
    band: str  # low | medium | high | critical
    rationale: str
    remediation_priority: int


class RiskGap(BaseModel):
    """Gap or assumption identified by Risk agent."""
    location: str
    issue: str
    risk: str
    recommendation: str


class SpecifyingFlag(BaseModel):
    """Vague or unmeasurable language flagged by Specifying agent."""
    location: str
    current_text: str
    issue: str
    recommendation: str


class SequencingFlag(BaseModel):
    """Sequencing or logic issue flagged by Sequencing agent."""
    location: str
    issue: str
    impact: str
    recommendation: str


class FormattingFlag(BaseModel):
    """Format or structural issue flagged by Formatting agent."""
    location: str
    issue: str
    recommendation: str


class ComplianceFlag(BaseModel):
    """Regulatory or compliance gap flagged by Validation agent."""
    location: str
    issue: str
    requirement_reference: str | None = None
    recommendation: str


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

    # RAG retrieval (pre-pipeline)
    retrieved_chunks: list[DocumentChunk] = Field(default_factory=list)
    parent_policy: Document | None = None
    current_version: Document | None = None
    sibling_docs: list[Document] = Field(default_factory=list)

    # Agent outputs
    cleansed_content: str | None = None
    terminology_flags: list[TerminologyFlag] = Field(default_factory=list)
    conflicts: list[Conflict] = Field(default_factory=list)
    risk_scores: list[RiskScore] = Field(default_factory=list)
    risk_gaps: list[RiskGap] = Field(default_factory=list)
    specifying_flags: list[SpecifyingFlag] = Field(default_factory=list)
    sequencing_flags: list[SequencingFlag] = Field(default_factory=list)
    formatting_flags: list[FormattingFlag] = Field(default_factory=list)
    compliance_flags: list[ComplianceFlag] = Field(default_factory=list)
    draft_content: str | None = None
    validation_result: ValidationResult | None = None

    # Pipeline state
    errors: list[PipelineError] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    agents_run: list[str] = Field(default_factory=list)
    draft_ready: bool = False

    # Output summary (populated by router)
    overall_risk: RiskLevel | None = None
    conflict_count: int = 0
    blocker_count: int = 0

