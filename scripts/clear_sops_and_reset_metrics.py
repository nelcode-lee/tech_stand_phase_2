"""
Clear all ingested SOP / work-instruction documents, finding notes, user-note vectors,
and reset dashboard metrics (delete all analysis_sessions).

Keeps policy and principle documents (e.g. BRCGS, Cranswick MS).

Run from project root: python scripts/clear_sops_and_reset_metrics.py
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


def main() -> None:
    from src.rag.analysis_sessions import delete_all_sessions
    from src.rag.document_registry import delete_vector_chunks_document_id_like, purge_documents_by_doc_layers
    from src.rag.finding_notes import USER_NOTES_DOC_PREFIX, delete_all_finding_notes

    n_sess = delete_all_sessions()
    print(f"Deleted {n_sess} analysis session(s) (dashboard metrics / Attention Required).")

    n_notes = delete_all_finding_notes()
    print(f"Deleted {n_notes} finding note row(s).")

    n_vec = delete_vector_chunks_document_id_like(f"{USER_NOTES_DOC_PREFIX}%")
    print(f"Deleted {n_vec} user-note vector chunk(s).")

    purge = purge_documents_by_doc_layers()
    print(f"Removed {purge['removed_count']} procedure document(s) (sop / work_instruction):")
    for doc_id in purge["removed_ids"]:
        print(f"  - {doc_id}")
    print("Done. Policy / principle library documents were not removed.")


if __name__ == "__main__":
    main()
