# CHAINTRACE

**Discover what the world is connected to.** CHAINTRACE reconstructs real-world dependency chains from a reported event, company, technology, component, supplier, product, or disruption.

## What is implemented

The application has a premium dark intelligence-console UI, a landing intake flow, staged investigation animation, interactive React Flow dependency graph, exposure detector, trace timeline, source ledger, evidence panel, and concise trace report. The preview path is clearly marked as illustrative; live results only appear after the server successfully retrieves current evidence.

The intended production request path is:

```text
query → frontend → FastAPI `/api/investigate` → SerpApi search + news → dedupe + SQLite cache → compact OpenRouter/free extraction → graph + evidence ledger
```

`backend/main.py` is the production investigation service. The WebDev host retains a Node fallback for local preview compatibility, but when `FASTAPI_API_URL` is configured the Node endpoint proxies to FastAPI and the browser can call FastAPI directly through `VITE_API_BASE_URL`.

The current WebDev scaffold is a Vite + React frontend, not Next.js. It is therefore **not accurate to claim that this repository is already a Next.js + FastAPI Render deployment** without a separate frontend replatforming pass.

## Configuration

Server-only secrets are configured through the WebDev project secret manager. The expected variables are:

```text
SERPAPI_API_KEY=...
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/free
VITE_API_BASE_URL=https://your-fastapi-service.onrender.com
FASTAPI_API_URL=https://your-fastapi-service.onrender.com
CORS_ORIGINS=https://your-frontend-service.onrender.com
SQLITE_PATH=/var/data/chaintrace.sqlite
```

The keys are never referenced by the frontend bundle. For local development, add those variables to a local `.env` file; do not commit it.

## Run locally

```bash
pnpm install
pnpm dev
```

Open the preview URL printed by the WebDev server. Without `SERPAPI_API_KEY`, the app still supports the interactive preview, while live tracing returns a clear configuration state rather than inventing evidence.

For the FastAPI service:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

On Render, attach a Persistent Disk to the FastAPI service and set `SQLITE_PATH` to a file on that disk. Set `CORS_ORIGINS` to the exact frontend origin and keep `SERPAPI_API_KEY`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL=openrouter/free` as server environment variables only.

## Validation

```bash
pnpm check
pnpm test
pnpm build
```

The credential smoke test validates that the configured SerpApi and OpenRouter keys can reach their lightweight API endpoints. The FastAPI verification suite covers cache hits, empty results, SerpApi failures, OpenRouter failures, malformed JSON, duplicate evidence, missing source URLs, evidence-ID validation, and the complete live query path. The UI also handles missing credentials without presenting unsupported links as verified evidence.

## Product principles

- **Evidence before inference:** every relationship carries a source, date, and confidence state.
- **No unsupported prediction:** exposure is limited to entities directly supported by the current evidence set.
- **Cross-domain retrieval:** search and news surfaces are deduplicated before relationship extraction.
- **Entity resolution:** names are normalized before graph construction so aliases do not create duplicate nodes.
- **Small AI calls:** OpenRouter receives only title, URL, source type, date, and short snippets and must return strict JSON.
