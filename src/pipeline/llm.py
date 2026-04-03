"""LLM client for pipeline agents. Uses OpenAI GPT-4o (or Azure via env)."""
import asyncio
import json
import os

from openai import OpenAI

LLM_MODEL = os.environ.get("OPENAI_LLM_MODEL", "gpt-4o")
DRAFT_LLM_MODEL = os.environ.get("OPENAI_DRAFT_LLM_MODEL", LLM_MODEL)


def default_llm_temperature() -> float:
    """Temperature for general pipeline completions (when not overridden per call)."""
    return float(os.environ.get("OPENAI_LLM_TEMPERATURE", "0.2"))


def compliance_llm_temperature() -> float:
    """Temperature for compliance flags, clause mapping, and finding verification (harmonisation path). Default 0 for repeatability."""
    return float(os.environ.get("OPENAI_COMPLIANCE_TEMPERATURE", "0"))


def _completion_sync(prompt: str, system: str | None, client: OpenAI, model: str, temperature: float) -> str:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
    )
    return response.choices[0].message.content or ""


def get_llm_client() -> OpenAI:
    api_base = os.environ.get("OPENAI_API_BASE")
    kwargs = {}
    if api_base:
        kwargs["base_url"] = api_base
    return OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""), **kwargs)


async def completion(
    prompt: str,
    system: str | None = None,
    client: OpenAI | None = None,
    model: str | None = None,
    temperature: float | None = None,
) -> str:
    """Call LLM and return the assistant message content."""
    client = client or get_llm_client()
    chosen_model = (model or LLM_MODEL).strip() or LLM_MODEL
    t = default_llm_temperature() if temperature is None else temperature
    return await asyncio.to_thread(_completion_sync, prompt, system, client, chosen_model, t)


async def completion_for_draft(
    prompt: str,
    system: str | None = None,
    client: OpenAI | None = None,
) -> str:
    """Call LLM using the draft-generation model."""
    return await completion(prompt, system=system, client=client, model=DRAFT_LLM_MODEL)


def parse_json_array(text: str, max_items: int | None = None) -> list[dict]:
    """Extract JSON array from LLM response. Handles markdown code blocks."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        start = 1 if lines[0].startswith("```") else 0
        end = len(lines)
        for i in range(start, len(lines)):
            if lines[i].strip() == "```":
                end = i
                break
        text = "\n".join(lines[start:end])
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            if max_items and len(parsed) > max_items:
                return parsed[:max_items]
            return parsed
        if isinstance(parsed, dict):
            return [parsed]
        return []
    except json.JSONDecodeError:
        return []


def parse_json_object(text: str) -> dict | None:
    """Extract JSON object from LLM response."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        start = 1 if lines[0].startswith("```") else 0
        end = len(lines)
        for i in range(start, len(lines)):
            if lines[i].strip() == "```":
                end = i
                break
        text = "\n".join(lines[start:end])
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None
