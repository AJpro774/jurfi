/**
 * @stub PROVISIONAL graph contract.
 *
 * The Script Compiler has not published these types yet (nothing on main
 * beyond `Script` / `runScripts`). This file is the schema the node graph
 * editor imports from `@jurfi/script` so the two sides share one definition.
 * Replace it when the compiler owns the schema. `GRAPH_TYPES_STUB` stays
 * `true` until that happens.
 *
 * Agreed document shape:
 * `{ version, nodes:[{ id, type, pins, props, pos:{x,y} }], edges:[{ from:{node,pin}, to:{node,pin} }], groups, comments }`
 *
 * Pins carry a separate `exec` | `data` kind. `pos`, `groups`, and `comments`
 * are editor-only and must be stripped before a game export (see
 * `RuntimeGraphDocument`).
 */

export const GRAPH_TYPES_STUB = true;

export const GRAPH_VERSION = 1;

export const DATA_TYPES = ['bool', 'number', 'string', 'vec2', 'vec3', 'object', 'any'] as const;

export type DataType = (typeof DATA_TYPES)[number];

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
  type: string;
  pins: GraphPin[];
  props: Record<string, unknown>;
  /** Editor-only. Strip on export. */
  pos: Vec2;
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
}
