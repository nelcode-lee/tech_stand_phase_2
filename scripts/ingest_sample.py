"""Ingest a sample document into the vector store. For local testing."""
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.rag.models import IngestDocumentRequest, IngestDocumentMetadata, DocLayer
from src.rag.ingest import ingest_document


def main():
    sample_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        "sample_docs",
        "sample_sop.txt",
    )
    if not os.path.exists(sample_path):
        print(f"Sample file not found: {sample_path}")
        sys.exit(1)

    with open(sample_path, encoding="utf-8") as f:
        content = f.read()

    req = IngestDocumentRequest(
        content=content,
        metadata=IngestDocumentMetadata(
            doc_layer=DocLayer.sop,
            sites=["site_north"],
            policy_ref="P-001",
            document_id="sample-sop-001",
            source_path="/sample_docs/sample_sop.txt",
            title="SOP-001 Hand Washing Procedure",
            library="SOPs",
        ),
    )

    print("Ingesting sample document...")
    chunks_ingested, err = ingest_document(req)
    if err:
        print(f"FAIL: {err}")
        sys.exit(1)
    print(f"OK: Ingested {chunks_ingested} chunks. Document ID: sample-sop-001")


if __name__ == "__main__":
    main()
