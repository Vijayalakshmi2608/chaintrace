from __future__ import annotations

import asyncio
import hashlib
import tempfile
from pathlib import Path

import httpx

import main


async def run() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        main.DB_PATH = Path(temp_dir) / "chaintrace.sqlite"
        main.os.environ["SERPAPI_API_KEY"] = "test-serp"
        main.os.environ["OPENROUTER_API_KEY"] = "test-router"
        main.os.environ["OPENROUTER_MODEL"] = "openrouter/free"
        serp_calls = 0
        extraction_calls = 0

        async def fake_serp(_client: object, query: str, engine: str) -> list[dict[str, object]]:
            nonlocal serp_calls
            serp_calls += 1
            if query == "serp failure":
                raise main.HTTPException(502, "SerpApi request failed")
            if query == "empty result":
                return []
            return [
                {"title": "Anchor report", "link": "https://example.com/anchor", "snippet": "Anchor evidence", "source": "Example", "source_type": "SEARCH"},
                {"title": "Duplicate anchor", "link": "https://example.com/anchor", "snippet": "Duplicate evidence", "source": "Example", "source_type": "NEWS"},
                {"title": "Missing URL", "snippet": "Should be discarded", "source": "Example"},
            ]

        async def fake_extract(query: str, evidence: list[dict[str, object]]) -> tuple[list[dict[str, object]], str | None]:
            nonlocal extraction_calls
            extraction_calls += 1
            if query == "openrouter failure":
                return [], "OpenRouter returned an unavailable or malformed relationship response; no unsupported relationships were asserted."
            evidence_id = evidence[0]["id"]
            return ([{"subject": "Anchor", "object": "Supplier", "relationship_type": "supplied by", "evidence_ids": [evidence_id], "confidence": 0.91, "status": "VERIFIED"}], None)

        original_serp, original_extract = main.serp_search, main.extract_relationships
        main.serp_search, main.extract_relationships = fake_serp, fake_extract
        try:
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                first = await client.post("/api/investigate", json={"query": "normal query"})
                assert first.status_code == 200
                first_payload = first.json()
                assert first_payload["cache"] == "MISS"
                assert first_payload["metrics"]["sources"] == 1
                assert first_payload["metrics"]["relationships"] == 1
                assert first_payload["edges"][0]["data"]["evidence_ids"] == [first_payload["evidence"][0]["id"]]

                serp_before_cache = serp_calls
                extraction_before_cache = extraction_calls
                second = await client.post("/api/investigate", json={"query": "normal query"})
                assert second.status_code == 200 and second.json()["cache"] == "HIT"
                assert serp_calls == serp_before_cache and extraction_calls == extraction_before_cache

                empty = await client.post("/api/investigate", json={"query": "empty result"})
                assert empty.status_code == 404

                serp_failure = await client.post("/api/investigate", json={"query": "serp failure"})
                assert serp_failure.status_code == 502

                router_failure = await client.post("/api/investigate", json={"query": "openrouter failure"})
                assert router_failure.status_code == 200
                assert router_failure.json()["metrics"]["relationships"] == 0
                assert "malformed relationship response" in router_failure.json()["notice"]

            assert main.os.environ["OPENROUTER_MODEL"] == "openrouter/free"
            valid = main.normalize_evidence("dedupe", [{"link": "https://example.com/a"}, {"link": "https://example.com/a"}, {"title": "no url"}])
            assert len(valid) == 1

            class FakeResponse:
                def raise_for_status(self) -> None:
                    return None

                def json(self) -> dict[str, object]:
                    return {"choices": [{"message": {"content": "not valid json"}}]}

            class FakeAsyncClient:
                async def __aenter__(self) -> "FakeAsyncClient":
                    return self

                async def __aexit__(self, *_args: object) -> None:
                    return None

                async def post(self, *_args: object, **_kwargs: object) -> FakeResponse:
                    return FakeResponse()

            original_client = main.httpx.AsyncClient
            main.httpx.AsyncClient = FakeAsyncClient  # type: ignore[assignment]
            malformed_relationships, malformed_notice = await original_extract("malformed", valid)
            assert malformed_relationships == []
            assert "malformed relationship response" in (malformed_notice or "")
            main.httpx.AsyncClient = original_client
        finally:
            main.serp_search, main.extract_relationships = original_serp, original_extract


if __name__ == "__main__":
    asyncio.run(run())
    print("FastAPI production-flow verification passed")
