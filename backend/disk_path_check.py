from __future__ import annotations

import os
from pathlib import Path

import main

path = Path(os.environ.get("SQLITE_PATH", "/var/data/chaintrace.sqlite"))
main.DB_PATH = path
main.store_investigation("render disk smoke", {"mode": "live", "cache": "MISS"})
assert main.cached_investigation("render disk smoke") == {"mode": "live", "cache": "MISS"}
assert path.exists()
print(f"SQLite disk path read/write passed: {path}")
