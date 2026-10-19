import { resolvePins } from './builtins';
import { emitProgram } from './emit';
import { getNodeHandler } from './handlers';
import type {
  CompiledNode,
  CompiledProgram,
  CompileDiagnostic,
  CompileResult,
  DataInput,
  DiagnosticCode,
} from './ir';
import type { NodeDef, NodeRegistry, PinSpec } from './registry';
import { GRAPH_VERSION, readInstancePin, type DataType, type GraphDoc, type GraphNode } from './schema';
import { isJsonValue, propString } from './util';
import { componentNames } from './world';

const ENTRY_TYPES = new Set(['core/OnStart', 'core/OnUpdate', 'core/OnEvent']);

/**
 * Compile a graph document into an interpretable program and plain JavaScript.
 * Editor fields (`pos`, `groups`, `comments`) are ignored. The JavaScript imports
 * `createScriptHost` from `@jurfi/script/host` and, when the graph uses `core/Clamp`, `@jurfi/core`.
 * It does not import the graph interpreter.
 * Diagnostics are keyed by `nodeId` whenever the issue belongs to a node.
 * `compile` does not throw for an invalid graph.
 */
export function compile(doc: GraphDoc, registry: NodeRegistry): CompileResult {
  const diagnostics: CompileDiagnostic[] = [];
  const program = compileGraph(doc, registry, diagnostics, undefined, undefined);
  const ok = program !== null && !diagnostics.some((diag) => diag.severity === 'error');
  if (!ok || !program) {
    return { ok: false, diagnostics, program: null, source: '' };
  }
  return { ok: true, diagnostics, program, source: emitJavaScript(program) };
}

/** Plain JavaScript that runs `program` on the compiled host, without the interpreter. */
export function emitJavaScript(program: CompiledProgram): string {
  return emitProgram(program);
}

