import { cloneJson } from './util';

/** Graph document schema implemented by this package. */
export const GRAPH_VERSION = 1 as const;

export const PIN_KINDS = ['exec', 'data'] as const;
export type PinKind = (typeof PIN_KINDS)[number];

export const DATA_TYPES = ['bool', 'number', 'string', 'entity', 'any'] as const;
export type DataType = (typeof DATA_TYPES)[number];

export const VARIABLE_SCOPES = ['graph', 'entity'] as const;
export type VariableScope = (typeof VARIABLE_SCOPES)[number];

/** Canvas point. Editor-only when stored on a node as `pos`. */
export interface GraphPoint {
  x: number;
  y: number;
}

/** One end of an edge. `pin` is the pin name on `node`. */
export interface PinEndpoint {
  node: string;
  pin: string;
}

/**
 * Literal stored on an input pin.
 * The Node Graph UI may also write a bare JSON literal instead of this object;
 * both forms are accepted by the compiler.
 */
export interface PinValue {
  value?: unknown;
  /** Optional annotation for dynamic pins. Spec types win when the pin is declared. */
  dataType?: DataType;
}

export type NodePins = Record<string, PinValue | unknown>;

export interface GraphNode {
  id: string;
  /** Stable type id, for example `core/Add`. */
  type: string;
  /** Per-pin literals and optional dynamic-pin annotations. */
  pins?: NodePins;
  /** Node configuration (variable name, component, event, ...). */
  props?: Record<string, unknown>;
  /** Editor-only canvas position. Ignored by the compiler. */
  pos?: GraphPoint;
}

export interface GraphEdge {
  /** Stable id for debug wire events. Generated when omitted. */
  id?: string;
  from: PinEndpoint;
  to: PinEndpoint;
}

/** Editor-only grouping rectangle. Ignored by the compiler. */
export interface GraphGroup {
  id: string;
  title?: string;
  nodeIds?: string[];
  color?: string;
  pos?: GraphPoint;
  size?: { width: number; height: number };
  [extra: string]: unknown;
}

/** Editor-only comment card. Ignored by the compiler. */
export interface GraphComment {
  id: string;
  text?: string;
  pos?: GraphPoint;
  size?: { width: number; height: number };
  [extra: string]: unknown;
}

/**
 * Visual script document shared with the Node Graph UI.
 * `subgraphs` values are nested graph documents. `groups` and `comments` are editor-only.
 */
export interface GraphDoc {
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraphs?: Record<string, GraphDoc>;
  groups?: GraphGroup[];
  comments?: GraphComment[];
}

/**
 * Read a literal written on a node instance.
 * `{ value, dataType? }` is the structured form; bare JSON literals are also accepted.
 * A pin object that only sets `dataType` is an annotation, not a literal.
 */
export function readInstancePin(
  pins: NodePins | undefined,
  name: string,
): { present: boolean; value: unknown } {
  if (!pins || !Object.prototype.hasOwnProperty.call(pins, name)) {
    return { present: false, value: undefined };
  }
  const raw = pins[name];
  if (isPinValue(raw)) {
    if (Object.prototype.hasOwnProperty.call(raw, 'value')) {
      return { present: true, value: raw.value };
    }
    return { present: false, value: undefined };
  }
  return { present: true, value: raw };
}

function isPinValue(raw: unknown): raw is PinValue {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const keys = Object.keys(raw);
  return keys.length > 0 && keys.every((key) => key === 'value' || key === 'dataType');
}

/**
 * Copy a graph with editor-only data removed: node `pos`, `groups`, `comments`,
 * and any other fields outside the runtime document. Nested subgraphs are stripped too.
 * The input document is not mutated.
 */
export function stripEditorData(doc: GraphDoc): GraphDoc {
  const out: GraphDoc = {
    version: doc.version,
    nodes: doc.nodes.map((node) => {
      const copy: GraphNode = { id: node.id, type: node.type };
      if (node.pins !== undefined) copy.pins = cloneJson(node.pins);
      if (node.props !== undefined) copy.props = cloneJson(node.props);
      return copy;
    }),
    edges: doc.edges.map((edge) => {
      const copy: GraphEdge = {
        from: { node: edge.from.node, pin: edge.from.pin },
        to: { node: edge.to.node, pin: edge.to.pin },
      };
      if (edge.id !== undefined) copy.id = edge.id;
      return copy;
    }),
  };
  if (doc.subgraphs) {
    const subgraphs: Record<string, GraphDoc> = {};
    for (const [id, child] of Object.entries(doc.subgraphs)) {
      subgraphs[id] = stripEditorData(child);
    }
    out.subgraphs = subgraphs;
  }
  return out;
}
