import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Command,
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  FileSearch,
  Filter,
  GitBranch,
  GitCompare,
  Globe2,
  History,
  Layers3,
  Loader2,
  Network,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Save,
  Waypoints,
  X,
  Zap,
} from "lucide-react";

type Status = "VERIFIED" | "POSSIBLE" | "CONFLICTING";
type TraceNodeData = { label: string; kind: string; status: Status; evidence: number; exposure?: boolean; source?: string; spotlight?: boolean };
type TraceNode = Node<TraceNodeData, "trace">;
type TraceEdge = Edge<{ label: string; status: Status; evidence_ids?: string[]; confidence?: number; description?: string; conflict_with?: string[] }>;
type Evidence = { id: string; evidence_id?: string; title: string; source: string; sourceType: string; date: string; snippet: string; status: Status; url: string; query?: string };
type Investigation = {
  query: string;
  investigationId?: string;
  mode: "live" | "preview" | "needs_configuration";
  nodes: TraceNode[];
  edges: TraceEdge[];
  evidence: Evidence[];
  report: string;
  timeline: { date: string; label: string; detail: string }[];
  exposure: { label: string; detail: string; level: "HIGH" | "MEDIUM" | "LOW" }[];
  metrics: { entities: number; relationships: number; sources: number; conflicts: number };
  serpApiSources?: string[];
  serpApiRouted?: string[];
  serpApiFailures?: string[];
  notice?: string;
};
type RecentInvestigation = { investigationId: string; query: string; createdAt: string; metrics: Investigation["metrics"] };
type Comparison = { first: { investigationId: string; query: string; metrics: Investigation["metrics"] }; second: { investigationId: string; query: string; metrics: Investigation["metrics"] }; sharedEntities: string[]; uniqueFirstEntities: string[]; uniqueSecondEntities: string[]; sharedRelationships: string[] };

const steps = ["Event identified", "Entities discovered", "Web evidence collected", "Relationships connected", "Conflicts checked", "Dependency graph constructed"];
const exampleQueries = ["2025 earthquake Taiwan semiconductor supply chain", "Nvidia Blackwell HBM supplier dependencies", "Red Sea shipping disruption automotive parts"];
const filterOptions = ["All", "Search", "News", "Patents", "Jobs", "Shopping"];

const previewInvestigation: Investigation = {
  query: "Nvidia Blackwell HBM supplier dependencies", investigationId: "DEMO-PREVIEW", mode: "preview",
  notice: "Preview graph only. Nodes and links are illustrative; run a live trace to attach current web evidence.",
  nodes: [
    { id: "event", type: "trace", position: { x: 36, y: 200 }, data: { label: "Blackwell launch", kind: "EVENT", status: "VERIFIED", evidence: 4 } },
    { id: "nvidia", type: "trace", position: { x: 300, y: 200 }, data: { label: "NVIDIA", kind: "COMPANY", status: "VERIFIED", evidence: 8, exposure: true } },
    { id: "hbm3e", type: "trace", position: { x: 600, y: 70 }, data: { label: "HBM3E memory", kind: "COMPONENT", status: "VERIFIED", evidence: 6 } },
    { id: "skhynix", type: "trace", position: { x: 880, y: 70 }, data: { label: "SK hynix", kind: "SUPPLIER", status: "VERIFIED", evidence: 5, exposure: true } },
    { id: "tsmc", type: "trace", position: { x: 600, y: 300 }, data: { label: "TSMC CoWoS", kind: "TECHNOLOGY", status: "VERIFIED", evidence: 7 } },
    { id: "cloud", type: "trace", position: { x: 880, y: 300 }, data: { label: "Cloud AI clusters", kind: "DOWNSTREAM", status: "POSSIBLE", evidence: 3 } },
  ],
  edges: [
    { id: "e1", source: "event", target: "nvidia", label: "announced by", type: "smoothstep", data: { label: "announced by", status: "VERIFIED" }, animated: true },
    { id: "e2", source: "nvidia", target: "hbm3e", label: "requires", type: "smoothstep", data: { label: "requires", status: "VERIFIED" } },
    { id: "e3", source: "hbm3e", target: "skhynix", label: "supplied by", type: "smoothstep", data: { label: "supplied by", status: "VERIFIED" } },
    { id: "e4", source: "nvidia", target: "tsmc", label: "packaged by", type: "smoothstep", data: { label: "packaged by", status: "VERIFIED" } },
    { id: "e5", source: "tsmc", target: "cloud", label: "enables", type: "smoothstep", data: { label: "enables", status: "POSSIBLE" } },
  ],
  evidence: [{ id: "preview-1", title: "Illustrative source placeholder", source: "CHAINTRACE preview", sourceType: "DEMO", date: "—", snippet: "This preview uses synthetic graph structure to demonstrate the interaction model. No claim is presented as live evidence.", status: "POSSIBLE", url: "#" }],
  report: "This preview shows how CHAINTRACE will connect a reported event to component, supplier, technology, and downstream exposure. Live traces replace every illustrative link with source-backed evidence.",
  timeline: [{ date: "STEP 01", label: "Reported change", detail: "A launch, disruption, or company is identified as the investigation anchor." }, { date: "STEP 02", label: "Cross-domain evidence", detail: "Search, news, patents, jobs, and shopping surfaces are deduplicated." }, { date: "STEP 03", label: "Dependency graph", detail: "Resolved entities are connected only when evidence supports the link." }],
  exposure: [{ label: "NVIDIA", detail: "Anchor entity in the investigation", level: "HIGH" }, { label: "SK hynix", detail: "Supplier node with direct evidence in preview", level: "MEDIUM" }, { label: "Cloud AI clusters", detail: "Downstream node requires live validation", level: "LOW" }],
  metrics: { entities: 6, relationships: 5, sources: 1, conflicts: 0 },
};

