# Agent: Risk

**Position in pipeline:** 4  
**File:** `src/pipeline/agents/risk_agent.py`  
**Runs when:** Conflict agent returns one or more conflicts

---

## Purpose

Scores unresolved conflicts by operational consequence. The Conflict agent identifies *what* is wrong. The Risk agent answers *how much does it matter* and *what happens if we don't fix it*. This score drives the HITL card's urgency display and escalation routing in Workato.

---

## What It Does

**Scores each conflict by:**
- Regulatory exposure — does the conflict touch a legally mandated requirement?
- Safety consequence — could following the wrong document cause harm?
- Operational scope — how many sites and how many people are affected?
- Detectability — would this conflict be caught before it caused a problem?
- Time sensitivity — is there an active audit, inspection, or deadline?

**Produces:**
- Per-conflict risk score
- Overall pipeline risk score (used by Workato for routing)
- Prioritised remediation order

---

## Scoring Model

Uses a simplified FMEA-style (Failure Mode and Effects Analysis) approach:

```
Risk Score = Severity × Scope × (1 / Detectability)
```

| Dimension | Scale | Notes |
|-----------|-------|-------|
| Severity | 1–5 | 5 = regulatory/safety, 1 = admin inconvenience |
| Scope | 1–5 | 5 = all sites affected, 1 = single site, single team |
| Detectability | 1–5 | 5 = very unlikely to catch before impact, 1 = caught immediately |

**Overall risk bands:**
| Score | Band | Workato action |
|-------|------|---------------|
| 20–25 | `critical` | Auto-escalate to Standards Manager, block draft |
| 12–19 | `high` | Flag prominently in HITL card, require SME sign-off |
| 6–11 | `medium` | Surface in HITL card as amber warning |
| 1–5 | `low` | Log in report, note in draft |

---

## Domain Context for Scoring

The agent should be prompted with domain context to score accurately:

- **Food safety / HACCP** requirements → Severity always ≥ 4
- **Environmental health** requirements → Severity always ≥ 3
- **Allergen controls** → Severity = 5 (regulatory + safety)
- **Operational efficiency** only → Severity ≤ 2
- **Labelling / documentation** → Severity 2–3 depending on regulatory applicability

This domain context should be maintained as a config file (`src/pipeline/domain_context.json`) and injected into the prompt, not hardcoded.

---

## Inputs Used from PipelineContext

```python
ctx.conflicts               # list[Conflict] from conflict agent
ctx.doc_layer               # layer context
ctx.sites                   # scope context
ctx.parent_policy           # regulatory references in policy elevate severity
```

---

## Outputs Written to PipelineContext

```python
ctx.risk_scores             # list[RiskScore]
ctx.overall_risk            # RiskLevel enum: low | medium | high | critical
```

**RiskScore schema:**
```python
class RiskScore(BaseModel):
    conflict_ref: str       # links to Conflict.document_refs
    severity: int           # 1–5
    scope: int              # 1–5
    detectability: int      # 1–5
    score: int              # computed
    band: str               # low | medium | high | critical
    rationale: str          # plain English: why this score
    remediation_priority: int   # 1 = fix first
```

---

## LLM Prompt

```
You are a risk analyst for a multi-site retail food operation. You will be 
given a list of document conflicts identified by a compliance analysis.

For each conflict, score it using this FMEA-style model:
- Severity (1–5): How serious are the consequences if this conflict causes 
  an incorrect action? 5 = regulatory breach or safety incident.
- Scope (1–5): How many sites and people are affected? 5 = all sites.
- Detectability (1–5): How likely is this to be caught before it causes 
  real harm? 5 = very unlikely to be caught.

Domain context (use to calibrate severity):
{domain_context}

Conflicts to score:
{conflicts}

Return a JSON array of RiskScore objects. Include a plain English rationale 
for each score. Order by remediation_priority (1 = most urgent).
```

---

## Error Conditions

| Condition | Behaviour |
|-----------|-----------|
| No conflicts passed in | Return empty scores, `overall_risk: low` |
| LLM returns scores outside 1–5 range | Clamp to range, append warning |
| Domain context file missing | Append warning, continue with generic prompt |

---

## Test Cases

```python
def test_food_safety_conflict_scores_high():
def test_admin_conflict_scores_low():
def test_overall_risk_is_max_of_individual():
def test_remediation_priority_ordering():
def test_empty_conflicts_returns_low_risk():
```
