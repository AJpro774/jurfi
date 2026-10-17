import type { GraphEdge } from '@jurfi/script';

/** A live wire value. `wireId` is `edge.id`, or the endpoint key when the edge has no id. */
export interface DebugWireEvent {
  kind: 'wire';
  wireId: string;
  value: unknown;
}

/** A node execution highlight. `enter` marks the node; `exit` clears it. */
export interface DebugNodeEvent {
  kind: 'node';
  nodeId: string;
  phase: 'enter' | 'exit';
}

export type DebugEvent = DebugWireEvent | DebugNodeEvent;

/** Push debugger events. The canvas applies each event as it arrives. */
export interface DebugSource {
  subscribe(listener: (event: DebugEvent) => void): () => void;
}

export interface DebugOverlay {
  executing: Set<string>;
  values: Map<string, unknown>;
}

export function createDebugOverlay(): DebugOverlay {
  return { executing: new Set(), values: new Map() };
}

export function applyDebugEvent(overlay: DebugOverlay, event: DebugEvent): void {
  if (event.kind === 'node') {
    if (event.phase === 'enter') overlay.executing.add(event.nodeId);
    else overlay.executing.delete(event.nodeId);
    return;
  }
  overlay.values.set(event.wireId, event.value);
}

/** Id a `{ kind: 'wire' }` event uses for this edge. */
export function edgeWireId(edge: GraphEdge): string {
  return edge.id ?? `${edge.from.node}:${edge.from.pin}->${edge.to.node}:${edge.to.pin}`;
}

export function formatDebugValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return clip(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  try {
    return clip(JSON.stringify(value));
  } catch {
    return '';
  }
}

function clip(text: string): string {
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}
