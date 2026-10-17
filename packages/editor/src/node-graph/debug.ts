import type { GraphEdge } from '@jurfi/script';

/** Live values and execution highlights pushed in by a debugger. */
export interface NodeGraphDebugSource {
  /** Node ids currently executing. */
  executingNodeIds?: readonly string[];
  /**
   * Live values keyed by `${fromNode}:${fromPin}->${toNode}:${toPin}`
   * or `${nodeId}:${pinId}`.
   */
  values?: Readonly<Record<string, unknown>>;
  subscribe?(listener: () => void): () => void;
}

export function lookupWireValue(
  values: Readonly<Record<string, unknown>> | undefined,
  edge: GraphEdge,
): unknown {
  if (!values) return undefined;
  const keys = [
    `${edge.from.node}:${edge.from.pin}->${edge.to.node}:${edge.to.pin}`,
    `${edge.from.node}:${edge.from.pin}`,
    `${edge.to.node}:${edge.to.pin}`,
  ];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  }
  return undefined;
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