function compileGraph(
  doc: GraphDoc,
  registry: NodeRegistry,
  diagnostics: CompileDiagnostic[],
  subgraph: string | undefined,
  inheritedVersion: number | undefined,
): CompiledProgram | null {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) {
    report(diagnostics, subgraph, 'error', 'invalid-graph', 'Graph must have nodes and edges arrays');
    return null;
  }

  const version = doc.version ?? inheritedVersion;
  if (version !== GRAPH_VERSION) {
    report(
      diagnostics,
      subgraph,
      'error',
      'unsupported-version',
      `Unsupported graph version ${String(version)} (expected ${GRAPH_VERSION})`,
    );
  }

  const program: CompiledProgram = {
    version: 1,
    nodes: {},
    entries: { start: [], update: [], event: {} },
    subgraphs: {},
  };

  interface Built {
    node: GraphNode;
    def: NodeDef;
    pins: PinSpec[];
    pinByName: Map<string, PinSpec>;
    compiled: CompiledNode;
  }

  const built = new Map<string, Built>();
  const seen = new Set<string>();

  for (const node of doc.nodes) {
    if (!node || typeof node.id !== 'string' || node.id === '') {
      report(diagnostics, subgraph, 'error', 'invalid-graph', 'Graph node is missing an id');
      continue;
    }
    if (seen.has(node.id)) {
      report(diagnostics, subgraph, 'error', 'duplicate-node-id', `Duplicate node id "${node.id}"`, {
        nodeId: node.id,
      });
      continue;
    }
    seen.add(node.id);
    if (typeof node.type !== 'string' || node.type === '') {
      report(diagnostics, subgraph, 'error', 'unknown-node-type', `Node "${node.id}" is missing a type`, {
        nodeId: node.id,
      });
      continue;
    }
    const def = registry.get(node.type);
    if (!def) {
      report(
        diagnostics,
        subgraph,
        'error',
        'unknown-node-type',
        `Unknown node type "${node.type}" on node "${node.id}"`,
        { nodeId: node.id },
      );
      continue;
    }

    const propsResult = normalizeProps(node.props);
    if (!propsResult.ok) {
      report(
        diagnostics,
        subgraph,
        'error',
        'invalid-prop',
        `Node "${node.id}" props must be JSON values`,
        { nodeId: node.id },
      );
    }
    const props = propsResult.ok ? propsResult.value : {};
    checkProps(diagnostics, subgraph, node, def, props, doc);

    const pins = resolvePins(def, props);
    const pinByName = new Map(pins.map((pin) => [pin.name, pin]));
    const dataIn: Record<string, DataInput> = {};
    for (const pin of pins) {
      if (pin.kind !== 'data' || pin.direction !== 'in') continue;
      if (pin.default !== undefined) dataIn[pin.name] = { kind: 'literal', value: pin.default };
      const literal = readInstancePin(node.pins, pin.name);
      if (!literal.present) continue;
      if (!isJsonValue(literal.value)) {
        report(
          diagnostics,
          subgraph,
          'error',
          'invalid-literal',
          `Node "${node.id}" pin "${pin.name}" literal must be a JSON value`,
          { nodeId: node.id, pin: pin.name },
        );
        continue;
      }
      dataIn[pin.name] = { kind: 'literal', value: literal.value };
    }

    const compiled: CompiledNode = { id: node.id, typeId: node.type, props, dataIn, execOut: {} };
    program.nodes[node.id] = compiled;
    built.set(node.id, { node, def, pins, pinByName, compiled });

    if (!getNodeHandler(node.type)) {
      report(
        diagnostics,
        subgraph,
        'warning',
        'unimplemented-node',
        `Node "${node.id}" type "${node.type}" has no script runtime handler; exec passes through "then"`,
        { nodeId: node.id },
      );
    }

    if (node.type === 'core/OnStart') program.entries.start.push(node.id);
    else if (node.type === 'core/OnUpdate') program.entries.update.push(node.id);
    else if (node.type === 'core/OnEvent') {
      const name = propString(props, 'event') || propString(props, 'name');
      if (name) {
        const list = program.entries.event[name] ?? [];
        list.push(node.id);
        program.entries.event[name] = list;
      }
    }
  }

  const connectedExecIn = new Set<string>();

  doc.edges.forEach((edge, index) => {
    if (!edge || !edge.from || !edge.to) {
      report(diagnostics, subgraph, 'error', 'invalid-graph', `Edge ${index} is missing endpoints`, {
        edgeIndex: index,
      });
      return;
    }
    const fromBuilt = built.get(edge.from.node);
    const toBuilt = built.get(edge.to.node);
    if (!fromBuilt) {
      report(
        diagnostics,
        subgraph,
        'error',
        'missing-node',
        `Edge ${index} leaves missing node "${edge.from.node}"`,
        { nodeId: toBuilt ? edge.to.node : edge.from.node, edgeIndex: index },
      );
    }
    if (!toBuilt) {
      report(
        diagnostics,
        subgraph,
        'error',
        'missing-node',
        `Edge ${index} enters missing node "${edge.to.node}"`,
        { nodeId: fromBuilt ? edge.from.node : edge.to.node, edgeIndex: index },
      );
    }
    if (!fromBuilt || !toBuilt) return;

    const fromPin = fromBuilt.pinByName.get(edge.from.pin);
    const toPin = toBuilt.pinByName.get(edge.to.pin);
    if (!fromPin) {
      report(
        diagnostics,
        subgraph,
        'error',
        'unknown-pin',
        `Node "${edge.from.node}" has no pin "${edge.from.pin}"`,
        { nodeId: edge.from.node, pin: edge.from.pin, edgeIndex: index },
      );
    }
    if (!toPin) {
      report(
        diagnostics,
        subgraph,
        'error',
        'unknown-pin',
        `Node "${edge.to.node}" has no pin "${edge.to.pin}"`,
        { nodeId: edge.to.node, pin: edge.to.pin, edgeIndex: index },
      );
    }
    if (!fromPin || !toPin) return;

    if (fromPin.kind !== toPin.kind) {
      report(
        diagnostics,
        subgraph,
        'error',
        'pin-kind-mismatch',
        `Edge ${index} connects ${fromPin.kind} pin "${edge.from.node}.${edge.from.pin}" to ${toPin.kind} pin "${edge.to.node}.${edge.to.pin}"`,
        { nodeId: edge.to.node, pin: edge.to.pin, edgeIndex: index },
      );
      return;
    }
    if (fromPin.direction !== 'out' || toPin.direction !== 'in') {
      report(
        diagnostics,
        subgraph,
        'error',
        'invalid-direction',
        `Edge ${index} must leave an output pin and enter an input pin (${edge.from.node}.${edge.from.pin} → ${edge.to.node}.${edge.to.pin})`,
        { nodeId: edge.from.node, pin: edge.from.pin, edgeIndex: index },
      );
      return;
    }

    const wireId =
      edge.id ?? `${edge.from.node}.${edge.from.pin}->${edge.to.node}.${edge.to.pin}#${index}`;

    if (fromPin.kind === 'exec') {
      const list = fromBuilt.compiled.execOut[fromPin.name] ?? [];
      list.push({ nodeId: edge.to.node, pin: edge.to.pin, wireId });
      fromBuilt.compiled.execOut[fromPin.name] = list;
      connectedExecIn.add(`${edge.to.node}\0${edge.to.pin}`);
      return;
    }

    const existing = toBuilt.compiled.dataIn[toPin.name];
    if (existing?.kind === 'link') {
      report(
        diagnostics,
        subgraph,
        'error',
        'duplicate-link',
        `Node "${edge.to.node}" pin "${toPin.name}" already has a data link`,
        { nodeId: edge.to.node, pin: toPin.name, edgeIndex: index },
      );
      return;
    }
    if (!typesCompatible(fromPin.dataType ?? 'any', toPin.dataType ?? 'any')) {
      report(
        diagnostics,
        subgraph,
        'error',
        'type-mismatch',
        `Type mismatch on node "${edge.to.node}" pin "${toPin.name}": expected ${toPin.dataType ?? 'any'}, got ${fromPin.dataType ?? 'any'} from node "${edge.from.node}" pin "${fromPin.name}"`,
        { nodeId: edge.to.node, pin: toPin.name, edgeIndex: index },
      );
      return;
    }
    toBuilt.compiled.dataIn[toPin.name] = {
      kind: 'link',
      nodeId: edge.from.node,
      pin: edge.from.pin,
      wireId,
    };
  });

  for (const item of built.values()) {
    for (const pin of item.pins) {
      if (pin.kind === 'data' && pin.direction === 'in' && pin.required && !item.compiled.dataIn[pin.name]) {
        report(
          diagnostics,
          subgraph,
          'error',
          'missing-link',
          `Node "${item.node.id}" pin "${pin.name}" is missing a link and has no literal`,
          { nodeId: item.node.id, pin: pin.name },
        );
      }
      if (
        pin.kind === 'exec' &&
        pin.direction === 'in' &&
        !ENTRY_TYPES.has(item.node.type) &&
        !connectedExecIn.has(`${item.node.id}\0${pin.name}`)
      ) {
        report(
          diagnostics,
          subgraph,
          'warning',
          'missing-link',
          `Node "${item.node.id}" exec input "${pin.name}" is not connected`,
          { nodeId: item.node.id, pin: pin.name },
        );
      }
    }
  }

  const ids = [...built.keys()];
  reportCycles(diagnostics, subgraph, 'data-cycle', 'Data cycle', ids, (id) => {
    const item = built.get(id);
    if (!item) return [];
    const deps: string[] = [];
    for (const input of Object.values(item.compiled.dataIn)) {
      if (input.kind === 'link' && !deps.includes(input.nodeId)) deps.push(input.nodeId);
    }
    return deps;
  });
  reportCycles(diagnostics, subgraph, 'exec-cycle', 'Exec cycle', ids, (id) => {
    const item = built.get(id);
    if (!item) return [];
    const next: string[] = [];
    for (const links of Object.values(item.compiled.execOut)) {
      for (const link of links) {
        if (!next.includes(link.nodeId)) next.push(link.nodeId);
      }
    }
    return next;
  });

  if (doc.subgraphs) {
    for (const [id, child] of Object.entries(doc.subgraphs)) {
      const childPath = subgraph ? `${subgraph}/${id}` : id;
      if (!child || typeof child !== 'object' || !Array.isArray(child.nodes) || !Array.isArray(child.edges)) {
        report(diagnostics, childPath, 'error', 'invalid-subgraph', `Subgraph "${id}" is not a graph document`);
        continue;
      }
      const compiledChild = compileGraph(child, registry, diagnostics, childPath, version === GRAPH_VERSION ? GRAPH_VERSION : undefined);
      if (compiledChild) program.subgraphs[id] = compiledChild;
    }
  }

  return program;
}

