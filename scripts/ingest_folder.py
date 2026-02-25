"""Ingest all DOCX, PDF, and TXT files from a folder. For local RAG/agent testing."""
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.rag.models import IngestDocumentRequest, IngestDocumentMetadata, DocLayer
from src.rag.ingest import ingest_document
from src.rag.file_extract import extract_text, supported_extensions
from src.rag.vector_store import create_index

SUPPORTED = {*supported_extensions(), "txt"}
DEFAULT_FOLDER = Path(__file__).resolve().parent.parent / "sample_docs"


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FOLDER
    if not folder.is_dir():
        print(f"Folder not found: {folder}")
        sys.exit(1)

    files = [
        f for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in (f".{e}" for e in SUPPORTED)
    ]
    if not files:
        print(f"No .docx, .pdf, or .txt files in {folder}")
        sys.exit(0)

    print(f"Ingesting {len(files)} file(s) from {folder}...")
    ok = 0
    for path in sorted(files):
        ext = path.suffix.lower()
        if ext == ".txt":
            content = path.read_text(encoding="utf-8", errors="replace")
        else:
            raw = path.read_bytes()
            content = extract_text(raw, path.name)
        if not content or not content.strip():
            print(f"  SKIP {path.name}: no text extracted")
            continue
        doc_id = f"local-{path.stem}"
        metadata = IngestDocumentMetadata(
            doc_layer=DocLayer.sop,
            sites=["site_north"],
            policy_ref="P-001",
            document_id=doc_id,
            source_path=str(path.name),
            title=path.stem,
            library="Local",
        )
        req = IngestDocumentRequest(content=content, metadata=metadata)
        n, err = ingest_document(req)
        if err:
            print(f"  FAIL {path.name}: {err}")
        else:
            print(f"  OK {path.name}: {n} chunks (id={doc_id})")
            ok += 1
    if ok > 0:
        print("Creating vector index (this may take a minute)...")
        try:
            create_index()
            print("Index created.")
        except Exception as e:
            print(f"Index creation failed (queries still work, but may be slower): {e}")
    print(f"\nDone: {ok}/{len(files)} ingested.")


if __name__ == "__main__":
    main()
