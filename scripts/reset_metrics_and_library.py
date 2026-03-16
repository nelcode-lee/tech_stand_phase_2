"""
Reset dashboard metrics (clear all analysis sessions / Attention Required) and remove all
library documents except:
  - local-Cranswick Manufacturing Standard v2
  - BRCGS - Food Safety Standard - V9

Run from project root: python scripts/reset_metrics_and_library.py
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

from src.rag.document_registry import list_documents, fetch_all_from_vector_store, delete_document
from src.rag.vector_store import delete_by_document_id
from src.rag.analysis_sessions import delete_all_sessions

# Exact titles to KEEP (all other docs are removed)
KEEP_TITLES = {
    "local-Cranswick Manufacturing Standard v2",
    "BRCGS - Food Safety Standard - V9",
}


def main():
    # 1. Reset metrics: delete all analysis sessions (clears Attention Required and all dashboard metrics)
    try:
        n = delete_all_sessions()
        print(f"Reset metrics: deleted {n} analysis session(s).")
    except Exception as e:
        print(f"Error resetting metrics: {e}")
        return

    # 2. Library: list docs, keep only the two named, delete the rest
    docs = list_documents()
    if not docs:
        docs = fetch_all_from_vector_store()

    if not docs:
        print("No documents found in registry or vector store.")
        print("Kept: " + ", ".join(sorted(KEEP_TITLES)))
        return

    to_keep = [d for d in docs if (d.get("title") or "").strip() in KEEP_TITLES]
    to_remove = [d for d in docs if (d.get("title") or "").strip() not in KEEP_TITLES]

    print(f"\nLibrary: keeping {len(to_keep)} document(s) by title:")
    for d in to_keep:
        print(f"  - {d.get('title')} ({d.get('document_id')})")

    if not to_remove:
        print("\nNo other documents to remove.")
        return

    print(f"\nRemoving {len(to_remove)} document(s):")
    for d in to_remove:
        doc_id = d.get("document_id", "")
        title = (d.get("title") or doc_id).strip()
        if not doc_id:
            continue
        try:
            delete_by_document_id(doc_id)
            delete_document(doc_id)
            print(f"  Deleted: {doc_id} — {title}")
        except Exception as e:
            print(f"  Error deleting {doc_id}: {e}")

    print("\nDone. Metrics reset; library contains only the two kept documents.")
    print("If the Library UI still shows old docs, refresh the page or clear session log in Settings.")


if __name__ == "__main__":
    main()
