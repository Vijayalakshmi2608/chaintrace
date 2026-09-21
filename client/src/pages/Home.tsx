import { useCallback, useMemo, useState } from "react";
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
  Crosshair,
  ExternalLink,
  FileSearch,
  Filter,
  GitBranch,
  Globe2,
  Layers3,
  Loader2,
  Network,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Waypoints,
  X,
  Zap,
} from "lucide-react";

type Status = "VERIFIED" | "POSSIBLE" | "CONFLICTING";
type TraceNodeData = {
  label: string;
  kind: string;
  status: Status;
  evidence: number;
  exposure?: boolean;
  source?: string;
};
type TraceNode = Node<TraceNodeData, "trace">;
type TraceEdge = Edge<{ label: string; status: Status }>;
type Evidence = {
  id: string;
  title: string;
  source: string;
  sourceType: string;
  date: string;
  snippet: string;
  status: Status;
  url: string;
};
type Investigation = {
  query: string;
  mode: "live" | "preview" | "needs_configuration";
  nodes: TraceNode[];
  edges: TraceEdge[];
  evidence: Evidence[];
  report: string;
  timeline: { date: string; label: string; detail: string }[];
  exposure: { label: string; detail: string; level: "HIGH" | "MEDIUM" | "LOW" }[];
  metrics: { entities: number; relationships: number; sources: number; conflicts: number };
  notice?: string;
};

const steps = [
  "Event identified",
  "Entities discovered",
  "Web evidence collected",
  "Relationships connected",
  "Conflicts checked",
  "Dependency graph constructed",
];

const exampleQueries = [
  "2025 earthquake Taiwan semiconductor supply chain",
  "Nvidia Blackwell HBM supplier dependencies",
  "Red Sea shipping disruption automotive parts",
];

const previewInvestigation: Investigation = {
  query: "Nvidia Blackwell HBM supplier dependencies",
  mode: "preview",
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
  evidence: [
    { id: "preview-1", title: "Illustrative source placeholder", source: "CHAINTRACE preview", sourceType: "DEMO", date: "—", snippet: "This preview uses synthetic graph structure to demonstrate the interaction model. No claim is presented as live evidence.", status: "POSSIBLE", url: "#" },
  ],
  report: "This preview shows how CHAINTRACE will connect a reported event to component, supplier, technology, and downstream exposure. Live traces replace every illustrative link with source-backed evidence.",
  timeline: [
    { date: "STEP 01", label: "Reported change", detail: "A launch, disruption, or company is identified as the investigation anchor." },
    { date: "STEP 02", label: "Cross-domain evidence", detail: "Search, news, patents, jobs, and shopping surfaces are deduplicated." },
    { date: "STEP 03", label: "Dependency graph", detail: "Resolved entities are connected only when evidence supports the link." },
  ],
  exposure: [
    { label: "NVIDIA", detail: "Anchor entity in the investigation", level: "HIGH" },
    { label: "SK hynix", detail: "Supplier node with direct evidence in preview", level: "MEDIUM" },
    { label: "Cloud AI clusters", detail: "Downstream node requires live validation", level: "LOW" },
  ],
  metrics: { entities: 6, relationships: 5, sources: 1, conflicts: 0 },
};

function TraceNodeCard({ data }: NodeProps<TraceNode>) {
  const statusTone = {
    VERIFIED: "border-cyan-400/50 bg-cyan-400/[0.08] text-cyan-200",
    POSSIBLE: "border-amber-300/40 bg-amber-300/[0.08] text-amber-200",
    CONFLICTING: "border-rose-300/40 bg-rose-300/[0.08] text-rose-200",
  }[data.status];

  return (
    <div className={`trace-node ${data.exposure ? "trace-node-exposed" : ""}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-cyan-300" />
      <div className="flex items-start justify-between gap-3">
        <span className="trace-node-kind">{data.kind}</span>
        {data.exposure && <span className="trace-node-pulse" aria-label="Exposure detected" />}
      </div>
      <div className="mt-2 text-[13px] font-semibold leading-tight text-white">{data.label}</div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-slate-400">
        <span>{data.evidence} evidence {data.evidence === 1 ? "item" : "items"}</span>
        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${statusTone}`}>{data.status}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-cyan-300" />
    </div>
  );
}

const nodeTypes: NodeTypes = { trace: TraceNodeCard };

