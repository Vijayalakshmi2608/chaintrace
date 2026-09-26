import { describe, expect, it } from "vitest";
import { buildCascadePaths } from "./cascade";

const nodes = ["root", "supplier", "component", "unrelated"].map(id => ({ id }));
const edges = [
  { id: "e1", source: "root", target: "supplier", label: "supplied by", data: { status: "VERIFIED" as const, evidence_ids: ["E1"] } },
  { id: "e2", source: "supplier", target: "component", label: "manufactures", data: { status: "POSSIBLE" as const, evidence_ids: ["E2"] } },
  { id: "e3", source: "root", target: "unrelated", label: "mentions", data: { status: "CONFLICTING" as const, evidence_ids: ["E3"] } },
];

describe("buildCascadePaths", () => {
  it("returns direct and indirect paths from existing graph edges", () => {
    const paths = buildCascadePaths(nodes, edges, "root", 2);
    expect(paths.map(path => path.hop).sort()).toEqual([1, 1, 2]);
    expect(paths.find(path => path.edge.id === "e2")?.nodeIds).toEqual(["root", "supplier", "component"]);
    expect(paths.find(path => path.edge.id === "e2")?.indirect).toBe(true);
  });

  it("respects hop depth and relationship status filters", () => {
    expect(buildCascadePaths(nodes, edges, "root", 1)).toHaveLength(2);
    const verified = buildCascadePaths(nodes, edges, "root", 2, "VERIFIED");
    expect(verified).toHaveLength(1);
    expect(verified[0].edge.data?.evidence_ids).toEqual(["E1"]);
  });

  it("returns no fabricated paths for an unknown or disconnected root", () => {
    expect(buildCascadePaths(nodes, edges, "missing", 2)).toEqual([]);
    expect(buildCascadePaths([{ id: "isolated" }], edges, "isolated", 2)).toEqual([]);
  });

  it("preserves original edge direction and evidence IDs", () => {
    const path = buildCascadePaths(nodes, edges, "root", 2).find(item => item.edge.id === "e2");
    expect(path?.from).toBe("supplier");
    expect(path?.to).toBe("component");
    expect(path?.edge.data?.evidence_ids).toEqual(["E2"]);
  });
});
