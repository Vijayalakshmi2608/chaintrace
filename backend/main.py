"""CHAINTRACE production investigation API.

This service is the source of truth for live investigations. It routes each query
to relevant SerpApi search, news, patents, jobs, and shopping verticals, retrieves
compact evidence, makes one small OpenRouter/free extraction call,
persists the complete result in SQLite, and returns only source-linked graph data.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logger = logging.getLogger("chaintrace")

VERTICAL_ENGINES = {
    "SEARCH": "google",
    "NEWS": "google_news",
    "PATENTS": "google_patents",
    "JOBS": "google_jobs",
    "SHOPPING": "google_shopping",
}
ENGINE_SOURCE_TYPES = {engine: source_type for source_type, engine in VERTICAL_ENGINES.items()}

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("SQLITE_PATH", ROOT / "chaintrace.sqlite"))
app = FastAPI(title="CHAINTRACE API", version="1.0.0")
cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])


class InvestigationRequest(BaseModel):
    query: str = Field(min_length=3, max_length=240)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def query_hash(query: str) -> str:
    return hashlib.sha1(query.lower().strip().encode()).hexdigest()


def investigation_id(query_hash_value: str) -> str:
    return f"CT-{query_hash_value[:10].upper()}"


def compact(value: Any, limit: int = 240) -> str:
    if isinstance(value, dict):
        value = value.get("name") or value.get("link") or "web source"
    value = " ".join(str(value or "").split())
    return value if len(value) <= limit else value[: limit - 1] + "…"


def route_verticals(query: str) -> list[str]:
    """Select only the SerpApi surfaces relevant to the query context."""
    normalized = query.lower()
    if any(term in normalized for term in ("hire", "hiring", "job", "jobs", "career", "engineer", "engineering", "facility")):
        return ["JOBS", "SEARCH", "NEWS"]
    if any(term in normalized for term in ("patent", "ip licensing", "intellectual property", "invention", "technology", "semiconductor", "chip architecture")):
        return ["SEARCH", "PATENTS", "NEWS"]
    if any(term in normalized for term in ("disruption", "disrupted", "shortage", "earthquake", "war", "sanction", "shipping", "outage", "crisis")):
        return ["NEWS", "SEARCH", "SHOPPING"]
    if any(term in normalized for term in ("product", "component", "parts", "device", "hardware", "consumer")):
        return ["SEARCH", "SHOPPING", "NEWS"]
    if any(term in normalized for term in ("company", "supplier", "supply chain", "manufacturer", "vendor", "partnership")):
        return ["SEARCH", "NEWS", "JOBS"]
    return ["SEARCH", "NEWS"]


def open_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS evidence (
            id TEXT PRIMARY KEY,
            query_hash TEXT NOT NULL,
            title TEXT NOT NULL,
            source TEXT NOT NULL,
            source_type TEXT NOT NULL,
            date TEXT NOT NULL,
            snippet TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS investigations (
            query_hash TEXT PRIMARY KEY,
            investigation_id TEXT,
            query TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(investigations)").fetchall()}
    if "investigation_id" not in columns:
        conn.execute("ALTER TABLE investigations ADD COLUMN investigation_id TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_investigations_id ON investigations(investigation_id)")
    conn.commit()
    return conn


def cached_investigation(query: str) -> dict[str, Any] | None:
    with open_db() as conn:
        row = conn.execute("SELECT payload, investigation_id FROM investigations WHERE query_hash = ?", (query_hash(query),)).fetchone()
        if not row:
            return None
        stable_id = row["investigation_id"] or investigation_id(query_hash(query))
        if not row["investigation_id"]:
            conn.execute("UPDATE investigations SET investigation_id = ? WHERE query_hash = ?", (stable_id, query_hash(query)))
            conn.commit()
    logger.info("cache HIT query_hash=%s", query_hash(query))
    payload = json.loads(row["payload"])
    payload["investigationId"] = stable_id
    return payload


def store_investigation(query: str, payload: dict[str, Any]) -> None:
    query_hash_value = query_hash(query)
    payload["investigationId"] = payload.get("investigationId") or investigation_id(query_hash_value)
    with open_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO investigations (query_hash, investigation_id, query, payload, created_at) VALUES (?, ?, ?, ?, ?)",
            (query_hash_value, payload["investigationId"], query, json.dumps(payload), now_iso()),
        )
        conn.commit()
    logger.info("cache STORED query_hash=%s investigation_id=%s", query_hash_value, payload["investigationId"])


def recent_investigations(limit: int = 8) -> list[dict[str, Any]]:
    with open_db() as conn:
        rows = conn.execute("SELECT investigation_id, query, created_at, payload FROM investigations WHERE investigation_id IS NOT NULL ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [{"investigationId": row["investigation_id"], "query": row["query"], "createdAt": row["created_at"], "metrics": json.loads(row["payload"]).get("metrics", {})} for row in rows]


def investigation_by_id(value: str) -> dict[str, Any] | None:
    with open_db() as conn:
        row = conn.execute("SELECT payload FROM investigations WHERE investigation_id = ?", (value.upper(),)).fetchone()
    return json.loads(row["payload"]) if row else None


async def serp_search(client: httpx.AsyncClient, query: str, engine: str) -> list[dict[str, Any]]:
    key = os.getenv("SERPAPI_API_KEY")
    if not key:
        raise HTTPException(503, "SERPAPI_API_KEY is not configured")
    params = {"engine": engine, "q": query, "api_key": key, "num": 6, "hl": "en"}
    try:
        response = await client.get("https://serpapi.com/search.json", params=params)
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"SerpApi request failed: {exc.__class__.__name__}") from exc
    result_key = {
        "google_news": "news_results",
        "google_patents": "organic_results",
        "google_jobs": "jobs_results",
        "google_shopping": "shopping_results",
    }.get(engine, "organic_results")
    return payload.get(result_key, [])


async def collect_vertical(client: httpx.AsyncClient, query: str, source_type: str) -> tuple[str, list[dict[str, Any]], str | None]:
    engine = VERTICAL_ENGINES[source_type]
    try:
        return source_type, await asyncio.wait_for(serp_search(client, query, engine), timeout=15), None
    except HTTPException as exc:
        logger.warning("SerpApi vertical failed source_type=%s status=%s", source_type, exc.status_code)
        return source_type, [], str(exc.detail)
    except Exception as exc:
        logger.warning("SerpApi vertical failed source_type=%s error=%s", source_type, exc.__class__.__name__)
        return source_type, [], f"{exc.__class__.__name__}"


def normalize_evidence(query: str, results: list[dict[str, Any]], source_type: str = "SEARCH") -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for result in results:
        url = compact(result.get("link"), 200).strip()
        if not url or not url.startswith(("http://", "https://")) or url in seen_urls:
            continue
        seen_urls.add(url)
        title = compact(result.get("title") or "Untitled source", 110)
        record = {
            "id": "ev-" + hashlib.md5(url.encode()).hexdigest()[:10],
            "evidence_id": "ev-" + hashlib.md5(url.encode()).hexdigest()[:10],
            "title": compact(result.get("title") or "Untitled source", 110),
            "source": compact(result.get("source") or "web source", 100),
            "sourceType": source_type,
            "source_type": source_type,
            "date": compact(result.get("date") or datetime.now(timezone.utc).date().isoformat(), 40),
            "snippet": compact(result.get("snippet") or "No snippet returned by source."),
            "status": "VERIFIED",
            "url": url,
            "query": query,
        }
        if not title:
            continue
        records.append(record)
    return records[:10]


def deduplicate_evidence(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    unique: list[dict[str, Any]] = []
    for record in records:
        url_key = record["url"].rstrip("/").lower()
        title_key = " ".join(record["title"].lower().split())
        if url_key in seen_urls or title_key in seen_titles:
            continue
        seen_urls.add(url_key)
        seen_titles.add(title_key)
        unique.append(record)
    return unique[:20]


async def extract_relationships(query: str, evidence: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    key = os.getenv("OPENROUTER_API_KEY")
    model = os.getenv("OPENROUTER_MODEL", "openrouter/free")
    if not key:
        return [], "OpenRouter extraction is not configured; evidence was collected but no relationships were asserted."
    compact_evidence = [
        {"id": item["id"], "title": item["title"], "url": item["url"], "source_type": item["sourceType"], "date": item["date"], "snippet": item["snippet"]}
        for item in evidence[:8]
    ]
    schema = {
        "type": "object",
        "properties": {
            "relationships": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "subject": {"type": "string"},
                        "object": {"type": "string"},
                        "relationship_type": {"type": "string"},
                        "evidence_ids": {"type": "array", "items": {"type": "string"}},
                        "confidence": {"type": "number"},
                        "status": {"type": "string", "enum": ["VERIFIED", "POSSIBLE", "CONFLICTING"]},
                        "description": {"type": "string"},
                    },
                    "required": ["subject", "object", "relationship_type", "evidence_ids", "confidence", "status"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["relationships"],
        "additionalProperties": False,
    }
    body = {
        "model": model,
        "max_tokens": 1200,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": "Use only the supplied evidence. Return strict JSON. Every relationship must cite one or more supplied evidence_ids. Use VERIFIED only for direct support, POSSIBLE for weaker but relevant support, and CONFLICTING only when supplied sources directly disagree. Never infer future impact."},
            {"role": "user", "content": json.dumps({"query": query, "evidence": compact_evidence})},
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": "chaintrace_relationships", "strict": True, "schema": schema}},
    }
    try:
        logger.info("openrouter extraction model=%s evidence_count=%s", model, len(compact_evidence))
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post("https://openrouter.ai/api/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "HTTP-Referer": "https://chaintrace.app", "X-Title": "CHAINTRACE"}, json=body)
        response.raise_for_status()
        raw = response.json().get("choices", [{}])[0].get("message", {}).get("content")
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        candidates = parsed.get("relationships", []) if isinstance(parsed, dict) else []
    except (httpx.HTTPError, json.JSONDecodeError, TypeError, AttributeError, IndexError, KeyError):
        return [], "OpenRouter returned an unavailable or malformed relationship response; no unsupported relationships were asserted."

    valid_ids = {item["id"] for item in evidence}
    clean: list[dict[str, Any]] = []
    for item in candidates if isinstance(candidates, list) else []:
        evidence_ids = [value for value in item.get("evidence_ids", []) if value in valid_ids]
        subject, obj = compact(item.get("subject"), 80), compact(item.get("object"), 80)
        if not subject or not obj or not evidence_ids:
            continue
        confidence = float(item.get("confidence", 0))
        status = item.get("status") if item.get("status") in {"VERIFIED", "POSSIBLE", "CONFLICTING"} else "POSSIBLE"
        if status == "VERIFIED" and confidence < 0.75:
            status = "POSSIBLE"
        clean.append({"subject": subject, "object": obj, "relationship_type": compact(item.get("relationship_type") or "connected to", 60), "evidence_ids": evidence_ids, "confidence": max(0, min(confidence, 1)), "status": status, "description": compact(item.get("description") or "Supported by the cited evidence.", 220)})
    return clean[:12], None


def _relationship_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def detect_conflicts(relationships: list[dict[str, Any]], evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flag only explicit competing exclusive supplier/manufacturing claims.

    Multiple suppliers are not a conflict by themselves. A conflict requires two
    distinct targets in the same subject/relationship group, with evidence that
    explicitly uses exclusive wording such as primary, sole, main, or exclusive.
    """
    by_id = {item["id"]: item for item in evidence}
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for relationship in relationships:
        relation_key = _relationship_key(relationship.get("relationship_type", ""))
        if not re.search(r"suppl|manufactur|primary source|sole source", relation_key):
            continue
        claim_text = " ".join(
            f"{by_id[item_id].get('title', '')} {by_id[item_id].get('snippet', '')}"
            for item_id in relationship.get("evidence_ids", [])
            if item_id in by_id
        ).lower()
        if not re.search(r"\b(primary|sole|main|exclusive|only)\b.{0,45}\b(supplier|source|manufacturer|provider)\b", claim_text):
            continue
        groups.setdefault((_relationship_key(relationship.get("subject", "")), relation_key), []).append(relationship)

    for candidates in groups.values():
        targets = {_relationship_key(item.get("object", "")) for item in candidates}
        if len(targets) < 2:
            continue
        for relationship in candidates:
            relationship["status"] = "CONFLICTING"
            relationship["conflict_group"] = f"{_relationship_key(relationship.get('subject', ''))}:{_relationship_key(relationship.get('relationship_type', ''))}"
            relationship["conflict_with"] = [item.get("object") for item in candidates if item is not relationship]
            relationship["description"] = "Competing exclusive claims were found in the cited evidence; review both sides before treating either as primary."
    return relationships


