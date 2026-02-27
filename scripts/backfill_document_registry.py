"""
Backfill the document registry from the vector store.
Run once to populate the registry with documents ingested before the registry existed.
Uses raw SQL against vecs.document_chunks for full coverage (no semantic query limit).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from src.rag.document_registry import ensure_table, fetch_all_from_vector_store, upsert_document


def main():
    ensure_table()
    print("Document registry table ready.")

    docs = fetch_all_from_vector_store()
    if not docs:
        print("No documents found in vector store. Check SUPABASE_DB_URL and vecs.document_chunks table.")
        return

    for d in docs:
        upsert_document(
            document_id=d["document_id"],
            title=d["title"],
            doc_layer=d["doc_layer"],
            sites=d["sites"],
            library=d["library"],
            chunk_count=d["chunk_count"],
            policy_ref=d.get("policy_ref"),
            source_path=d.get("source_path"),
        )
        print(f"  Registered: {d['document_id']} ({d['chunk_count']} chunks)")

    print(f"\nBackfilled {len(docs)} documents into the registry.")


if __name__ == "__main__":
    main()
