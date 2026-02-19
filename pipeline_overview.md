# Agent Pipeline — Overview

## Design Principle

The pipeline is a **sequential chain with selective activation**. Workato makes one HTTP call and gets one structured report back. All agent complexity is encapsulated inside the Python service — Workato never needs to know how many agents ran or in what order.

Agents do not call each other. The Router orchestrates. Each agent receives a `PipelineContext`, enriches it, and returns it.

---

## Pipeline Sequence

```
Request arrives at /analyse
         │
    ┌────▼────┐
    │ ROUTER  │  ← decides which agents fire based on request_type
    └────┬────┘
         │
    ┌────▼──────────┐
    │ 1. CLEANSING  │  ← always runs
    └────┬──────────┘
         │
    ┌────▼──────────┐
    │ 2. TERMINOLOGY│  ← always runs
    └────┬──────────┘
         │
    ┌────▼──────────┐         ┌──────────────────────┐
    │ 3. CONFLICT   │  ──────▶│ 4. RISK              │
    │   DETECTION   │  (only  │   (only if conflicts  │
    └────┬──────────┘  if      │    detected)         │
         │             analysis)└──────────────────────┘
         │
    ┌────▼──────────┐
    │ 5. SPECIFYING │  ← only if drafting
    └────┬──────────┘
         │
    ┌────▼──────────┐
    │ 6. SEQUENCING │  ← only if drafting SOP or Work Instruction
    └────┬──────────┘
         │
    ┌────▼──────────┐
    │ 7. FORMATTING │  ← always runs post-draft
    └────┬──────────┘
         │
    ┌────▼──────────┐
    │ 8. VALIDATION │  ← always runs last
    └────┬──────────┘
         │
    Single JSON report returned to Workato
```

---

## Routing Logic

The Router reads `request_type` and `doc_layer` to build an `agents_to_run` list before the pipeline starts.

| Request Type | Agents Activated |
|-------------|-----------------|
| `new_document` (any layer) | All 8 |
| `update_existing` | All 8 |
| `contradiction_flag` | 1, 2, 3, 4, 8 |
| `review_request` | 1, 2, 3, 4, 8 |

| Doc Layer | Additional routing |
|-----------|-------------------|
| `policy` or `principle` | Skip agent 6 (Sequencing — step logic not relevant) |
| `sop` or `work_instruction` | Run all |

Risk agent (4) only activates if Conflict agent (3) returns one or more conflicts.

---

## PipelineContext Schema

```python
class PipelineContext(BaseModel):
    # ── Input ──────────────────────────────────
    tracking_id: str
    request_type: RequestType          # Enum
    doc_layer: DocLayer                # Enum
    sites: list[str]
    policy_ref: str | None
    attached_doc_url: str | None
    
    # ── RAG Retrieval (pre-pipeline) ───────────
    retrieved_chunks: list[DocumentChunk]
    parent_policy: Document | None
    current_version: Document | None   # for updates
    sibling_docs: list[Document]       # same layer, other sites
    
    # ── Agent Outputs (populated as pipeline runs)
    cleansed_content: str | None
    terminology_flags: list[TerminologyFlag]
    conflicts: list[Conflict]
    risk_scores: list[RiskScore]
    draft_content: str | None
    validation_result: ValidationResult | None
    
    # ── Pipeline State ─────────────────────────
    errors: list[PipelineError]
    warnings: list[str]
    agents_run: list[str]
    draft_ready: bool = False
    
    # ── Output Summary (populated by router after pipeline)
    overall_risk: RiskLevel | None
    conflict_count: int = 0
    blocker_count: int = 0
```

---

## Base Agent Interface

All agents implement:

```python
class BaseAgent(ABC):
    name: str
    
    @abstractmethod
    async def run(self, ctx: PipelineContext) -> PipelineContext:
        """
        Receives context, performs analysis, enriches context, returns it.
        Never raises — append to ctx.errors instead.
        """
        pass
    
    def _add_error(self, ctx: PipelineContext, message: str, severity: str):
        ctx.errors.append(PipelineError(
            agent=self.name,
            message=message,
            severity=severity
        ))
```

---

## Router Implementation Notes

```python
class PipelineRouter:
    
    async def run(self, ctx: PipelineContext) -> PipelineContext:
        agents = self._select_agents(ctx)
        
        for agent in agents:
            ctx = await agent.run(ctx)
            ctx.agents_run.append(agent.name)
            
            # Check for blockers after each agent
            blockers = [e for e in ctx.errors if e.severity == "critical"]
            if blockers:
                break  # halt pipeline, return what we have
        
        ctx = self._build_summary(ctx)
        return ctx
    
    def _select_agents(self, ctx: PipelineContext) -> list[BaseAgent]:
        # See routing table above
        ...
```

---

## Output Report Structure

The pipeline returns this JSON to Workato:

```json
{
  "tracking_id": "...",
  "draft_ready": true,
  "overall_risk": "medium",
  "conflict_count": 2,
  "blocker_count": 0,
  "conflicts": [
    {
      "type": "UNSANCTIONED_CONFLICT",
      "severity": "medium",
      "sites": ["site_north", "site_south"],
      "description": "...",
      "recommendation": "..."
    }
  ],
  "terminology_flags": [
    {
      "term": "critical control point",
      "issue": "defined differently in site_north SOP-003 vs site_south SOP-007",
      "recommendation": "Align to Principle P-012 definition"
    }
  ],
  "risk_scores": [...],
  "warnings": [...],
  "errors": [],
  "agents_run": ["cleansing", "terminology", "conflict", "risk", "specifying", "sequencing", "formatting", "validation"]
}
```

---

## Adding a New Agent

1. Create `src/pipeline/agents/my_agent.py` extending `BaseAgent`
2. Implement `async def run(self, ctx: PipelineContext) -> PipelineContext`
3. Register in `src/pipeline/router.py` routing table
4. Add unit tests in `tests/agents/test_my_agent.py`
5. Document in `docs/agents/my-agent.md`
