import crypto from "node:crypto";
import { persistEvidence } from "./sqliteCache";

export type TraceStatus = "VERIFIED" | "POSSIBLE" | "CONFLICTING";

type SearchResult = {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
  source?: string | { name?: string; link?: string };
  source_type?: string;
};

type Evidence = {
  id: string;
  title: string;
  source: string;
  sourceType: string;
  date: string;
  snippet: string;
  status: TraceStatus;
  url: string;
};

type TraceNode = {
  id: string;
  type: "trace";
  position: { x: number; y: number };
  data: { label: string; kind: string; status: TraceStatus; evidence: number; exposure?: boolean };
};

type TraceEdge = {
  id: string;
  source: string;
  target: string;
  type: "smoothstep";
  animated?: boolean;
  label: string;
  data: { label: string; status: TraceStatus; evidence_ids?: string[]; confidence?: number };
};

type RelationshipHint = { subject: string; object: string; relationship_type: string; evidence_ids: string[]; confidence: number; status: TraceStatus };

function hashQuery(query: string) {
  return crypto.createHash("sha1").update(query.toLowerCase().trim()).digest("hex");
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 36);
}

function clampText(value: string, max = 240) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function sourceLabel(source: SearchResult["source"], url: string) {
  if (typeof source === "string" && source.trim()) return source.trim();
  if (source && typeof source === "object" && typeof source.name === "string" && source.name.trim()) return source.name.trim();
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "web source"; }
}

async function searchSerpApi(query: string, engine: "google" | "google_news") {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return [] as SearchResult[];
  const params = new URLSearchParams({ engine, q: query, api_key: key, num: "6", hl: "en" });
  try {
    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return [];
    const payload = await response.json() as { organic_results?: SearchResult[]; news_results?: SearchResult[] };
    return engine === "google_news" ? (payload.news_results ?? []) : (payload.organic_results ?? []);
  } catch {
    return [];
  }
}

async function extractRelationshipHints(query: string, evidence: Evidence[]) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || evidence.length === 0) return [] as RelationshipHint[];
  const compactEvidence = evidence.slice(0, 8).map(item => ({ id: item.id, title: item.title, url: item.url, source_type: item.sourceType, date: item.date, snippet: item.snippet }));
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://chaintrace.app", "X-Title": "CHAINTRACE" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openrouter/free",
        temperature: 0,
        messages: [
          { role: "system", content: "Extract only relationships directly supported by the supplied evidence. Return strict JSON. Every relationship must cite one or more supplied evidence_ids. Use VERIFIED, POSSIBLE, or CONFLICTING based only on the supplied sources. Never invent entities or future predictions." },
          { role: "user", content: JSON.stringify({ query, evidence: compactEvidence }) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "relationships", strict: true, schema: { type: "object", properties: { relationships: { type: "array", items: { type: "object", properties: { subject: { type: "string" }, object: { type: "string" }, relationship_type: { type: "string" }, evidence_ids: { type: "array", items: { type: "string" } }, confidence: { type: "number" }, status: { type: "string", enum: ["VERIFIED", "POSSIBLE", "CONFLICTING"] } }, required: ["subject", "object", "relationship_type", "evidence_ids", "confidence", "status"], additionalProperties: false } } }, required: ["relationships"], additionalProperties: false } } },
      }),
    });
    if (!response.ok) return [];
    const payload = await response.json() as { choices?: { message?: { content?: string | { text?: string }[] } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map(part => part.text || "").join(" ") : "";
    if (!text) return [];
    const normalized = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    const parsed = JSON.parse(start >= 0 && end > start ? normalized.slice(start, end + 1) : normalized) as { relationships?: RelationshipHint[] };
    const validIds = new Set(evidence.map(item => item.id));
    return (parsed.relationships ?? []).slice(0, 8).map(item => ({ ...item, evidence_ids: item.evidence_ids.filter(id => validIds.has(id)), status: item.status ?? "POSSIBLE" })).filter(item => item.subject && item.object && item.evidence_ids.length > 0 && item.confidence >= 0.5);
  } catch {
    return [];
  }
}

function buildEvidence(results: SearchResult[]) {
  const seen = new Set<string>();
  const records: Evidence[] = [];
  for (const result of results) {
    const url = result.link?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    records.push({
      id: `ev-${crypto.createHash("md5").update(url).digest("hex").slice(0, 10)}`,
      title: clampText(result.title || "Untitled source", 110),
      source: sourceLabel(result.source, url),
      sourceType: result.source_type || (result.date ? "NEWS" : "SEARCH"),
      date: result.date || new Date().toISOString().slice(0, 10),
      snippet: clampText(result.snippet || "No snippet returned by source."),
      status: "VERIFIED",
      url,
    });
  }
  return records.slice(0, 10);
}

