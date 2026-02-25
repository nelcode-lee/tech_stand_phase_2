"""LLM client for pipeline agents. Uses OpenAI GPT-4o (or Azure via env)."""
import asyncio
import json
import os

from openai import OpenAI

LLM_MODEL = os.environ.get("OPENAI_LLM_MODEL", "gpt-4o")


def _completion_sync(prompt: str, system: str | None, client: OpenAI) -> str:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=messages,
        temperature=0.2,
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
) -> str:
    """Call LLM and return the assistant message content."""
    client = client or get_llm_client()
    return await asyncio.to_thread(_completion_sync, prompt, system, client)


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
