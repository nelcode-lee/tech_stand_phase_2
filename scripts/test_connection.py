"""Test Supabase and OpenAI connections for RAG ingestion."""
import os
import sys

# Load .env from project root
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_supabase():
    """Test Supabase (vecs) connection."""
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        print("SKIP: SUPABASE_DB_URL not set (copy .env.example to .env and add your connection string)")
        return False
    try:
        from src.rag.vector_store import get_client, get_collection
        client = get_client()
        coll = get_collection(client)
        print("OK: Supabase connection successful (collection: document_chunks)")
        return True
    except Exception as e:
        print(f"FAIL: Supabase connection failed: {e}")
        return False


def test_openai():
    """Test OpenAI API key (no API call)."""
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        print("SKIP: OPENAI_API_KEY not set")
        return False
    print("OK: OPENAI_API_KEY is set")
    return True


if __name__ == "__main__":
    print("Testing connections...")
    print()
    s = test_supabase()
    o = test_openai()
    print()
    if s and o:
        print("All connections OK.")
    else:
        print("Some checks skipped or failed. Set variables in .env and run again.")
        sys.exit(1)