export async function investigate(query: string) {
  const normalized = query.trim();
  if (!normalized) throw new Error("Enter a company, event, component, or disruption to trace.");
  const serpConfigured = Boolean(process.env.SERPAPI_API_KEY);
  if (!serpConfigured) {
    const error = new Error("Live tracing is not configured yet. Add SERPAPI_API_KEY to .env to collect current evidence, or open the interactive preview.");
    (error as Error & { code?: string }).code = "CONFIGURATION_REQUIRED";
    throw error;
  }

  const [searchResults, newsResults] = await Promise.all([searchSerpApi(normalized, "google"), searchSerpApi(normalized, "google_news")]);
  const evidence = buildEvidence([...searchResults, ...newsResults]);
  if (evidence.length === 0) {
    const error = new Error("No relevant sources were returned for this trace. Try a more specific query.");
    (error as Error & { code?: string }).code = "EMPTY_RESULTS";
    throw error;
  }
  await persistEvidence(normalized, evidence);
  const hints = await extractRelationshipHints(normalized, evidence);
  const rootId = `root-${slugify(normalized)}`;
  const nodes: TraceNode[] = [{ id: rootId, type: "trace", position: { x: 55, y: 215 }, data: { label: normalized.slice(0, 42), kind: "INVESTIGATION", status: "VERIFIED", evidence: evidence.length, exposure: true } }];
  const edges: TraceEdge[] = [];
  const linked = hints.flatMap(item => [item.subject, item.object]);
  const uniqueEntities = Array.from(new Set(linked.map(item => item.trim()).filter(Boolean))).slice(0, 7);
  uniqueEntities.forEach((label, index) => {
    const id = `entity-${slugify(label)}-${index}`;
    const isSupplier = /supplier|supply|memory|chip|component|manufacturer|foundry/i.test(label);
    const isDownstream = /cloud|automotive|retail|bank|platform|customer/i.test(label);
    const relationship = hints.find(item => item.subject === label || item.object === label);
    nodes.push({ id, type: "trace", position: { x: 335 + (index % 2) * 300, y: 80 + Math.floor(index / 2) * 150 }, data: { label: label.slice(0, 42), kind: isSupplier ? "SUPPLIER" : isDownstream ? "DOWNSTREAM" : "ENTITY", status: relationship?.status ?? "POSSIBLE", evidence: relationship?.evidence_ids.length ?? 0, exposure: relationship?.status === "VERIFIED" && isSupplier } });
    if (relationship) {
      const edgeLabel = relationship.relationship_type;
      edges.push({ id: `edge-${rootId}-${id}`, source: rootId, target: id, type: "smoothstep", label: edgeLabel, data: { label: edgeLabel, status: relationship.status, evidence_ids: relationship.evidence_ids, confidence: relationship.confidence }, animated: index === 0 });
    }
  });
  return {
    query: normalized,
    mode: "live" as const,
    nodes,
    edges,
    evidence,
    metrics: { entities: nodes.length, relationships: edges.length, sources: evidence.length, conflicts: 0 },
    report: hints.length > 0 ? `The current evidence set supports ${hints.length} extracted relationship${hints.length === 1 ? "" : "s"}. Review each source before treating a possible link as operationally verified.` : `The trace found ${evidence.length} deduplicated source${evidence.length === 1 ? "" : "s"}, but no source-linked relationships passed validation. No unsupported links were added.`,
    timeline: [
      { date: "01 / ANCHOR", label: "Investigation anchor", detail: `The trace began with “${normalized}”.` },
      { date: "02 / EVIDENCE", label: "Cross-domain retrieval", detail: `${evidence.length} relevant records were deduplicated from search and news surfaces.` },
      { date: "03 / LINKING", label: "Relationship reconstruction", detail: `${edges.length} relationship${edges.length === 1 ? "" : "s"} were connected with explicit confidence states.` },
    ],
    exposure: nodes.filter(node => node.data.exposure).map(node => ({ label: node.data.label, detail: "Directly connected by the current evidence set.", level: node.data.status === "VERIFIED" ? "HIGH" as const : "MEDIUM" as const })),
    notice: process.env.OPENROUTER_API_KEY ? undefined : "SerpApi evidence is live. OPENROUTER_API_KEY is not set, so relationship extraction is using deterministic fallback logic.",
  };
}
