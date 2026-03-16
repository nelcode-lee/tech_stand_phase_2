"""
Remove all non-policy documents from the library (registry + vector store).
Policy documents are kept for use as reference when re-ingesting and testing.

Run from project root: python scripts/remove_non_policy_docs.py
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
from src.rag.analysis_sessions import delete_sessions_for_non_policy_docs


def main():
    # Get all documents: registry first, then vector store fallback
    docs = list_documents()
    if not docs:
        docs = fetch_all_from_vector_store()

    if not docs:
        print("No documents found in registry or vector store.")
        return

    policy_docs = [d for d in docs if (d.get("doc_layer") or "").lower() == "policy"]
    non_policy = [d for d in docs if (d.get("doc_layer") or "").lower() != "policy"]

    if not non_policy:
        print("No non-policy documents to remove from registry/vector store.")
        if policy_docs:
            print(f"  Kept {len(policy_docs)} policy doc(s): {[d['document_id'] for d in policy_docs]}")
    else:
        print(f"Keeping {len(policy_docs)} policy document(s): {[d['document_id'] for d in policy_docs] or 'none'}")
        print(f"Removing {len(non_policy)} non-policy document(s):\n")

        for d in non_policy:
            doc_id = d.get("document_id", "")
            if not doc_id:
                continue
            try:
                delete_by_document_id(doc_id)
                delete_document(doc_id)
                print(f"  Deleted: {doc_id} ({d.get('title') or doc_id})")
            except Exception as e:
                print(f"  Error deleting {doc_id}: {e}")

    # Always remove analysis sessions for non-policy docs (dashboard)
    deleted_sessions = delete_sessions_for_non_policy_docs()
    if deleted_sessions:
        print(f"\n  Removed {deleted_sessions} analysis session(s) from dashboard DB.")

    print("\nDone. Policy docs retained.")
    print("\nIf docs still appear in Library/Dashboard: clear browser localStorage key")
    print("  'tech-standards-session-log' (DevTools > Application > Local Storage),")
    print("  or use Settings > Clear session history.")


if __name__ == "__main__":
    main()
