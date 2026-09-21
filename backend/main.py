"""CHAINTRACE FastAPI reference backend.

The WebDev host runs the production request adapter in server/investigation.ts so the
managed runtime stays single-process. This file exposes the same contract for local
Python development and deployment into a Python-capable environment.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "chaintrace.sqlite"
app = FastAPI(title="CHAINTRACE API", version="0.9.4")


class InvestigationRequest(BaseModel):
    query: str = Field(min_length=3, max_length=240)


def connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE IF NOT EXISTS evidence (
            id TEXT PRIMARY KEY, query_hash TEXT NOT NULL, title TEXT NOT NULL,
            source TEXT NOT NULL, source_type TEXT NOT NULL, date TEXT NOT NULL,
            snippet TEXT NOT NULL, url TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    conn.commit()
    return conn


def query_hash(query: str) -> str:
    return hashlib.sha1(query.lower().strip().encode()).hexdigest()


def compact(value: str, limit: int = 240) -> str:
    value = " ".join(value.split())
    return value if len(value) <= limit else value[: limit - 1] + "…"


async def serp_search(query: str, engine: str) -> list[dict[str, Any]]:
    key = os.getenv("SERPAPI_API_KEY")
    if not key:
        raise HTTPException(503, "SERPAPI_API_KEY is not configured")
    params = {"engine": engine, "q": query, "api_key": key, "num": 6, "hl": "en"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get("https://serpapi.com/search.json", params=params)
        response.raise_for_status()
        payload = response.json()
    return payload.get("news_results" if engine == "google_news" else "organic_results", [])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "chaintrace-api"}


@app.post("/api/investigate")
async def investigate(request: InvestigationRequest) -> dict[str, Any]:
    query = request.query.strip()
    search_results, news_results = await serp_search(query, "google"), await serp_search(query, "google_news")
    seen: set[str] = set()
    records: list[dict[str, Any]] = []
    with connection() as conn:
        for result in [*search_results, *news_results]:
            url = (result.get("link") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            record = {
                "id": "ev-" + hashlib.md5(url.encode()).hexdigest()[:10],
                "title": compact(result.get("title", "Untitled source"), 110),
                "source": result.get("source", "web source"),
                "sourceType": result.get("source_type", "NEWS" if result.get("date") else "SEARCH"),
                "date": result.get("date") or datetime.now(timezone.utc).date().isoformat(),
                "snippet": compact(result.get("snippet", "No snippet returned by source.")),
                "status": "VERIFIED",
                "url": url,
            }
            conn.execute(
                "INSERT OR IGNORE INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (record["id"], query_hash(query), record["title"], record["source"], record["sourceType"], record["date"], record["snippet"], record["url"], record["status"], datetime.now(timezone.utc).isoformat()),
            )
            records.append(record)
    if not records:
        raise HTTPException(404, "No relevant sources were returned for this trace.")
    return {
        "query": query,
        "mode": "live",
        "evidence": records[:10],
        "metrics": {"entities": 1, "relationships": 0, "sources": len(records[:10]), "conflicts": 0},
        "notice": "Relationship extraction is intentionally kept compact; add OpenRouter extraction to enrich graph links.",
    }
