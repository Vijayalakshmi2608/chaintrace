from __future__ import annotations

import asyncio
import os

import httpx

os.environ["CORS_ORIGINS"] = "https://frontend.example.onrender.com"
import main  # noqa: E402


async def run() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        allowed = await client.get("/health", headers={"Origin": "https://frontend.example.onrender.com"})
        forbidden = await client.get("/health", headers={"Origin": "https://other.example.com"})
    assert allowed.headers.get("access-control-allow-origin") == "https://frontend.example.onrender.com"
    assert "access-control-allow-origin" not in forbidden.headers
    print("CORS allowlist verification passed")


if __name__ == "__main__":
    asyncio.run(run())
