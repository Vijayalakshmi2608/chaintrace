from __future__ import annotations

from pathlib import Path

import yaml

config = yaml.safe_load(Path("render.yaml").read_text())
services = {item["name"]: item for item in config["services"]}
assert set(services) == {"chaintrace-api", "chaintrace-frontend"}
api = services["chaintrace-api"]
frontend = services["chaintrace-frontend"]
assert api["runtime"] == "python"
assert api["disk"]["mountPath"] == "/var/data"
api_env = {item["key"]: item for item in api["envVars"]}
assert api_env["SQLITE_PATH"]["value"] == "/var/data/chaintrace.sqlite"
assert api_env["OPENROUTER_MODEL"]["value"] == "google/gemini-3.8-flash"
assert api_env["CORS_ORIGINS"]["fromService"]["name"] == "chaintrace-frontend"
assert frontend["runtime"] == "static"
assert frontend["envVars"][0]["key"] == "VITE_API_BASE_URL"
print("Render Blueprint validation passed")
