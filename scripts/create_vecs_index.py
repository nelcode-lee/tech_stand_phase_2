"""Create the vecs vector index on the document_chunks collection. Run after bulk ingest for faster similarity search."""
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.rag.vector_store import create_index


def main():
    print("Creating vector index (this may take a minute for large collections)...")
    try:
        create_index()
        print("Index created successfully.")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
