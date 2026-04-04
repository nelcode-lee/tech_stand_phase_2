"""Terminate other client sessions on the current database (e.g. stuck dev connections).

Requires SUPABASE_DB_URL in .env. Does not terminate this script's own connection until
it exits. Restart the FastAPI app afterward so it opens new connections.

Usage: python scripts/kill_other_db_sessions.py
"""
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

import psycopg2


def main() -> int:
    url = (os.environ.get("SUPABASE_DB_URL") or "").strip()
    if not url:
        print("SUPABASE_DB_URL not set in .env", file=sys.stderr)
        return 1
    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    # Only same-role sessions: Supabase denies terminating superuser/pooler backends.
    cur.execute(
        """
        SELECT pid, pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND backend_type = %s
          AND usename = current_user
        """,
        ("client backend",),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    n = sum(1 for r in rows if r[1])
    print(f"Disconnected {n} other client session(s).")
    print("Restart the API process if you want a clean reconnect.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