function checkProps(
  diagnostics: CompileDiagnostic[],
  subgraph: string | undefined,
  node: GraphNode,
  def: NodeDef,
  props: Record<string, unknown>,
  doc: GraphDoc,
): void {
  const need = (key: string, label = key): void => {
    const value = props[key];
    if (typeof value !== 'string' || value === '') {
      report(diagnostics, subgraph, 'error', 'missing-prop', `Node "${node.id}" is missing required prop "${label}"`, {
        nodeId: node.id,
      });
    }
  };

  switch (def.typeId) {
    case 'core/GetVariable':
    case 'core/SetVariable':
      need('name');
      break;
    case 'core/GetComponent':
    case 'core/SetComponent':
    case 'core/AddComponent':
    case 'core/RemoveComponent':
    case 'core/HasComponent':
      need('component');
      break;
    case 'core/Query': {
      const hasPin = node.pins !== undefined && Object.prototype.hasOwnProperty.call(node.pins, 'components');
      const linked = doc.edges.some((edge) => edge?.to?.node === node.id && edge.to.pin === 'components');
      if (!hasPin && !linked && componentNames(props.components).length === 0) {
        report(
          diagnostics,
          subgraph,
          'error',
          props.components === undefined ? 'missing-prop' : 'invalid-prop',
          `Node "${node.id}" needs props.components with at least one component name`,
          { nodeId: node.id },
        );
      }
      break;
    }
    case 'core/GetField':
    case 'core/SetField':
      need('component');
      need('field');
      break;
    case 'core/OnEvent':
      if (!propString(props, 'event') && !propString(props, 'name')) {
        report(
          diagnostics,
          subgraph,
          'error',
          'missing-prop',
          `Node "${node.id}" is missing required prop "event"`,
          { nodeId: node.id },
        );
      }
      break;
    case 'core/FireEvent': {
      const hasProp = propString(props, 'event') !== '' || propString(props, 'name') !== '';
      const hasPin = node.pins !== undefined && Object.prototype.hasOwnProperty.call(node.pins, 'event');
      const linked = doc.edges.some((edge) => edge?.to?.node === node.id && edge.to.pin === 'event');
      if (!hasProp && !hasPin && !linked) {
        report(
          diagnostics,
          subgraph,
          'error',
          'missing-prop',
          `Node "${node.id}" needs props.event or an event input`,
          { nodeId: node.id },
        );
      }
      break;
    }
    case 'core/Subgraph': {
      const graphId = propString(props, 'graph');
      if (!graphId) {
        need('graph');
      } else if (!doc.subgraphs || !Object.prototype.hasOwnProperty.call(doc.subgraphs, graphId)) {
        report(
          diagnostics,
          subgraph,
          'error',
          'unknown-subgraph',
          `Node "${node.id}" references unknown subgraph "${graphId}"`,
          { nodeId: node.id },
        );
      }
      break;
    }
    default:
      break;
  }

  if (props.scope !== undefined && props.scope !== 'graph' && props.scope !== 'entity') {
    report(
      diagnostics,
      subgraph,
      'error',
      'invalid-prop',
      `Node "${node.id}" prop "scope" must be "graph" or "entity"`,
      { nodeId: node.id },
    );
  }

  const variadic = def.variadicExecOut;
  if (variadic && props[variadic.countProp] !== undefined) {
    const raw = props[variadic.countProp];
    const min = variadic.min ?? 1;
    const max = variadic.max ?? 32;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
      report(
        diagnostics,
        subgraph,
        'error',
        'invalid-prop',
        `Node "${node.id}" prop "${variadic.countProp}" must be an integer from ${min} to ${max}`,
        { nodeId: node.id },
      );
    }
  }
}

