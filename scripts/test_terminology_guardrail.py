"""Test terminology guardrail directly (no server)."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from src.rag.retriever import retrieve
from src.pipeline.models import PipelineContext, RequestType, DocLayer
from src.pipeline.router import PipelineRouter


async def main():
    chunks = retrieve(doc_layer="sop", query_text="packaging labelling", limit=20)
    content = "\n\n".join(c.text for c in chunks)
    print(f"Retrieved {len(chunks)} chunks, {len(content)} chars")
    print(f"'Julian' in content: {'Julian' in content}")
    print(f"'Julian code' in content: {'Julian code' in content}")
    print(f"'batch code' in content: {'batch code' in content}")
    print(f"'fail-safe' in content: {'fail-safe' in content}")

    ctx = PipelineContext(
        tracking_id="guardrail-test",
        request_type=RequestType.new_document,
        doc_layer=DocLayer.sop,
        sites=["site_north"],
        policy_ref="P-001",
        retrieved_chunks=chunks,
    )
    router = PipelineRouter()
    ctx = await router.run(ctx)

    print(f"\nTerminology flags: {len(ctx.terminology_flags)}")
    for t in ctx.terminology_flags:
        print(f"  - {t.term}")


if __name__ == "__main__":
    asyncio.run(main())