function Metric({ value, label, accent }: { value: string | number; label: string; accent?: string }) {
  return (
    <div className="metric-card">
      <div className={`metric-value ${accent ?? ""}`}>{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  return <span className={`status-dot status-${status.toLowerCase()}`} />;
}

function AppWordmark() {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-mark"><Network size={17} strokeWidth={2.25} /></div>
      <div>
        <div className="brand-name">CHAINTRACE</div>
        <div className="brand-subtitle">DEPENDENCY INTELLIGENCE</div>
      </div>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"graph" | "exposure" | "timeline" | "sources">("graph");

  const runInvestigation = useCallback(async (value?: string) => {
    const nextQuery = (value ?? query).trim();
    if (!nextQuery) return;
    setQuery(nextQuery);
    setError("");
    setInvestigation(null);
    setIsLoading(true);
    setProgress(0);

    for (let index = 0; index < steps.length; index += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 280));
      setProgress(index + 1);
    }

    try {
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: nextQuery }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Investigation unavailable");
      setInvestigation(payload);
      setActiveView("graph");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The investigation could not be completed.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  const showPreview = () => {
    setError("");
    setQuery(previewInvestigation.query);
    setInvestigation(previewInvestigation);
    setActiveView("graph");
  };

  const goHome = () => {
    setInvestigation(null);
    setError("");
    setProgress(0);
  };

  const selectedEvidence = useMemo(
    () => investigation?.evidence.find(item => item.id === activeEvidence) ?? investigation?.evidence[0],
    [activeEvidence, investigation],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={goHome} aria-label="Return to CHAINTRACE home"><AppWordmark /></button>
        <div className="topbar-center">
          <span className="live-indicator"><span /> LIVE INTELLIGENCE LAYER</span>
          <span className="topbar-divider" />
          <span className="topbar-note">Evidence first. Inference second.</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="Command palette"><Command size={16} /></button>
          <button className="text-button" onClick={showPreview}><BookOpen size={15} /> Read the brief</button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {!investigation && !isLoading ? (
          <motion.main key="home" className="landing" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="landing-grid" />
            <section className="hero-section">
              <div className="eyebrow"><span className="eyebrow-line" /> REAL-WORLD DEPENDENCY RECONSTRUCTION <span className="eyebrow-line" /></div>
              <h1>Discover what the world<br /><em>is connected to.</em></h1>
              <p className="hero-copy">CHAINTRACE reconstructs hidden dependency chains from real web evidence—across companies, components, suppliers, technologies, and downstream exposure.</p>

              <div className="intake-card">
                <div className="intake-label"><Crosshair size={14} /> WHAT SHOULD WE TRACE?</div>
                <div className="intake-row">
                  <Search size={20} className="intake-search" />
                  <input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void runInvestigation(); }} placeholder="A company, disruption, component, or event..." aria-label="Investigation query" />
                  <button className="trace-button" onClick={() => void runInvestigation()} disabled={!query.trim()}><span>TRACE NETWORK</span><ArrowUpRight size={17} /></button>
                </div>
                <div className="intake-footer">
                  <span>Search, news, patents, jobs & shopping</span>
                  <span className="shortcut"><kbd>⌘</kbd><kbd>↵</kbd> to trace</span>
                </div>
              </div>

              {error && <div className="error-banner"><CircleAlert size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={14} /></button></div>}

              <div className="examples-wrap">
                <div className="examples-label">TRY AN INVESTIGATION</div>
                <div className="example-chips">
                  {exampleQueries.map(example => <button key={example} className="example-chip" onClick={() => { setQuery(example); void runInvestigation(example); }}><span>{example}</span><ArrowUpRight size={13} /></button>)}
                </div>
              </div>
            </section>

            <section className="landing-footer-grid">
              <div className="manifesto-card">
                <div className="manifesto-index">01 / THE DIFFERENCE</div>
                <div className="manifesto-title">Not a chatbot.<br /><span>A chain of proof.</span></div>
                <p>Every relationship carries a source, date, and confidence state. Nothing enters the graph without an evidence trail.</p>
                <button className="inline-link" onClick={showPreview}>See the evidence model <ChevronRight size={14} /></button>
              </div>
              <div className="signal-card">
                <div className="signal-card-head"><span>TRACE ENGINE</span><span className="signal-status"><span /> READY</span></div>
                <div className="signal-lines"><span /><span /><span /><span /><span /></div>
                <div className="signal-copy"><strong>Cross-domain by design.</strong><span>SerpApi surfaces meet lightweight entity resolution.</span></div>
              </div>
              <button className="preview-card" onClick={showPreview}>
                <span className="preview-card-tag">INTERACTIVE PREVIEW</span>
                <span className="preview-card-title">Open a sample trace <ArrowDownRight size={18} /></span>
                <span className="preview-card-copy">Explore the graph, exposure view, and evidence ledger before connecting your own keys.</span>
              </button>
            </section>
          </motion.main>
        ) : isLoading ? (
          <motion.main key="loading" className="loading-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="loading-orbit"><div /><div /><div /><Waypoints size={28} /></div>
            <div className="eyebrow"><span className="eyebrow-line" /> TRACE IN PROGRESS <span className="eyebrow-line" /></div>
            <h2>Reconstructing the<br /><em>dependency chain.</em></h2>
            <p>Moving from <strong>“{query}”</strong> across live evidence surfaces.</p>
            <div className="progress-track"><div style={{ width: `${(progress / steps.length) * 100}%` }} /></div>
            <div className="loading-steps">{steps.map((step, index) => <div className={`loading-step ${index < progress ? "done" : index === progress ? "active" : ""}`} key={step}>{index < progress ? <Check size={14} /> : index === progress ? <Loader2 size={14} className="spin" /> : <span className="step-number">0{index + 1}</span>}<span>{step}</span></div>)}</div>
          </motion.main>
        ) : investigation ? (
          <motion.main key="results" className="results-shell" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="results-header">
              <div className="results-header-left"><button className="back-button" onClick={goHome}><ArrowLeft size={15} /> New trace</button><span className="header-slash">/</span><div><div className="results-kicker">INVESTIGATION {investigation.mode === "preview" ? "· PREVIEW" : investigation.mode === "needs_configuration" ? "· CONFIGURATION REQUIRED" : "· LIVE"}</div><h2>{investigation.query}</h2></div></div>
              <div className="results-header-right"><span className={`confidence-pill ${investigation.mode === "live" ? "live" : "preview"}`}><span /> {investigation.mode === "live" ? "LIVE TRACE" : "SANDBOX PREVIEW"}</span><button className="icon-button" title="Export trace report"><FileSearch size={16} /></button></div>
            </div>
            {investigation.notice && <div className="notice-banner"><CircleAlert size={15} /><span>{investigation.notice}</span></div>}
            <div className="metrics-row"><Metric value={investigation.metrics.entities} label="ENTITIES CONNECTED" accent="cyan" /><Metric value={investigation.metrics.relationships} label="LINKS RECONSTRUCTED" /><Metric value={investigation.metrics.sources} label="SOURCES INDEXED" /><Metric value={investigation.metrics.conflicts} label="CONFLICTS FLAGGED" accent={investigation.metrics.conflicts > 0 ? "rose" : ""} /><div className="metric-method"><ShieldCheck size={16} /><span><strong>Evidence grade</strong><br />Every link is source-backed</span></div></div>
            <div className="view-tabs"><button className={activeView === "graph" ? "active" : ""} onClick={() => setActiveView("graph")}><GitBranch size={15} /> Dependency graph</button><button className={activeView === "exposure" ? "active" : ""} onClick={() => setActiveView("exposure")}><Radar size={15} /> Exposure detector</button><button className={activeView === "timeline" ? "active" : ""} onClick={() => setActiveView("timeline")}><Clock3 size={15} /> Timeline</button><button className={activeView === "sources" ? "active" : ""} onClick={() => setActiveView("sources")}><Globe2 size={15} /> Sources <span className="tab-count">{investigation.metrics.sources}</span></button></div>

            <div className="results-grid">
              <section className="main-panel">
                {activeView === "graph" && <div className="graph-wrap"><div className="graph-legend"><span><StatusDot status="VERIFIED" /> Verified</span><span><StatusDot status="POSSIBLE" /> Possible</span><span><StatusDot status="CONFLICTING" /> Conflicting</span><span className="legend-spacer" /><span><span className="exposure-ring" /> Exposure detected</span></div><ReactFlow nodes={investigation.nodes} edges={investigation.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.5} maxZoom={1.5} proOptions={{ hideAttribution: true }}><Background color="#23334c" gap={28} size={1} /><Controls showInteractive={false} /><MiniMap nodeColor={node => node.data?.exposure ? "#55d6d1" : "#3b4b66"} maskColor="rgba(6, 12, 22, 0.78)" /></ReactFlow><div className="graph-helper"><Zap size={13} /> Drag to explore · Scroll to zoom · Click a link to inspect evidence</div></div>}
                {activeView === "exposure" && <div className="data-view"><div className="data-view-head"><div><div className="section-kicker">DIRECTLY SUPPORTED EXPOSURE</div><h3>Entities connected to the investigated change</h3></div><button className="filter-button"><Filter size={14} /> Filter <ChevronRight size={13} /></button></div><div className="exposure-list">{investigation.exposure.map(item => <div className="exposure-row" key={item.label}><div className="exposure-icon"><Crosshair size={16} /></div><div className="exposure-copy"><strong>{item.label}</strong><span>{item.detail}</span></div><span className={`level level-${item.level.toLowerCase()}`}>{item.level}</span><ArrowUpRight size={15} className="row-arrow" /></div>)}</div><div className="method-note"><ShieldCheck size={15} /><div><strong>Exposure is evidence, not prediction.</strong><span>CHAINTRACE only marks entities directly supported by the current evidence set. It does not forecast future impact.</span></div></div></div>}
                {activeView === "timeline" && <div className="data-view"><div className="data-view-head"><div><div className="section-kicker">TRACE TIMELINE</div><h3>How this chain was reconstructed</h3></div><span className="timeline-status">{investigation.timeline.length} trace stages</span></div><div className="timeline">{investigation.timeline.map((item, index) => <div className="timeline-item" key={item.date}><div className="timeline-rail"><span>{String(index + 1).padStart(2, "0")}</span>{index < investigation.timeline.length - 1 && <i />}</div><div className="timeline-copy"><span>{item.date}</span><strong>{item.label}</strong><p>{item.detail}</p></div></div>)}</div></div>}
                {activeView === "sources" && <div className="data-view"><div className="data-view-head"><div><div className="section-kicker">EVIDENCE LEDGER</div><h3>Source records supporting this trace</h3></div><span className="timeline-status">Deduplicated · sorted by relevance</span></div><div className="source-list">{investigation.evidence.map(item => <button className={`source-row ${activeEvidence === item.id ? "selected" : ""}`} key={item.id} onClick={() => setActiveEvidence(item.id)}><div className="source-type">{item.sourceType.slice(0, 3)}</div><div className="source-copy"><strong>{item.title}</strong><span>{item.source} · {item.date}</span></div><StatusDot status={item.status} /><ExternalLink size={14} /></button>)}</div></div>}
              </section>
              <aside className="evidence-panel"><div className="evidence-panel-head"><div><div className="section-kicker">EVIDENCE LEDGER</div><h3>Why this is connected</h3></div><span className="panel-count">{investigation.evidence.length} records</span></div>{selectedEvidence ? <div className="selected-evidence"><div className="selected-evidence-meta"><span className="source-badge">{selectedEvidence.sourceType}</span><span>{selectedEvidence.date}</span><StatusDot status={selectedEvidence.status} /></div><h4>{selectedEvidence.title}</h4><div className="selected-source"><Globe2 size={13} /> {selectedEvidence.source}</div><p>{selectedEvidence.snippet}</p>{selectedEvidence.url !== "#" && <a href={selectedEvidence.url} target="_blank" rel="noreferrer" className="source-link">Open source <ExternalLink size={13} /></a>}</div> : <div className="empty-evidence"><FileSearch size={20} /><span>Select a graph node or source to inspect supporting evidence.</span></div>}<div className="report-block"><div className="report-label"><Sparkles size={13} /> TRACE REPORT</div><p>{investigation.report}</p></div><div className="resolution-block"><div className="resolution-head"><Layers3 size={14} /> ENTITY RESOLUTION</div><div className="resolution-row"><span className="resolution-avatar">A</span><div><strong>Aliases normalized</strong><span>Names referring to one entity are collapsed before linking.</span></div><Check size={14} className="resolution-check" /></div></div></aside>
            </div>
          </motion.main>
        ) : null}
      </AnimatePresence>
      <footer className="app-footer"><span>CHAINTRACE / v0.9.4 · HACKATHON BUILD</span><span><span className="footer-dot" /> SQLITE CACHE ONLINE</span><span>Built for investigators, operators, and curious minds.</span></footer>
    </div>
  );
}
