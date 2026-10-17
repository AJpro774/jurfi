import type { GraphComment, GraphDoc, GraphEdge, GraphGroup, GraphNode, GraphPoint } from '@jurfi/script';
import { commentRect, groupRect, nodePos, rectFields, type GraphRect } from './geometry';

export interface GraphClipboard {
  nodes: GraphNode[];
  edges: GraphEdge[];
  comments: GraphComment[];
  groups: GraphGroup[];
}

export function extractClipboard(
  doc: GraphDoc,
  nodeIds: readonly string[],
  commentIds: readonly string[],
  groupIds: readonly string[],
): GraphClipboard {
  const nodes = new Set(nodeIds);
  const comments = new Set(commentIds);
  const groups = new Set(groupIds);
  return {
    nodes: doc.nodes.filter((node) => nodes.has(node.id)).map((node) => structuredClone(node)),
    edges: doc.edges
      .filter((edge) => nodes.has(edge.from.node) && nodes.has(edge.to.node))
      .map((edge) => structuredClone(edge)),
    comments: (doc.comments ?? []).filter((comment) => comments.has(comment.id)).map((comment) => structuredClone(comment)),
    groups: (doc.groups ?? [])
      .filter((group) => groups.has(group.id))
      .map((group) => ({
        ...structuredClone(group),
        nodeIds: (group.nodeIds ?? []).filter((id) => nodes.has(id)),
      })),
  };
}

export function pasteClipboard(
  draft: GraphDoc,
  clipboard: GraphClipboard,
  offset: GraphPoint,
  idFor: (prefix: string) => string,
): { nodes: string[]; comments: string[]; groups: string[] } {
  const nodeMap = new Map<string, string>();
  const created = { nodes: [] as string[], comments: [] as string[], groups: [] as string[] };
  for (const node of clipboard.nodes) {
    const id = idFor('node');
    nodeMap.set(node.id, id);
    created.nodes.push(id);
    const pos = nodePos(node);
    draft.nodes.push({
      ...structuredClone(node),
      id,
      pos: { x: pos.x + offset.x, y: pos.y + offset.y },
    });
  }
  for (const edge of clipboard.edges) {
    const fromNode = nodeMap.get(edge.from.node);
    const toNode = nodeMap.get(edge.to.node);
    if (!fromNode || !toNode) continue;
    draft.edges.push({
      id: idFor('edge'),
      from: { node: fromNode, pin: edge.from.pin },
      to: { node: toNode, pin: edge.to.pin },
    });
  }
  draft.comments = draft.comments ?? [];
  for (const comment of clipboard.comments) {
    const id = idFor('comment');
    created.comments.push(id);
    const laid = rectFields(offsetRect(commentRect(comment), offset));
    draft.comments.push({ ...structuredClone(comment), id, pos: laid.pos, size: laid.size });
  }
  draft.groups = draft.groups ?? [];
  for (const group of clipboard.groups) {
    const id = idFor('group');
    created.groups.push(id);
    const laid = rectFields(offsetRect(groupRect(group), offset));
    draft.groups.push({
      ...structuredClone(group),
      id,
      nodeIds: (group.nodeIds ?? []).flatMap((nodeId) => {
        const next = nodeMap.get(nodeId);
        return next ? [next] : [];
      }),
      pos: laid.pos,
      size: laid.size,
    });
  }
  return created;
}

function offsetRect(rect: GraphRect, offset: GraphPoint): GraphRect {
  return { ...rect, x: rect.x + offset.x, y: rect.y + offset.y };
}
