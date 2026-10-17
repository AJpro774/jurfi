/**
 * @stub Graph contract recorded from the Script Compiler decision.
 *
 * The compiler has not published a module yet, so these types still live
 * here and `GRAPH_TYPES_STUB` stays `true`. The editor imports them from
 * `@jurfi/script` instead of keeping a private copy.
 *
 * Document shape:
 * `{ version, nodes:[{ id, type, pins, props, pos?:{x,y} }], edges:[{ id?, from:{node,pin}, to:{node,pin} }], groups, comments, subgraphs? }`
 *
 * `type` is a type id such as `core/Add`. Connections are `edges`, not wires.
 * `pos`, `groups`, and `comments` are editor-only. `subgraphs` is an optional
 * map of nested documents keyed by id. `stripEditorData` removes editor-only
 * data, including inside nested subgraphs.
 *
 * Pin kinds are `exec` | `data`. `dataType` is an open string so another
 * domain (a blend tree, for example) can name its own types. `any` matches
 * every data type.
 */

export const GRAPH_TYPES_STUB = true;

export const GRAPH_VERSION = 1;

/** Script builtins. Other domains may use their own data-type strings. `any` matches every type. */
export const DATA_TYPES = ['bool', 'number', 'string', 'vec2', 'vec3', 'object', 'any'] as const;

export type DataType = string;

export type PinKind = 'exec' | 'data';

export type PinDirection = 'in' | 'out';

export interface GraphPin {
  id: string;
  name: string;
  kind: PinKind;
  direction: PinDirection;
  /** Present on data pins. Exec pins omit it. */
  dataType?: DataType;
}

export interface GraphEndpoint {
  node: string;
  pin: string;
}

export interface GraphEdge {
  /**
   * Stable id a debugger uses as `wireId`.
   * When omitted, callers derive `${from.node}:${from.pin}->${to.node}:${to.pin}`.
   */
  id?: string;
  from: GraphEndpoint;
  to: GraphEndpoint;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Editor-only layout rectangle (groups and comments). */
export interface GraphRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GraphNode {
  id: string;
  /** Type id, for example `core/Add`. */
  type: string;
  pins: GraphPin[];
  props: Record<string, unknown>;
  /** Editor-only canvas position. Omitted on a runtime document. */
  pos?: Vec2;
}

/** Editor-only. Strip on export. */
export interface GraphGroup {
  id: string;
  title: string;
  nodeIds: string[];
  rect: GraphRect;
}

/** Editor-only. Strip on export. */
export interface GraphComment {
  id: string;
  text: string;
  rect: GraphRect;
}

export interface GraphDocument {
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
  comments: GraphComment[];
  /** Nested graphs keyed by id. Each value is a full document. */
  subgraphs?: Record<string, GraphDocument>;
}

/** Compiler-facing node: layout removed. */
export interface RuntimeGraphNode {
  id: string;
  type: string;
  pins: GraphPin[];
  props: Record<string, unknown>;
}

/** Compiler-facing document: `pos`, `groups`, and `comments` removed. */
export interface RuntimeGraphDocument {
  version: number;
  nodes: RuntimeGraphNode[];
  edges: GraphEdge[];
  subgraphs?: Record<string, RuntimeGraphDocument>;
}