function normalizeProps(
  props: Record<string, unknown> | undefined,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (props === undefined) return { ok: true, value: {} };
  if (!isJsonValue(props) || props === null || typeof props !== 'object' || Array.isArray(props)) {
    return { ok: false };
  }
  return { ok: true, value: JSON.parse(JSON.stringify(props)) as Record<string, unknown> };
}

function typesCompatible(from: DataType, to: DataType): boolean {
  return from === to || from === 'any' || to === 'any';
}

function reportCycles(
  diagnostics: CompileDiagnostic[],
  subgraph: string | undefined,
  code: DiagnosticCode,
  label: string,
  ids: string[],
  next: (id: string) => string[],
): void {
  const cycles = findCycles(ids, next);
  const seen = new Set<string>();
  for (const cycle of cycles) {
    const first = cycle[0];
    if (first === undefined) continue;
    const path = [...cycle, first].join(' → ');
    for (const id of cycle) {
      const key = `${code}\0${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      report(diagnostics, subgraph, 'error', code, `${label} through node "${id}": ${path}`, { nodeId: id });
    }
  }
}

function findCycles(ids: string[], next: (id: string) => string[]): string[][] {
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const dfs = (id: string): void => {
    color.set(id, 1);
    stack.push(id);
    for (const target of next(id)) {
      const state = color.get(target) ?? 0;
      if (state === 0) dfs(target);
      else if (state === 1) {
        const at = stack.indexOf(target);
        if (at >= 0) cycles.push(stack.slice(at));
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of ids) {
    if ((color.get(id) ?? 0) === 0) dfs(id);
  }
  return cycles;
}

function report(
  diagnostics: CompileDiagnostic[],
  subgraph: string | undefined,
  severity: 'error' | 'warning',
  code: DiagnosticCode,
  message: string,
  extra?: { nodeId?: string; pin?: string; edgeIndex?: number },
): void {
  const diag: CompileDiagnostic = { severity, code, message };
  if (subgraph) diag.subgraph = subgraph;
  if (extra?.nodeId !== undefined) diag.nodeId = extra.nodeId;
  if (extra?.pin !== undefined) diag.pin = extra.pin;
  if (extra?.edgeIndex !== undefined) diag.edgeIndex = extra.edgeIndex;
  diagnostics.push(diag);
}
