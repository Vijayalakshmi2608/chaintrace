from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "chaintrace.sqlite"


def main() -> None:
    payload = json.loads(sys.argv[1])
    query = str(payload["query"])
    records = payload.get("records", [])
    query_hash = hashlib.sha1(query.lower().strip().encode()).hexdigest()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS evidence (
                id TEXT PRIMARY KEY, query_hash TEXT NOT NULL, title TEXT NOT NULL,
                source TEXT NOT NULL, source_type TEXT NOT NULL, date TEXT NOT NULL,
                snippet TEXT NOT NULL, url TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )
        for item in records:
            conn.execute(
                "INSERT OR IGNORE INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (item["id"], query_hash, item["title"], item["source"], item["sourceType"], item["date"], item["snippet"], item["url"], item["status"], datetime.now(timezone.utc).isoformat()),
            )
        conn.commit()
    print(json.dumps({"stored": len(records), "db": str(DB_PATH)}))


if __name__ == "__main__":
    main()
