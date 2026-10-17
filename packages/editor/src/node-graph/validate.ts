import { DATA_TYPES } from '@jurfi/script';
import type { GraphDocument, GraphEdge, GraphEndpoint, GraphNode, GraphPin } from '@jurfi/script';

const DATA_TYPE_SET = new Set<string>(DATA_TYPES);

export interface LocatedPin {
  node: GraphNode;
  pin: GraphPin;
}

export type ConnectResult = { ok: true; edge: GraphEdge } | { ok: false; message: string };

export function findPin(doc: GraphDocument, endpoint: GraphEndpoint): LocatedPin | null {
  const node = doc.nodes.find((item) => item.id === endpoint.node);
  if (!node) return null;
  const pin = node.pins.find((item) => item.id === endpoint.pin);
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
export function evaluateConnection(doc: GraphDocument, a: GraphEndpoint, b: GraphEndpoint): ConnectResult {
  const left = findPin(doc, a);
  const right = findPin(doc, b);
  if (!left || !right) return { ok: false, message: 'Unknown node or pin' };
  if (left.node.id === right.node.id && left.pin.id === right.pin.id) {
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
    const fromType = source.pin.dataType ?? 'any';
    const toType = target.pin.dataType ?? 'any';
    if (!DATA_TYPE_SET.has(fromType) || !DATA_TYPE_SET.has(toType)) {
      return { ok: false, message: 'Unknown data type' };
    }
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

  if (source.pin.kind === 'exec' && createsExecCycle(doc, sourceEnd.node, targetEnd.node)) {
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

export function createsExecCycle(doc: GraphDocument, fromNode: string, toNode: string): boolean {
  if (fromNode === toNode) return true;
  const adjacent = new Map<string, string[]>();
  for (const edge of doc.edges) {
    const source = findPin(doc, edge.from);
    const target = findPin(doc, edge.to);
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
export function normalizeConnections(doc: GraphDocument): { document: GraphDocument; issues: string[] } {
  const issues: string[] = [];
  const edges: GraphEdge[] = [];
  const partial: GraphDocument = { ...doc, edges };
  for (const edge of doc.edges) {
    const result = evaluateConnection(partial, edge.from, edge.to);
    if (!result.ok) issues.push(result.message);
    else edges.push(result.edge);
  }
  return { document: { ...doc, edges }, issues };
}

/** Validate every edge against the edges accepted before it. */
export function validateGraph(doc: GraphDocument): string[] {
  return normalizeConnections(doc).issues;
}
