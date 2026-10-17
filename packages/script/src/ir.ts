/** Compiled, editor-free program executed by the script runtime. */

export interface LiteralInput {
  kind: 'literal';
  value: unknown;
}

export interface LinkInput {
  kind: 'link';
  nodeId: string;
  pin: string;
  wireId: string;
}

export type DataInput = LiteralInput | LinkInput;

export interface ExecLink {
  nodeId: string;
  pin: string;
  wireId: string;
}

export interface CompiledNode {
  id: string;
  typeId: string;
  props: Record<string, unknown>;
  dataIn: Record<string, DataInput>;
  /** Exec output pin name → outgoing links in edge order. */
  execOut: Record<string, ExecLink[]>;
}

export interface CompiledEntries {
  /** `core/OnStart` node ids in document order. */
  start: string[];
  /** `core/OnUpdate` node ids in document order. */
  update: string[];
  /** Custom event name → `core/OnEvent` node ids in document order. */
  event: Record<string, string[]>;
}

export interface CompiledProgram {
  version: 1;
  nodes: Record<string, CompiledNode>;
  entries: CompiledEntries;
  subgraphs: Record<string, CompiledProgram>;
}

export type DiagnosticCode =
  | 'invalid-graph'
  | 'unsupported-version'
  | 'duplicate-node-id'
  | 'unknown-node-type'
  | 'unknown-pin'
  | 'pin-kind-mismatch'
  | 'invalid-direction'
  | 'type-mismatch'
  | 'missing-link'
  | 'duplicate-link'
  | 'data-cycle'
  | 'exec-cycle'
  | 'missing-prop'
  | 'invalid-prop'
  | 'invalid-literal'
  | 'unknown-subgraph'
  | 'invalid-subgraph'
  | 'missing-node'
  | 'unimplemented-node';

/** Compiler diagnostic. `nodeId` is set whenever the issue belongs to a node. */
export interface CompileDiagnostic {
  severity: 'error' | 'warning';
  code: DiagnosticCode;
  message: string;
  nodeId?: string;
  pin?: string;
  edgeIndex?: number;
  /** Path of nested subgraph ids when the issue is not on the root graph. */
  subgraph?: string;
}

export interface CompileResult {
  ok: boolean;
  diagnostics: CompileDiagnostic[];
  /** Null when `diagnostics` contains an error. */
  program: CompiledProgram | null;
  /** Plain JavaScript. Empty when compilation failed. */
  source: string;
}
