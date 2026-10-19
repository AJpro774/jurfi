import type { GraphDoc, GraphEdge, GraphNode } from '../schema';

export function n(id: string, type: string, extra?: Partial<GraphNode>): GraphNode {
  return { id, type, ...extra };
}

export function e(
  from: string,
  fromPin: string,
  to: string,
  toPin: string,
  id?: string,
): GraphEdge {
  const edge: GraphEdge = {
    from: { node: from, pin: fromPin },
    to: { node: to, pin: toPin },
  };
  if (id !== undefined) edge.id = id;
  return edge;
}

export function g(
  nodes: GraphNode[],
  edges: GraphEdge[],
  extra?: Partial<GraphDoc>,
): GraphDoc {
  return { version: 1, nodes, edges, ...extra };
}
