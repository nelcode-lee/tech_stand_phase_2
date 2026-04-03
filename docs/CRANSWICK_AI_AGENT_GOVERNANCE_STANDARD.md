# Cranswick AI Agent Governance Standard

**Version:** 1.0  
**Status:** Reference standard for pipeline agent design and review

---

## Purpose

This standard defines how AI agents are designed, governed, reviewed, and maintained to ensure clarity of responsibility, non-overlap, auditability, and trust in regulated operational environments.

---

## 1. Agent design principles (mandatory)

### Single responsibility

Each agent must own **one analytical dimension only** (e.g. sequencing, risk, conflict). An agent must **explicitly defer** all adjacent concerns to **named** agents.

### No tacit knowledge

Agents must not apply assumed organisational, industry, or experiential knowledge unless it is:

1. **Explicitly present** in the document under review, or  
2. **Injected at runtime** as a governed reference block (versioned, scoped).

### Evidence-first operation

Every finding must declare:

- **What evidence** it relies on  
- **Where** that evidence appears  
- **Why** it constitutes a failure  

### No corrective invention

Agents must **never** invent missing steps, thresholds, or controls. If correctness cannot be determined, the agent must **escalate to HITL** (Human-in-the-Loop).

---

## 2. Evidence hierarchy (enforced)

Agents must apply evidence in the following **order of precedence**:

1. **Document-internal explicit logic**  
2. **Injected reference sequences or rules** (governed, versioned)  
3. **Explicitly cited governing standards** (only when mandatory and structurally cited)

If a conflict exists, **higher-precedence evidence governs**.

---

## 3. Scope ownership (non-negotiable)

| Agent | Owns | Explicitly does not own |
|--------|------|-------------------------|
| **Cleanser** | Text normalisation | Meaning, correctness |
| **Sequencer** | Step order & flow | Missing steps, compliance |
| **Risk Assessor** | Missing info, assumptions | Step order |
| **Conflict** | Contradictions | Risk severity |
| **Formatter** | Layout & presentation | Content adequacy |
| **Terminology** | Term consistency | Procedural logic |
| **Validator** | Compliance vs standards | Document clarity |

**Additional agents in this codebase** (e.g. **Specifier**, **Draft layout**) must be mapped into this table in the same way: one primary dimension, explicit deferrals.

**Scope leakage is a governance defect, not an optimisation.**

---

## 4. HITL escalation rule (mandatory)

An agent must escalate to HITL when:

- The correct action **cannot be determined from evidence**  
- **Safety, legality, or compliance** is affected  
- **Two plausible interpretations** exist  

When HITL is triggered:

- `recommendation` = **null** (or equivalent)  
- **Reason for escalation** must be explicit and bounded  

---

## 5. Reference material governance

All injected reference material (e.g. sequences, safety categories) must:

- Be **versioned**
- Declare **applicable document types**
- State whether deviations represent **failure**, **risk**, or **acceptable variance**

**Ungoverned** references must be treated as **advisory only**.

---

## 6. Change control

Any change to:

- Evidence rules  
- HITL logic  
- **Output schema**  

requires **cross-agent review** before release.

---

## Implementation in this repository

- **Canonical text:** this file (`docs/CRANSWICK_AI_AGENT_GOVERNANCE_STANDARD.md`).  
- **Runtime preamble:** optional short block for system prompts — `src/pipeline/governance_standard.py` (`AGENT_GOVERNANCE_PREAMBLE`).  
- **Agent-specific rules:** `src/pipeline/agent_rules.py` and per-agent prompts in `src/pipeline/agents/`.

---

*End of standard v1.0*