function TraceNodeCard({ data }: NodeProps<TraceNode>) {
  const statusTone = { VERIFIED: "border-cyan-400/50 bg-cyan-400/[0.08] text-cyan-200", POSSIBLE: "border-amber-300/40 bg-amber-300/[0.08] text-amber-200", CONFLICTING: "border-rose-300/40 bg-rose-300/[0.08] text-rose-200" }[data.status];
  return <div className={`trace-node ${data.exposure ? "trace-node-exposed" : ""} ${data.spotlight ? "trace-node-selected" : ""}`}><Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-cyan-300" /><div className="flex items-start justify-between gap-3"><span className="trace-node-kind">{data.kind}</span>{data.exposure && <span className="trace-node-pulse" aria-label="Exposure detected" />}</div><div className="mt-2 text-[13px] font-semibold leading-tight text-white">{data.label}</div><div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-slate-400"><span>{data.evidence} evidence {data.evidence === 1 ? "item" : "items"}</span><span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${statusTone}`}>{data.status}</span></div><Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-cyan-300" /></div>;
}
const nodeTypes: NodeTypes = { trace: TraceNodeCard };
function Metric({ value, label, accent }: { value: string | number; label: string; accent?: string }) { return <div className="metric-card"><div className={`metric-value ${accent ?? ""}`}>{value}</div><div className="metric-label">{label}</div></div>; }
function StatusDot({ status }: { status: Status }) { return <span className={`status-dot status-${status.toLowerCase()}`} />; }
function AppWordmark() { return <div className="flex items-center gap-3"><div className="brand-mark"><Network size={17} strokeWidth={2.25} /></div><div><div className="brand-name">CHAINTRACE</div><div className="brand-subtitle">DEPENDENCY INTELLIGENCE</div></div></div>; }

function download(name: string, type: string, content: string | Blob) { const blob = content instanceof Blob ? content : new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
function csvCell(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function pdfEscape(value: string) { return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
function makePdf(lines: string[]) {
  const safeLines = lines.map(line => line.slice(0, 108));
  const stream = ["BT", "/F1 10 Tf", "48 760 Td", ...safeLines.flatMap((line, index) => [`(${pdfEscape(line)}) Tj`, index < safeLines.length - 1 ? "0 -14 Td" : ""]), "ET"].join("\n");
  const objects = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0]; objects.forEach((object, index) => { offsets[index + 1] = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return pdf;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [activeView, setActiveView] = useState<"graph" | "exposure" | "timeline" | "sources">("graph");
  const [evidenceFilter, setEvidenceFilter] = useState("All");
  const [recent, setRecent] = useState<RecentInvestigation[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [notice, setNotice] = useState("");
  const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
  const api = useCallback((path: string, options?: RequestInit) => fetch(`${apiBase}${path}`, options), [apiBase]);

  const refreshRecent = useCallback(async () => { try { const response = await api("/api/investigations"); if (response.ok) setRecent((await response.json()).investigations ?? []); } catch { /* recent history is non-blocking */ } }, [api]);
  useEffect(() => { void refreshRecent(); }, [refreshRecent]);

  const runInvestigation = useCallback(async (value?: string) => {
    const nextQuery = (value ?? query).trim(); if (!nextQuery) return; setQuery(nextQuery); setError(""); setNotice(""); setInvestigation(null); setIsLoading(true); setProgress(0); setEvidenceFilter("All");
    for (let index = 0; index < steps.length; index += 1) { await new Promise(resolve => window.setTimeout(resolve, 280)); setProgress(index + 1); }
    try { const response = await api("/api/investigate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: nextQuery }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.message || "Investigation unavailable"); setInvestigation(payload); setSpotlight(null); setActiveView("graph"); await refreshRecent(); } catch (caught) { setError(caught instanceof Error ? caught.message : "The investigation could not be completed."); } finally { setIsLoading(false); }
  }, [api, query, refreshRecent]);

  const showPreview = () => { setError(""); setQuery(previewInvestigation.query); setInvestigation(previewInvestigation); setSpotlight(null); setActiveView("graph"); };
  const goHome = () => { setInvestigation(null); setSpotlight(null); setError(""); setProgress(0); setComparison(null); };
  const reopen = async (id: string) => { try { const response = await api(`/api/investigations/${id}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.detail || "Investigation not found"); setInvestigation(payload); setSpotlight(null); setQuery(payload.query); setShowRecent(false); setEvidenceFilter("All"); setActiveView("graph"); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not reopen investigation."); } };
  const toggleCompare = (id: string) => setCompareIds(current => current.includes(id) ? current.filter(item => item !== id) : current.length < 2 ? [...current, id] : [current[1], id]);
  const compare = async () => { if (compareIds.length !== 2) return; const response = await api("/api/investigations/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ firstId: compareIds[0], secondId: compareIds[1] }) }); if (response.ok) setComparison(await response.json()); };
  const copyId = async () => { if (!investigation?.investigationId) return; await navigator.clipboard?.writeText(investigation.investigationId); setNotice(`Copied ${investigation.investigationId}`); };
  const save = async () => { await refreshRecent(); setNotice(investigation?.investigationId ? `Saved as ${investigation.investigationId}` : "Investigation is stored in SQLite"); };

  const availableFilters = useMemo(() => filterOptions.filter(option => option === "All" || investigation?.evidence.some(item => item.sourceType.toLowerCase().includes(option.toLowerCase()))), [investigation]);
  const filteredEvidence = useMemo(() => investigation?.evidence.filter(item => evidenceFilter === "All" || item.sourceType.toLowerCase().includes(evidenceFilter.toLowerCase())) ?? [], [evidenceFilter, investigation]);
  const selectedEdge = useMemo(() => spotlight?.kind === "edge" ? investigation?.edges.find(edge => edge.id === spotlight.id) : undefined, [investigation, spotlight]);
  const selectedNode = useMemo(() => spotlight?.kind === "node" ? investigation?.nodes.find(node => node.id === spotlight.id) : undefined, [investigation, spotlight]);
  const selectedEdgeSummary = useMemo(() => selectedEdge ? { source: investigation?.nodes.find(node => node.id === selectedEdge.source)?.data.label ?? selectedEdge.source, target: investigation?.nodes.find(node => node.id === selectedEdge.target)?.data.label ?? selectedEdge.target, relationship: selectedEdge.data?.label ?? selectedEdge.label ?? "relationship" } : undefined, [investigation, selectedEdge]);
  const selectedConflictEdges = useMemo(() => {
    if (!investigation || !selectedEdge?.data?.conflict_with?.length) return [];
    const competing = new Set(selectedEdge.data.conflict_with.map(value => value.toLowerCase()));
    return investigation.edges.filter(edge => edge.id !== selectedEdge.id && competing.has((investigation.nodes.find(node => node.id === edge.target)?.data.label ?? "").toLowerCase()));
  }, [investigation, selectedEdge]);
  const spotlightEvidenceIds = useMemo(() => {
    if (!investigation || !spotlight) return [];
    if (spotlight.kind === "edge") return selectedEdge?.data?.evidence_ids ?? [];
    if (selectedNode?.id.startsWith("root-")) return investigation.evidence.map(item => item.id);
    return investigation.edges.filter(edge => edge.source === spotlight.id || edge.target === spotlight.id).flatMap(edge => edge.data?.evidence_ids ?? []);
  }, [investigation, selectedEdge, selectedNode, spotlight]);
  const spotlightEvidence = useMemo(() => {
    if (!spotlight || spotlightEvidenceIds.length === 0) return [];
    const ids = new Set(spotlightEvidenceIds);
    return investigation?.evidence.filter(item => ids.has(item.id)) ?? [];
  }, [investigation, spotlight, spotlightEvidenceIds]);
  const visibleEvidence = spotlightEvidence.length > 0 ? spotlightEvidence : filteredEvidence;
  const selectedEvidence = useMemo(() => visibleEvidence.find(item => item.id === activeEvidence) ?? visibleEvidence[0], [activeEvidence, visibleEvidence]);
  const graphNodes = useMemo(() => investigation?.nodes.map(node => ({ ...node, data: { ...node.data, spotlight: spotlight?.kind === "node" && spotlight.id === node.id } })) ?? [], [investigation, spotlight]);
  const graphEdges = useMemo(() => investigation?.edges.map(edge => ({ ...edge, className: spotlight?.kind === "edge" ? (spotlight.id === edge.id ? "spotlight-edge" : "dimmed-edge") : spotlight?.kind === "node" && (edge.source === spotlight.id || edge.target === spotlight.id) ? "spotlight-edge" : undefined })) ?? [], [investigation, spotlight]);

  const selectNode = useCallback((node: TraceNode) => { setSpotlight({ kind: "node", id: node.id }); setActiveEvidence(null); }, []);
  const selectEdge = useCallback((edge: TraceEdge) => { setSpotlight({ kind: "edge", id: edge.id }); setActiveEvidence(edge.data?.evidence_ids?.[0] ?? null); }, []);

  const exportCsv = () => { if (!investigation) return; const byId = new Map(investigation.evidence.map(item => [item.id, item])); const labels = new Map(investigation.nodes.map(node => [node.id, node.data.label])); const rows = [["entity", "relationship", "source", "source type", "date", "evidence", "confidence/status"]]; investigation.edges.forEach(edge => { const ids = edge.data?.evidence_ids ?? []; const linked = ids.map(id => byId.get(id)).filter(Boolean) as Evidence[]; (linked.length ? linked : [undefined]).forEach(source => rows.push([labels.get(String(edge.target)) ?? labels.get(String(edge.source)) ?? String(edge.target), String(edge.label ?? edge.data?.label ?? ""), source?.source ?? "", source?.sourceType ?? "", source?.date ?? "", source?.snippet ?? "", `${edge.data?.confidence ?? ""}/${edge.data?.status ?? ""}`])); }); download(`chaintrace-${investigation.investigationId ?? "trace"}.csv`, "text/csv;charset=utf-8", rows.map(row => row.map(csvCell).join(",")).join("\n")); setNotice("CSV evidence ledger downloaded"); };
  const exportPdf = () => { if (!investigation) return; const entityLines = investigation.nodes.map(node => `- ${node.data.label} [${node.data.status}]`); const relationshipLines = investigation.edges.map(edge => `- ${edge.label ?? edge.data?.label} [${edge.data?.status ?? ""}]`); const lines = [`CHAINTRACE TRACE REPORT`, `Investigation: ${investigation.query}`, `ID: ${investigation.investigationId ?? "—"}`, "", `Summary: ${investigation.report}`, "", "ENTITIES", ...entityLines, "", "RELATIONSHIPS", ...relationshipLines, "", "EXPOSURE", ...investigation.exposure.map(item => `- ${item.label} [${item.level}]`), "", "TIMELINE", ...investigation.timeline.map(item => `- ${item.date} ${item.label}: ${item.detail}`), "", "EVIDENCE", ...investigation.evidence.map(item => `- ${item.title} | ${item.source} | ${item.sourceType} | ${item.date}`)]; download(`chaintrace-${investigation.investigationId ?? "trace"}.pdf`, "application/pdf", makePdf(lines)); setNotice("PDF trace report downloaded"); };

  return <div className="app-shell">
    <header className="topbar"><button className="brand-button" onClick={goHome} aria-label="Return to CHAINTRACE home"><AppWordmark /></button><div className="topbar-center"><span className="live-indicator"><span /> LIVE INTELLIGENCE LAYER</span><span className="topbar-divider" /><span className="topbar-note">Evidence first. Inference second.</span></div><div className="topbar-actions"><button className="icon-button" title="Command palette"><Command size={16} /></button><button className="text-button" onClick={showPreview}><BookOpen size={15} /> Read the brief</button></div></header>
    <AnimatePresence mode="wait">
      {!investigation && !isLoading ? <motion.main key="home" className="landing" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}><div className="landing-grid" /><section className="hero-section"><div className="eyebrow"><span className="eyebrow-line" /> REAL-WORLD DEPENDENCY RECONSTRUCTION <span className="eyebrow-line" /></div><h1>Discover what the world<br /><em>is connected to.</em></h1><p className="hero-copy">CHAINTRACE reconstructs hidden dependency chains from real web evidence—across companies, components, suppliers, technologies, and downstream exposure.</p><div className="intake-card"><div className="intake-label"><Crosshair size={14} /> WHAT SHOULD WE TRACE?</div><div className="intake-row"><Search size={20} className="intake-search" /><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void runInvestigation(); }} placeholder="A company, disruption, component, or event..." aria-label="Investigation query" /><button className="trace-button" onClick={() => void runInvestigation()} disabled={!query.trim()}><span>TRACE NETWORK</span><ArrowUpRight size={17} /></button></div><div className="intake-footer"><span>Search, news, patents, jobs & shopping</span><span className="shortcut"><kbd>⌘</kbd><kbd>↵</kbd> to trace</span></div></div>{error && <div className="error-banner"><CircleAlert size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={14} /></button></div>}<div className="examples-wrap"><div className="examples-label">TRY AN INVESTIGATION</div><div className="example-chips">{exampleQueries.map(example => <button key={example} className="example-chip" onClick={() => { setQuery(example); void runInvestigation(example); }}><span>{example}</span><ArrowUpRight size={13} /></button>)}</div></div></section><section className="landing-footer-grid"><div className="manifesto-card"><div className="manifesto-index">01 / THE DIFFERENCE</div><div className="manifesto-title">Not a chatbot.<br /><span>A chain of proof.</span></div><p>Every relationship carries a source, date, and confidence state. Nothing enters the graph without an evidence trail.</p><button className="inline-link" onClick={showPreview}>See the evidence model <ChevronRight size={14} /></button></div><div className="signal-card"><div className="signal-card-head"><span>TRACE ENGINE</span><span className="signal-status"><span /> READY</span></div><div className="signal-lines"><span /><span /><span /><span /><span /></div><div className="signal-copy"><strong>Cross-domain by design.</strong><span>SerpApi surfaces meet lightweight entity resolution.</span></div></div><button className="preview-card" onClick={showPreview}><span className="preview-card-tag">INTERACTIVE PREVIEW</span><span className="preview-card-title">Open a sample trace <ArrowDownRight size={18} /></span><span className="preview-card-copy">Explore the graph, exposure view, and evidence ledger before connecting your own keys.</span></button></section></motion.main> : isLoading ? <motion.main key="loading" className="loading-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="loading-orbit"><div /><div /><div /><Waypoints size={28} /></div><div className="eyebrow"><span className="eyebrow-line" /> TRACE IN PROGRESS <span className="eyebrow-line" /></div><h2>Reconstructing the<br /><em>dependency chain.</em></h2><p>Moving from <strong>“{query}”</strong> across live evidence surfaces.</p><div className="progress-track"><div style={{ width: `${(progress / steps.length) * 100}%` }} /></div><div className="loading-steps">{steps.map((step, index) => <div className={`loading-step ${index < progress ? "done" : index === progress ? "active" : ""}`} key={step}>{index < progress ? <Check size={14} /> : index === progress ? <Loader2 size={14} className="spin" /> : <span className="step-number">0{index + 1}</span>}<span>{step}</span></div>)}</div></motion.main> : investigation ? <motion.main key="results" className="results-shell" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
        <div className="results-header"><div className="results-header-left"><button className="back-button" onClick={goHome}><ArrowLeft size={15} /> New trace</button><span className="header-slash">/</span><div><div className="results-kicker">INVESTIGATION {investigation.mode === "preview" ? "· PREVIEW" : "· LIVE"}</div><h2>{investigation.query}</h2><span className="text-[10px] text-slate-500">ID {investigation.investigationId ?? "preview"}</span></div></div><div className="results-header-right"><span className={`confidence-pill ${investigation.mode === "live" ? "live" : "preview"}`}><span /> {investigation.mode === "live" ? "LIVE TRACE" : "SANDBOX PREVIEW"}</span><button className="icon-button" title="Copy investigation ID" onClick={() => void copyId()}><Copy size={16} /></button><button className="icon-button" title="Save investigation" onClick={() => void save()}><Save size={16} /></button><button className="icon-button" title="Recent investigations" onClick={() => { setShowRecent(current => !current); void refreshRecent(); }}><History size={16} /></button></div></div>
        {showRecent && <div className="notice-banner flex-wrap gap-2"><History size={15} /><span className="mr-2">Recent investigations</span>{recent.length === 0 ? <span>No saved investigations yet.</span> : recent.map(item => <button key={item.investigationId} className="example-chip !py-1" onClick={() => void reopen(item.investigationId)}>{item.investigationId} · {item.query.slice(0, 34)}{compareIds.includes(item.investigationId) && " ✓"}<span onClick={event => { event.stopPropagation(); toggleCompare(item.investigationId); }}>+</span></button>)}<button className="trace-button !ml-auto !px-3 !py-2" disabled={compareIds.length !== 2} onClick={() => void compare()}><GitCompare size={14} /> Compare</button></div>}
        {comparison && <div className="notice-banner comparison-banner"><GitCompare size={15} /><span><strong>{comparison.first.query}</strong> vs <strong>{comparison.second.query}</strong> · {comparison.sharedEntities.length} shared entities · {comparison.sharedRelationships.length} shared relationships · {comparison.first.metrics.sources} vs {comparison.second.metrics.sources} sources.</span><button onClick={() => setComparison(null)}><X size={14} /></button></div>}
        {notice && <div className="notice-banner"><Check size={15} /><span>{notice}</span></div>}{investigation.notice && <div className="notice-banner"><CircleAlert size={15} /><span>{investigation.notice}</span></div>}
        {investigation.mode === "live" && <div className="serp-sources-panel"><div><div className="section-kicker">SERPAPI EVIDENCE SOURCES</div><strong>Verticals used for this trace</strong></div><div className="serp-source-chips">{(investigation.serpApiSources ?? []).map(source => <span className="serp-source-chip" key={source}><Check size={12} /> {source}</span>)}{(investigation.serpApiSources ?? []).length === 0 && <span className="serp-source-empty">No successful vertical returned evidence.</span>}</div>{(investigation.serpApiFailures ?? []).length > 0 && <span className="serp-source-warning"><CircleAlert size={13} /> Partial retrieval: {(investigation.serpApiFailures ?? []).join(", ")} failed.</span>}</div>}
        <div className="metrics-row"><Metric value={investigation.metrics.entities} label="ENTITIES CONNECTED" accent="cyan" /><Metric value={investigation.metrics.relationships} label="LINKS RECONSTRUCTED" /><Metric value={investigation.metrics.sources} label="SOURCES INDEXED" /><Metric value={investigation.metrics.conflicts} label="CONFLICTS FLAGGED" accent={investigation.metrics.conflicts > 0 ? "rose" : ""} /><div className="metric-method"><ShieldCheck size={16} /><span><strong>Evidence grade</strong><br />Every link is source-backed</span></div></div>
        <div className="view-tabs"><button className={activeView === "graph" ? "active" : ""} onClick={() => setActiveView("graph")}><GitBranch size={15} /> Dependency graph</button><button className={activeView === "exposure" ? "active" : ""} onClick={() => setActiveView("exposure")}><Radar size={15} /> Exposure detector</button><button className={activeView === "timeline" ? "active" : ""} onClick={() => setActiveView("timeline")}><Clock3 size={15} /> Timeline</button><button className={activeView === "sources" ? "active" : ""} onClick={() => setActiveView("sources")}><Globe2 size={15} /> Sources <span className="tab-count">{investigation.metrics.sources}</span></button></div>
        <div className="results-grid"><section className="main-panel">
          {spotlight && <div className="spotlight-banner"><Crosshair size={14} /><span>{spotlight.kind === "edge" ? "EDGE SPOTLIGHT" : "NODE SPOTLIGHT"}</span><strong>{selectedEdgeSummary ? `${selectedEdgeSummary.source} → ${selectedEdgeSummary.relationship} → ${selectedEdgeSummary.target}` : selectedNode?.data.label}</strong><button onClick={() => { setSpotlight(null); setActiveEvidence(null); }} aria-label="Clear spotlight"><X size={13} /></button></div>}
          {selectedEdge && <div className="spotlight-edge-details"><div className="spotlight-detail-row"><span>STATUS</span><strong className={`status-text-${selectedEdge.data?.status?.toLowerCase()}`}>{selectedEdge.data?.status}</strong><span>CONFIDENCE</span><strong>{selectedEdge.data?.confidence != null ? `${Math.round(selectedEdge.data.confidence * 100)}%` : "—"}</strong></div><p>{selectedEdge.data?.description ?? "Relationship supported by the selected evidence."}</p>{selectedConflictEdges.length > 0 && <div className="conflict-claims"><div className="section-kicker">COMPETING CLAIMS</div><div className="conflict-claim-grid"><div><strong>{selectedEdgeSummary?.target}</strong><small>{(selectedEdge.data?.evidence_ids ?? []).length} supporting source{(selectedEdge.data?.evidence_ids ?? []).length === 1 ? "" : "s"}</small></div>{selectedConflictEdges.map(edge => <div key={edge.id}><strong>{investigation.nodes.find(node => node.id === edge.target)?.data.label ?? edge.target}</strong><small>{(edge.data?.evidence_ids ?? []).length} competing source{(edge.data?.evidence_ids ?? []).length === 1 ? "" : "s"}</small></div>)}</div></div>}</div>}
          {activeView === "graph" && <div className="graph-wrap"><div className="graph-legend"><span><StatusDot status="VERIFIED" /> Verified</span><span><StatusDot status="POSSIBLE" /> Possible</span><span><StatusDot status="CONFLICTING" /> Conflicting</span><span className="legend-spacer" /><span><span className="exposure-ring" /> Exposure detected</span></div><ReactFlow nodes={graphNodes} edges={graphEdges} nodeTypes={nodeTypes} onNodeClick={(_event, node) => selectNode(node)} onEdgeClick={(_event, edge) => selectEdge(edge)} onPaneClick={() => { setSpotlight(null); setActiveEvidence(null); }} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.5} maxZoom={1.5} proOptions={{ hideAttribution: true }}><Background color="#23334c" gap={28} size={1} /><Controls showInteractive={false} /><MiniMap nodeColor={node => node.data?.exposure ? "#55d6d1" : "#3b4b66"} maskColor="rgba(6, 12, 22, 0.78)" /></ReactFlow><div className="graph-helper"><Zap size={13} /> Click a node or link to spotlight its evidence · Click empty space to clear</div></div>}
          {activeView === "exposure" && <div className="data-view"><div className="data-view-head"><div><div className="section-kicker">DIRECTLY SUPPORTED EXPOSURE</div><h3>Entities connected to the investigated change</h3></div></div><div className="exposure-list">{investigation.exposure.map(item => <div className="exposure-row" key={item.label}><div className="exposure-icon"><Crosshair size={16} /></div><div className="exposure-copy"><strong>{item.label}</strong><span>{item.detail}</span></div><span className={`level level-${item.level.toLowerCase()}`}>{item.level}</span><ArrowUpRight size={15} className="row-arrow" /></div>)}</div><div className="method-note"><ShieldCheck size={15} /><div><strong>Exposure is evidence, not prediction.</strong><span>CHAINTRACE only marks entities directly supported by the current evidence set.</span></div></div></div>}
          {activeView === "timeline" && <div className="data-view"><div className="data-view-head"><div><div className="section-kicker">TRACE TIMELINE</div><h3>How this chain was reconstructed</h3></div><span className="timeline-status">{investigation.timeline.length} trace stages</span></div><div className="timeline">{investigation.timeline.map((item, index) => <div className="timeline-item" key={item.date}><div className="timeline-rail"><span>{String(index + 1).padStart(2, "0")}</span>{index < investigation.timeline.length - 1 && <i />}</div><div className="timeline-copy"><span>{item.date}</span><strong>{item.label}</strong><p>{item.detail}</p></div></div>)}</div></div>}
          {activeView === "sources" && <div className="data-view"><div className="data-view-head"><div><div className="section-kicker">EVIDENCE LEDGER</div><h3>Source records supporting this trace</h3></div><div className="flex gap-2"><button className="icon-button" title="Export PDF" onClick={exportPdf}><Download size={15} /></button><button className="icon-button" title="Export CSV" onClick={exportCsv}><FileSearch size={15} /></button></div></div><div className="filter-bar" aria-label="Evidence type filters">{availableFilters.map(option => <button key={option} className={evidenceFilter === option ? "active" : ""} onClick={() => setEvidenceFilter(option)}><Filter size={12} /> {option}</button>)}</div><div className="source-list">{filteredEvidence.length === 0 ? <div className="empty-evidence"><FileSearch size={20} /><span>No {evidenceFilter.toLowerCase()} evidence in this investigation.</span></div> : filteredEvidence.map(item => <button className={`source-row ${activeEvidence === item.id ? "selected" : ""}`} key={item.id} onClick={() => setActiveEvidence(item.id)}><div className="source-type">{item.sourceType}</div><div className="source-copy"><strong>{item.title}</strong><span>{item.source} · {item.date}</span></div><StatusDot status={item.status} /><ExternalLink size={14} /></button>)}</div></div>}
        </section><aside className="evidence-panel"><div className="evidence-panel-head"><div><div className="section-kicker">EVIDENCE LEDGER</div><h3>Why this is connected</h3></div><span className="panel-count">{filteredEvidence.length}/{investigation.evidence.length} records</span></div>{selectedEvidence ? <div className="selected-evidence"><div className="selected-evidence-meta"><span className="source-badge">{selectedEvidence.sourceType}</span><span>{selectedEvidence.date}</span><StatusDot status={selectedEvidence.status} /></div><h4>{selectedEvidence.title}</h4><div className="selected-source"><Globe2 size={13} /> {selectedEvidence.source}</div><p>{selectedEvidence.snippet}</p>{selectedEvidence.url !== "#" && <a href={selectedEvidence.url} target="_blank" rel="noreferrer" className="source-link">Open source <ExternalLink size={13} /></a>}</div> : <div className="empty-evidence"><FileSearch size={20} /><span>Select a source to inspect supporting evidence.</span></div>}
          {spotlightEvidence.length > 0 && <div className="spotlight-evidence-list"><div className="section-kicker">RELATED EVIDENCE · {spotlightEvidence.length}</div>{spotlightEvidence.map(item => <button className={`spotlight-evidence-row ${selectedEvidence?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => setActiveEvidence(item.id)}><span className="source-badge">{item.sourceType}</span><span><strong>{item.title}</strong><small>{item.date} · {item.source}</small></span><StatusDot status={item.status} /></button>)}</div>}<div className="report-block"><div className="report-label"><Sparkles size={13} /> TRACE REPORT</div><p>{investigation.report}</p><div className="mt-3 flex gap-2"><button className="text-button" onClick={exportPdf}><Download size={14} /> Export PDF</button><button className="text-button" onClick={exportCsv}><FileSearch size={14} /> Export CSV</button></div></div><div className="resolution-block"><div className="resolution-head"><Layers3 size={14} /> ENTITY RESOLUTION</div><div className="resolution-row"><span className="resolution-avatar">A</span><div><strong>Aliases normalized</strong><span>Names referring to one entity are collapsed before linking.</span></div><Check size={14} className="resolution-check" /></div></div></aside></div>
      </motion.main> : null}
    </AnimatePresence><footer className="app-footer"><span>CHAINTRACE / v0.9.4 · HACKATHON BUILD</span><span><span className="footer-dot" /> SQLITE CACHE ONLINE</span><span>Built for investigators, operators, and curious minds.</span></footer>
  </div>;
}
