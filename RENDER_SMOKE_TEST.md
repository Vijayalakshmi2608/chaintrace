# CHAINTRACE Render Deployment and Smoke Test

## Render configuration

Use the repository `render.yaml` Blueprint. It defines the existing Vite/React static frontend and the FastAPI web service; it does not add a database service. The FastAPI service mounts a Render Persistent Disk at `/var/data` and sets:

```text
SQLITE_PATH=/var/data/chaintrace.sqlite
OPENROUTER_MODEL=openrouter/free
```

Set these values in Render environment variables or through the Blueprint:

```text
SERPAPI_API_KEY=<server-only secret>
OPENROUTER_API_KEY=<server-only secret>
SQLITE_PATH=/var/data/chaintrace.sqlite
OPENROUTER_MODEL=openrouter/free
CORS_ORIGINS=https://<deployed-frontend-origin>
```

The frontend build receives `VITE_API_BASE_URL` from the FastAPI service URL. The browser never receives `SERPAPI_API_KEY` or `OPENROUTER_API_KEY`. If the frontend is deployed manually rather than through the Blueprint, set `VITE_API_BASE_URL` to the deployed FastAPI origin before running the Vite build.

## Production smoke test

After both Render services are healthy, set shell variables to the deployed URLs:

```bash
export FRONTEND_URL="https://<frontend>.onrender.com"
export API_URL="https://<api>.onrender.com"
export QUERY="Nvidia Blackwell HBM supplier dependencies"
```

1. Open `$FRONTEND_URL`, submit `$QUERY`, and confirm the result is marked live rather than preview. The graph, evidence ledger, sources view, exposure view, and report should render from the same response.
2. Submit the same query directly to FastAPI and save the first response:

   ```bash
   curl -fsS -X POST "$API_URL/api/investigate" \
     -H 'content-type: application/json' \
     --data "{\"query\":\"$QUERY\"}" > /tmp/chaintrace-first.json
   ```

   Confirm `.cache` is `"MISS"`, `.mode` is `"live"`, `.serpApiRouted` lists the context-selected verticals, `.serpApiSources` lists only verticals that returned normalized evidence, `.evidence` contains source URLs and source types, `.edges` contains evidence IDs, and `.report` is present. A `MISS` means the selected SerpApi stages and the single compact OpenRouter extraction stage were eligible to run.
3. Submit the identical query again:

   ```bash
   curl -fsS -X POST "$API_URL/api/investigate" \
     -H 'content-type: application/json' \
     --data "{\"query\":\"$QUERY\"}" > /tmp/chaintrace-second.json
   ```

   Confirm `.cache` is `"HIT"`.
4. Confirm the evidence, relationships, edges, nodes, metrics, timeline, exposure, and report are identical between the two responses apart from the cache field:

   ```bash
   python3 - <<'PY'
   import json
   first = json.load(open('/tmp/chaintrace-first.json'))
   second = json.load(open('/tmp/chaintrace-second.json'))
   for key in ('nodes', 'edges', 'evidence', 'relationships', 'metrics', 'timeline', 'exposure', 'report'):
       assert first[key] == second[key], key
   assert first['cache'] == 'MISS'
   assert second['cache'] == 'HIT'
   print('CHAINTRACE response parity and cache smoke test passed')
   PY
   ```

5. In the FastAPI Render logs, confirm the first request contains `cache MISS`, the routed SerpApi vertical list, `openrouter extraction model=openrouter/free`, and `cache STORED`. If a selected vertical fails, the response should still contain successful evidence and list the failed vertical in `serpApiFailures`. Confirm the repeated request contains only `cache HIT` for the same `query_hash`; it must not log another SerpApi or OpenRouter stage.
6. Confirm the Render Persistent Disk contains `/var/data/chaintrace.sqlite` after the first request and that a service restart still returns `cache HIT` for the identical query.

## Expected failure behavior

A missing `SERPAPI_API_KEY` returns HTTP 503. SerpApi upstream errors return HTTP 502. Empty or URL-less results return HTTP 404. OpenRouter errors or malformed JSON return live evidence with zero asserted relationships and an explanatory `notice`; they do not create unsupported graph links. CORS must reject browser requests whose `Origin` is not included in `CORS_ORIGINS`.
