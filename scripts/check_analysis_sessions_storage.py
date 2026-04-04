"""Read-only: report whether analysis_sessions rows have result_json populated."""
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

import psycopg2
from psycopg2.extras import RealDictCursor


def main() -> int:
    url = (os.environ.get("SUPABASE_DB_URL") or "").strip()
    if not url:
        print("SUPABASE_DB_URL not set in .env", file=sys.stderr)
        return 1
    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(
        """
        SELECT
          COUNT(*)::int AS total_rows,
          COUNT(*) FILTER (WHERE result_json IS NOT NULL)::int AS with_result_json,
          COUNT(*) FILTER (WHERE result_json IS NULL)::int AS without_result_json
        FROM public.analysis_sessions
        """
    )
    summary = cur.fetchone()
    print("analysis_sessions summary:")
    print(f"  total rows:           {summary['total_rows']}")
    print(f"  with result_json:     {summary['with_result_json']}")
    print(f"  without result_json:  {summary['without_result_json']}")
    cur.execute(
        """
        SELECT
          tracking_id,
          document_id,
          title,
          completed_at,
          (result_json IS NOT NULL) AS has_full_result,
          COALESCE(pg_column_size(result_json), 0) AS result_bytes
        FROM public.analysis_sessions
        ORDER BY completed_at DESC NULLS LAST
        LIMIT 15
        """
    )
    rows = cur.fetchall()
    print()
    print("Latest 15 sessions:")
    for r in rows:
        tid = (r["tracking_id"] or "")[:40]
        did = str(r["document_id"] or "")[:40]
        print(
            f"  tracking_id={tid}...  has_result={r['has_full_result']}  "
            f"bytes={r['result_bytes']}  document_id={did}"
        )
    cur.close()
    conn.close()
    print()
    print("Read-only check complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
