import { VERSION } from '@jurfi/core';

/** Editor-only code. Must never be imported by samples or exported games. */
export function editorTitle(): string {
  return `Jurfi Editor v${VERSION}`;
}

export {
  BUILTIN_NODES,
  createDefaultRegistry,
  createDemoGraph,
  createEmptyGraph,
  createLocalCommandBus,
  createRegistry,
  deserializeGraph,
  evaluateConnection,
  GraphSchemaError,
  mountNodeGraph,
  serializeGraph,
  stripEditorData,
  validateGraph,
} from './node-graph';
export type {
  Command,
  CommandBus,
  EditorContext,
  GraphClipboard,
  NodeGraphDebugSource,
  NodeGraphHandle,
  NodeGraphOptions,
  NodeTypeDefinition,
  NodeTypeRegistry,
} from './node-graph';
export type {
  GraphComment,
  GraphDocument,
  GraphEdge,
  GraphEndpoint,
  GraphGroup,
  GraphNode,
  GraphPin,
  RuntimeGraphDocument,
} from '@jurfi/script';
