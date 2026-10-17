export interface ScriptContext { dt: number }
export type Script = (ctx: ScriptContext) => void;
export function runScripts(scripts: Script[], dt: number): void {
  for (const s of scripts) s({ dt });
}

export { DATA_TYPES, GRAPH_TYPES_STUB, GRAPH_VERSION } from './graph';
export type {
  DataType,
  GraphComment,
  GraphDocument,
  GraphEdge,
  GraphEndpoint,
  GraphGroup,
  GraphNode,
  GraphPin,
  GraphRect,
  PinDirection,
  PinKind,
  RuntimeGraphDocument,
  RuntimeGraphNode,
  Vec2,
} from './graph';
