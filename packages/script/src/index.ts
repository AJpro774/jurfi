export type { Script, ScriptContext } from './callback';
export { runScripts } from './callback';

export type {
  DataType,
  GraphComment,
  GraphDoc,
  GraphEdge,
  GraphGroup,
  GraphNode,
  GraphPoint,
  NodePins,
  PinEndpoint,
  PinKind,
  PinValue,
  VariableScope,
} from './schema';
export {
  DATA_TYPES,
  GRAPH_VERSION,
  PIN_KINDS,
  VARIABLE_SCOPES,
  readInstancePin,
  stripEditorData,
} from './schema';

export type { NodeDef, PinSpec, VariadicExecOut } from './registry';
export { NodeRegistry, createNodeRegistry } from './registry';

export {
  builtinNodeDefs,
  createBuiltinRegistry,
  registerBuiltinNodes,
  resolvePins,
} from './builtins';

export type {
  CompiledEntries,
  CompiledNode,
  CompiledProgram,
  CompileDiagnostic,
  CompileResult,
  DataInput,
  DiagnosticCode,
  ExecLink,
  LinkInput,
  LiteralInput,
} from './ir';
export { compile, emitJavaScript } from './compile';

export type { EntityRef, MemoryWorld, ScriptWorld } from './world';
export { coreGaps, createMemoryWorld } from './world';

export type {
  DebugEvent,
  DebugNodeEvent,
  DebugPhase,
  DebugSource,
  DebugWireEvent,
  RuntimeErrorCode,
  ScriptRuntime,
  ScriptRuntimeOptions,
} from './runtime';
export { ScriptRuntimeError, createScriptRuntime } from './runtime';
