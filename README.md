# CHAINTRACE

**Discover what the world is connected to.** CHAINTRACE reconstructs real-world dependency chains from a reported event, company, technology, component, supplier, product, or disruption.

## What is implemented

The application has a premium dark intelligence-console UI, a landing intake flow, staged investigation animation, interactive React Flow dependency graph, exposure detector, trace timeline, source ledger, evidence panel, and concise trace report. The preview path is clearly marked as illustrative; live results only appear after the server successfully retrieves current evidence.

The request path is:

```text
query → server investigation route → SerpApi search + news → dedupe + SQLite cache → compact OpenRouter extraction → graph + evidence ledger
```

The WebDev host uses the Node server adapter in `server/investigation.ts` so it can run inside the managed single-process runtime. A matching FastAPI reference backend is included under `backend/` for Python-first local development and deployment.

## Configuration

Server-only secrets are configured through the WebDev project secret manager. The expected variables are:

```text
SERPAPI_API_KEY=...
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/free
```

The keys are never referenced by the frontend bundle. For local development, add those variables to a local `.env` file; do not commit it.

## Run locally

```bash
pnpm install
pnpm dev
```

Open the preview URL printed by the WebDev server. Without `SERPAPI_API_KEY`, the app still supports the interactive preview, while live tracing returns a clear configuration state rather than inventing evidence.

For the standalone Python backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

## Validation

```bash
pnpm check
pnpm test
pnpm build
```

The credential smoke test validates that the configured SerpApi and OpenRouter keys can reach their lightweight API endpoints. The UI also handles empty search results, missing credentials, and malformed extraction responses without presenting unsupported links as verified evidence.

## Product principles

- **Evidence before inference:** every relationship carries a source, date, and confidence state.
- **No unsupported prediction:** exposure is limited to entities directly supported by the current evidence set.
- **Cross-domain retrieval:** search and news surfaces are deduplicated before relationship extraction.
- **Entity resolution:** names are normalized before graph construction so aliases do not create duplicate nodes.
- **Small AI calls:** OpenRouter receives only title, URL, source type, date, and short snippets and must return strict JSON.
