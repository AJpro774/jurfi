import type { GraphDoc, GraphEdge, NodeRegistry, PinEndpoint, PinSpec } from '@jurfi/script';
import type { GraphNode } from '@jurfi/script';
import { nodePins } from './registry';

export interface LocatedPin {
  node: GraphNode;
  pin: PinSpec;
}

export type ConnectResult = { ok: true; edge: GraphEdge } | { ok: false; message: string };

export function findPin(doc: GraphDoc, registry: NodeRegistry, endpoint: PinEndpoint): LocatedPin | null {
  const node = doc.nodes.find((item) => item.id === endpoint.node);
  if (!node) return null;
  const pin = nodePins(node, registry).find((item) => item.name === endpoint.pin);
  if (!pin) return null;
  return { node, pin };
}

/**
 * Connection rules:
 * - output → input (either drag direction is accepted and stored canonically)
 * - exec only to exec, data only to data
 * - data types must match, or either side is `any`
 * - an input accepts a single edge (no fan-in); outputs may fan out
 * - exec edges must not introduce a cycle; data cycles are allowed
 */
export function evaluateConnection(
  doc: GraphDoc,
  registry: NodeRegistry,
  a: PinEndpoint,
  b: PinEndpoint,
): ConnectResult {
  const left = findPin(doc, registry, a);
  const right = findPin(doc, registry, b);
  if (!left || !right) return { ok: false, message: 'Unknown node or pin' };
  if (left.node.id === right.node.id && left.pin.name === right.pin.name) {
    return { ok: false, message: 'Cannot connect a pin to itself' };
  }

  let source = left;
  let target = right;
  let sourceEnd = a;
  let targetEnd = b;
  if (left.pin.direction === 'in' && right.pin.direction === 'out') {
    source = right;
    target = left;
    sourceEnd = b;
    targetEnd = a;
  } else if (!(left.pin.direction === 'out' && right.pin.direction === 'in')) {
    return { ok: false, message: 'Connect an output to an input' };
  }

  if (source.pin.kind !== target.pin.kind) {
    return { ok: false, message: `Cannot connect ${source.pin.kind} to ${target.pin.kind}` };
  }
  if (source.pin.kind === 'data') {
    const fromType = source.pin.dataType;
    const toType = target.pin.dataType;
    if (!fromType || !toType) return { ok: false, message: 'Unknown data type' };
    if (fromType !== 'any' && toType !== 'any' && fromType !== toType) {
      return { ok: false, message: `Type mismatch: ${fromType} → ${toType}` };
    }
  }

  const duplicate = doc.edges.some(
    (edge) =>
      edge.from.node === sourceEnd.node &&
      edge.from.pin === sourceEnd.pin &&
      edge.to.node === targetEnd.node &&
      edge.to.pin === targetEnd.pin,
  );
  if (duplicate) return { ok: false, message: 'Already connected' };

  const fanIn = doc.edges.some((edge) => edge.to.node === targetEnd.node && edge.to.pin === targetEnd.pin);
  if (fanIn) return { ok: false, message: 'Input already connected' };

  if (source.pin.kind === 'exec' && createsExecCycle(doc, registry, sourceEnd.node, targetEnd.node)) {
    return { ok: false, message: 'Exec cycle' };
  }

  return {
    ok: true,
    edge: {
      from: { node: sourceEnd.node, pin: sourceEnd.pin },
      to: { node: targetEnd.node, pin: targetEnd.pin },
    },
  };
}

export function createsExecCycle(doc: GraphDoc, registry: NodeRegistry, fromNode: string, toNode: string): boolean {
  if (fromNode === toNode) return true;
  const adjacent = new Map<string, string[]>();
  for (const edge of doc.edges) {
    const source = findPin(doc, registry, edge.from);
    const target = findPin(doc, registry, edge.to);
    if (!source || !target) continue;
    if (source.pin.kind !== 'exec' || target.pin.kind !== 'exec') continue;
    const next = adjacent.get(edge.from.node) ?? [];
    next.push(edge.to.node);
    adjacent.set(edge.from.node, next);
  }
  const seen = new Set<string>();
  const stack = [toNode];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (current === fromNode) return true;
    seen.add(current);
    const next = adjacent.get(current);
    if (next) stack.push(...next);
  }
  return false;
}

/**
 * Validate every edge against the edges accepted before it.
 * Successful edges are rewritten output → input.
 */
export function normalizeConnections(
  doc: GraphDoc,
  registry: NodeRegistry,
): { document: GraphDoc; issues: string[] } {
  const issues: string[] = [];
  const edges: GraphEdge[] = [];
  const partial: GraphDoc = { ...doc, edges };
  for (const edge of doc.edges) {
    const result = evaluateConnection(partial, registry, edge.from, edge.to);
    if (!result.ok) issues.push(result.message);
    else edges.push(edge.id ? { ...result.edge, id: edge.id } : result.edge);
  }
  return { document: { ...doc, edges }, issues };
}

/** Validate every edge against the edges accepted before it. */
export function validateGraph(doc: GraphDoc, registry: NodeRegistry): string[] {
  const issues = [...normalizeConnections(doc, registry).issues];
  if (doc.subgraphs) {
    for (const [id, child] of Object.entries(doc.subgraphs)) {
      for (const issue of validateGraph(child, registry)) issues.push(`${id}: ${issue}`);
    }
  }
  return issues;
}
