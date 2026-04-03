# Agent prompt exports (Word)

This folder contains **`.docx` files** with the LLM **system prompts** extracted from `src/pipeline/agents/`.

## Regenerate

From the repository root:

```bash
python scripts/export_agent_prompts_to_docx.py
```

Requires `python-docx` (listed in `pyproject.toml`).

## Notes

- **Risk agent:** includes two sections — the base `_SYSTEM_PROMPT_TEMPLATE` and the **full** runtime string (template plus shared rules from `src/pipeline/agent_rules.py`).
- **Draft layout:** includes a short note about **runtime-appended** section names from `domain_context.json`.
- **Glossary:** several agents append `ctx.glossary_block` at runtime; that block is **not** included in these exports (it is document-run-specific).
