export type CascadeStatus = "VERIFIED" | "POSSIBLE" | "CONFLICTING";

export type CascadeGraphNode = {
  id: string;
  data?: { label?: string; status?: CascadeStatus };
};

export type CascadeGraphEdge = {
  id: string;
  source: string;
  target: string;
  data?: {
    label?: string;
    status?: CascadeStatus;
    confidence?: number;
    evidence_ids?: string[];
  };
};

export type CascadePath = {
  id: string;
  hop: 1 | 2;
  nodeIds: string[];
  edgeIds: string[];
  edge: CascadeGraphEdge;
  from: string;
  to: string;
  indirect: boolean;
};

/**
 * Builds one- or two-hop paths from the existing validated graph only.
 * Edges are traversed as connections for exploration, while their original
 * source/target direction and evidence metadata remain unchanged.
 */
export function buildCascadePaths(
  nodes: CascadeGraphNode[],
  edges: CascadeGraphEdge[],
  rootId: string,
  maxHops: 1 | 2 = 2,
  status: CascadeStatus | "ALL" = "ALL",
): CascadePath[] {
  if (!nodes.some(node => node.id === rootId)) return [];

  const allowedEdges = edges.filter(edge => status === "ALL" || edge.data?.status === status);
  const adjacency = new Map<string, { edge: CascadeGraphEdge; neighbor: string }[]>();
  for (const edge of allowedEdges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), { edge, neighbor: edge.target }]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), { edge, neighbor: edge.source }]);
  }

  const queue: { nodeId: string; depth: 0 | 1; nodeIds: string[]; edgeIds: string[] }[] = [
    { nodeId: rootId, depth: 0, nodeIds: [rootId], edgeIds: [] },
  ];
  const visited = new Set([rootId]);
  const paths: CascadePath[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const connection of adjacency.get(current.nodeId) ?? []) {
      const nextDepth = (current.depth + 1) as 1 | 2;
      if (nextDepth > maxHops) continue;
      if (current.nodeIds.includes(connection.neighbor)) continue;
      const nextNodeIds = [...current.nodeIds, connection.neighbor];
      const nextEdgeIds = [...current.edgeIds, connection.edge.id];
      const pathKey = `${connection.edge.id}:${nextNodeIds.join(">")}`;
      paths.push({
        id: pathKey,
        hop: nextDepth,
        nodeIds: nextNodeIds,
        edgeIds: nextEdgeIds,
        edge: connection.edge,
        from: connection.edge.source,
        to: connection.edge.target,
        indirect: nextDepth === 2,
      });
      if (nextDepth === 1 && !visited.has(connection.neighbor)) {
        visited.add(connection.neighbor);
        queue.push({ nodeId: connection.neighbor, depth: 1, nodeIds: nextNodeIds, edgeIds: nextEdgeIds });
      }
    }
  }

  return paths.filter((path, index, all) => all.findIndex(candidate => candidate.edge.id === path.edge.id && candidate.hop === path.hop) === index);
}