def build_graph(query: str, evidence: list[dict[str, Any]], relationships: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    root_id = "root-" + hashlib.md5(query.lower().encode()).hexdigest()[:10]
    nodes: dict[str, dict[str, Any]] = {root_id: {"id": root_id, "type": "trace", "position": {"x": 55, "y": 215}, "data": {"label": query[:42], "kind": "INVESTIGATION", "status": "VERIFIED", "evidence": len(evidence), "exposure": True}}}
    edges: list[dict[str, Any]] = []
    for index, relationship in enumerate(relationships):
        subject_id = root_id if relationship["subject"].lower() in query.lower() else "entity-" + hashlib.md5(relationship["subject"].lower().encode()).hexdigest()[:8]
        object_id = "entity-" + hashlib.md5(relationship["object"].lower().encode()).hexdigest()[:8]
        for entity_id, label in ((subject_id, relationship["subject"]), (object_id, relationship["object"])):
            if entity_id not in nodes:
                nodes[entity_id] = {"id": entity_id, "type": "trace", "position": {"x": 335 + (index % 2) * 300, "y": 90 + (index // 2) * 150}, "data": {"label": label, "kind": "ENTITY", "status": relationship["status"], "evidence": len(relationship["evidence_ids"]), "exposure": relationship["status"] == "VERIFIED"}}
        edges.append({"id": f"edge-{index}-{subject_id}-{object_id}", "source": subject_id, "target": object_id, "type": "smoothstep", "label": relationship["relationship_type"], "data": {"label": relationship["relationship_type"], "status": relationship["status"], "evidence_ids": relationship["evidence_ids"], "confidence": relationship["confidence"], "description": relationship.get("description"), "conflict_with": relationship.get("conflict_with", [])}, "animated": index == 0})
    return list(nodes.values()), edges


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "chaintrace-api", "model": os.getenv("OPENROUTER_MODEL", "")}


@app.get("/api/investigations")
def list_investigations() -> dict[str, Any]:
    return {"investigations": recent_investigations()}


@app.get("/api/investigations/{value}")
def get_investigation(value: str) -> dict[str, Any]:
    payload = investigation_by_id(value)
    if not payload:
        raise HTTPException(404, "Investigation not found")
    payload["cache"] = "HIT"
    return payload


class CompareRequest(BaseModel):
    firstId: str = Field(min_length=3, max_length=32)
    secondId: str = Field(min_length=3, max_length=32)


@app.post("/api/investigations/compare")
def compare_investigations(request: CompareRequest) -> dict[str, Any]:
    first = investigation_by_id(request.firstId)
    second = investigation_by_id(request.secondId)
    if not first or not second:
        raise HTTPException(404, "Both investigations must exist before comparing")
    first_entities = {node["data"]["label"] for node in first.get("nodes", [])}
    second_entities = {node["data"]["label"] for node in second.get("nodes", [])}
    first_relationships = {edge.get("label", "") for edge in first.get("edges", [])}
    second_relationships = {edge.get("label", "") for edge in second.get("edges", [])}
    return {
        "first": {"investigationId": first["investigationId"], "query": first["query"], "metrics": first["metrics"]},
        "second": {"investigationId": second["investigationId"], "query": second["query"], "metrics": second["metrics"]},
        "sharedEntities": sorted(first_entities & second_entities),
        "uniqueFirstEntities": sorted(first_entities - second_entities),
        "uniqueSecondEntities": sorted(second_entities - first_entities),
        "sharedRelationships": sorted(first_relationships & second_relationships),
    }


@app.post("/api/investigate")
async def investigate(request: InvestigationRequest) -> dict[str, Any]:
    query = request.query.strip()
    cached = cached_investigation(query)
    if cached:
        cached["cache"] = "HIT"
        return cached

    if not os.getenv("SERPAPI_API_KEY"):
        raise HTTPException(503, "SERPAPI_API_KEY is not configured")
    routed_verticals = route_verticals(query)
    logger.info("cache MISS query_hash=%s; routed SerpApi verticals=%s", query_hash(query), ",".join(routed_verticals))
    async with httpx.AsyncClient(timeout=12) as client:
        collected = await asyncio.gather(*(collect_vertical(client, query, source_type) for source_type in routed_verticals))
    evidence = deduplicate_evidence([
        record
        for source_type, results, _error in collected
        for record in normalize_evidence(query, results, source_type)
    ])
    failed_verticals = [source_type for source_type, _results, error in collected if error]
    successful_verticals = [source_type for source_type in routed_verticals if any(record["sourceType"] == source_type for record in evidence)]
    if not evidence and failed_verticals:
        raise HTTPException(502, f"All routed SerpApi verticals failed: {', '.join(failed_verticals)}")
    if not evidence:
        raise HTTPException(404, "No relevant sources with valid URLs were returned for this trace.")

    relationships, notice = await extract_relationships(query, evidence)
    relationships = detect_conflicts(relationships, evidence)
    nodes, edges = build_graph(query, evidence, relationships)
    payload: dict[str, Any] = {
        "query": query,
        "mode": "live",
        "cache": "MISS",
        "serpApiSources": successful_verticals,
        "serpApiRouted": routed_verticals,
        "serpApiFailures": failed_verticals,
        "investigationId": investigation_id(query_hash(query)),
        "nodes": nodes,
        "edges": edges,
        "evidence": evidence,
        "relationships": relationships,
        "metrics": {"entities": len(nodes), "relationships": len(edges), "sources": len(evidence), "conflicts": sum(1 for item in relationships if item["status"] == "CONFLICTING")},
        "report": (f"The trace found {len(evidence)} deduplicated source records and {len(edges)} source-linked relationships. Review the cited evidence before treating a possible link as operationally verified." if edges else f"The trace found {len(evidence)} deduplicated source records, but no source-linked relationships passed validation. No unsupported links were added."),
        "timeline": [{"date": "01 / ANCHOR", "label": "Investigation anchor", "detail": f"The trace began with “{query}”."}, {"date": "02 / EVIDENCE", "label": "Cross-domain retrieval", "detail": f"{len(evidence)} relevant records were deduplicated from {', '.join(successful_verticals)} surfaces."}, {"date": "03 / LINKING", "label": "Relationship reconstruction", "detail": f"{len(edges)} relationships passed evidence-ID validation."}],
        "exposure": [{"label": node["data"]["label"], "detail": "Directly supported by cited evidence.", "level": "HIGH" if node["data"]["status"] == "VERIFIED" else "MEDIUM"} for node in nodes if node["data"].get("exposure")],
        "notice": " ".join(part for part in (notice, f"Some SerpApi verticals failed: {', '.join(failed_verticals)}." if failed_verticals else None) if part) or None,
    }
    store_investigation(query, payload)
    return payload
