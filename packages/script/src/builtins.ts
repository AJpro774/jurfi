import { createNodeRegistry, type NodeDef, type NodeRegistry, type PinSpec } from './registry';

const execIn: PinSpec = { name: 'exec', kind: 'exec', direction: 'in', label: 'In' };
const thenOut: PinSpec = { name: 'then', kind: 'exec', direction: 'out', label: 'Then' };

function dataIn(
  name: string,
  dataType: PinSpec['dataType'],
  extra?: Partial<PinSpec>,
): PinSpec {
  return { name, kind: 'data', direction: 'in', dataType, ...extra };
}

function dataOut(name: string, dataType: PinSpec['dataType'], label?: string): PinSpec {
  return { name, kind: 'data', direction: 'out', dataType, label };
}

const numIn = (name: string, extra?: Partial<PinSpec>): PinSpec =>
  dataIn(name, 'number', { default: 0, ...extra });

const boolIn = (name: string, extra?: Partial<PinSpec>): PinSpec =>
  dataIn(name, 'bool', { default: false, ...extra });

function math(typeId: string, doc: string): NodeDef {
  return {
    typeId,
    category: 'math',
    doc,
    pure: true,
    pins: [numIn('a', { label: 'A' }), numIn('b', { label: 'B' }), dataOut('result', 'number', 'Result')],
  };
}

function compare(typeId: string, doc: string): NodeDef {
  return {
    typeId,
    category: 'compare',
    doc,
    pure: true,
    pins: [numIn('a', { label: 'A' }), numIn('b', { label: 'B' }), dataOut('result', 'bool', 'Result')],
  };
}

/** Built-in visual script nodes. Type ids are stable (`core/Add`). */
export const builtinNodeDefs: readonly NodeDef[] = [
  {
    typeId: 'core/OnStart',
    category: 'event',
    doc: 'Fires once when the graph starts.',
    pins: [thenOut],
  },
  {
    typeId: 'core/OnUpdate',
    category: 'event',
    doc: 'Fires on every runtime tick. The dt output is the tick delta in seconds.',
    pins: [thenOut, dataOut('dt', 'number', 'dt')],
  },
  {
    typeId: 'core/OnEvent',
    category: 'event',
    doc: 'Fires when a custom event with props.event (or props.name) is emitted in this graph.',
    pins: [thenOut, dataOut('payload', 'any', 'Payload')],
  },
  {
    typeId: 'core/FireEvent',
    category: 'event',
    doc: 'Emits a custom event to OnEvent nodes in the same graph, then continues.',
    pins: [
      execIn,
      dataIn('event', 'string', { label: 'Event' }),
      dataIn('payload', 'any', { label: 'Payload' }),
      thenOut,
    ],
  },
  {
    typeId: 'core/Branch',
    category: 'flow',
    doc: 'Routes execution through the true or false exec output.',
    pins: [
      execIn,
      dataIn('condition', 'bool', { required: true, label: 'Condition' }),
      { name: 'true', kind: 'exec', direction: 'out', label: 'True' },
      { name: 'false', kind: 'exec', direction: 'out', label: 'False' },
    ],
  },
  {
    typeId: 'core/Sequence',
    category: 'flow',
    doc: 'Runs each thenN exec output in order. props.count sets how many outputs exist (default 2).',
    pins: [
      execIn,
      { name: 'then0', kind: 'exec', direction: 'out', label: '0' },
      { name: 'then1', kind: 'exec', direction: 'out', label: '1' },
    ],
    variadicExecOut: { prefix: 'then', countProp: 'count', defaultCount: 2, min: 1, max: 16 },
  },
  {
    typeId: 'core/ForLoop',
    category: 'flow',
    doc: 'Inclusive index loop from first to last, stepping by 1. body runs each iteration, then completed.',
    pins: [
      execIn,
      numIn('first', { label: 'First' }),
      numIn('last', { label: 'Last' }),
      dataOut('index', 'number', 'Index'),
      { name: 'body', kind: 'exec', direction: 'out', label: 'Body' },
      { name: 'completed', kind: 'exec', direction: 'out', label: 'Completed' },
    ],
  },
  {
    typeId: 'core/While',
    category: 'flow',
    doc: 'Runs body while condition is truthy, then runs completed.',
    pins: [
      execIn,
      dataIn('condition', 'bool', { required: true, label: 'Condition' }),
      { name: 'body', kind: 'exec', direction: 'out', label: 'Body' },
      { name: 'completed', kind: 'exec', direction: 'out', label: 'Completed' },
    ],
  },
  {
    typeId: 'core/Delay',
    category: 'flow',
    doc: 'Waits for seconds of tick time, then continues. Zero or less continues immediately. Time does not advance while paused.',
    pins: [execIn, numIn('seconds', { label: 'Seconds' }), thenOut],
  },
  {
    typeId: 'core/GetVariable',
    category: 'variable',
    doc: 'Reads a variable. props.name is required. props.scope is graph (default) or entity.',
    pure: true,
    pins: [dataIn('entity', 'entity', { label: 'Entity' }), dataOut('value', 'any', 'Value')],
  },
  {
    typeId: 'core/SetVariable',
    category: 'variable',
    doc: 'Writes a variable, then continues. props.name is required. props.scope is graph (default) or entity.',
    pins: [
      execIn,
      dataIn('entity', 'entity', { label: 'Entity' }),
      dataIn('value', 'any', { required: true, label: 'Value' }),
      dataOut('result', 'any', 'Result'),
      thenOut,
    ],
  },
  math('core/Add', 'result = a + b. Missing inputs are 0.'),
  math('core/Subtract', 'result = a - b. Missing inputs are 0.'),
  math('core/Multiply', 'result = a * b. Missing inputs are 0.'),
  math('core/Divide', 'result = a / b using JavaScript division. Missing inputs are 0.'),
  {
    typeId: 'core/Clamp',
    category: 'math',
    doc: 'Clamps value to [min, max] using clamp from @jurfi/core.',
    pure: true,
    pins: [
      numIn('value', { label: 'Value' }),
      numIn('min', { label: 'Min' }),
      dataIn('max', 'number', { default: 1, label: 'Max' }),
      dataOut('result', 'number', 'Result'),
    ],
  },
  {
    typeId: 'core/And',
    category: 'logic',
    doc: 'Short-circuit boolean and.',
    pure: true,
    pins: [boolIn('a', { label: 'A' }), boolIn('b', { label: 'B' }), dataOut('result', 'bool', 'Result')],
  },
  {
    typeId: 'core/Or',
    category: 'logic',
    doc: 'Short-circuit boolean or.',
    pure: true,
    pins: [boolIn('a', { label: 'A' }), boolIn('b', { label: 'B' }), dataOut('result', 'bool', 'Result')],
  },
  {
    typeId: 'core/Not',
    category: 'logic',
    doc: 'Boolean not.',
    pure: true,
    pins: [boolIn('value', { label: 'Value' }), dataOut('result', 'bool', 'Result')],
  },
  {
    typeId: 'core/Equal',
    category: 'compare',
    doc: 'True when both values are the same, or both are entity refs with the same id.',
    pure: true,
    pins: [
      dataIn('a', 'any', { label: 'A' }),
      dataIn('b', 'any', { label: 'B' }),
      dataOut('result', 'bool', 'Result'),
    ],
  },
  {
    typeId: 'core/NotEqual',
    category: 'compare',
    doc: 'True when Equal would be false.',
    pure: true,
    pins: [
      dataIn('a', 'any', { label: 'A' }),
      dataIn('b', 'any', { label: 'B' }),
      dataOut('result', 'bool', 'Result'),
    ],
  },
  compare('core/Greater', 'True when a > b.'),
  compare('core/GreaterEqual', 'True when a >= b.'),
  compare('core/Less', 'True when a < b.'),
  compare('core/LessEqual', 'True when a <= b.'),
  {
    typeId: 'core/Self',
    category: 'entity',
    doc: 'The entity this graph instance is attached to.',
    pure: true,
    pins: [dataOut('entity', 'entity', 'Entity')],
  },
  {
    typeId: 'core/GetComponent',
    category: 'entity',
    doc: 'Reads a component from an entity (default: self). props.component is the component name.',
    pure: true,
    pins: [
      dataIn('entity', 'entity', { label: 'Entity' }),
      dataOut('value', 'any', 'Value'),
    ],
  },
  {
    typeId: 'core/SetComponent',
    category: 'entity',
    doc: 'Replaces a component on an entity (default: self), then continues. props.component is required.',
    pins: [
      execIn,
      dataIn('entity', 'entity', { label: 'Entity' }),
      dataIn('value', 'any', { required: true, label: 'Value' }),
      thenOut,
    ],
  },
  {
    typeId: 'core/GetField',
    category: 'entity',
    doc: 'Reads one field of a component object. props.component and props.field are required.',
    pure: true,
    pins: [
      dataIn('entity', 'entity', { label: 'Entity' }),
      dataOut('value', 'any', 'Value'),
    ],
  },
  {
    typeId: 'core/SetField',
    category: 'entity',
    doc: 'Writes one field of a component object, then continues. props.component and props.field are required.',
    pins: [
      execIn,
      dataIn('entity', 'entity', { label: 'Entity' }),
      dataIn('value', 'any', { required: true, label: 'Value' }),
      thenOut,
    ],
  },
  {
    typeId: 'core/Subgraph',
    category: 'graph',
    doc: 'Runs a nested graph’s OnStart chain, then continues. props.graph is a key of this document’s subgraphs.',
    pins: [execIn, thenOut],
  },
];

/** Instance pins, including Sequence’s generated then0..thenN outputs. */
export function resolvePins(def: NodeDef, props: Record<string, unknown> | undefined): PinSpec[] {
  const spec = def.variadicExecOut;
  if (!spec) return [...def.pins];
  const raw = props?.[spec.countProp];
  const min = spec.min ?? 1;
  const max = spec.max ?? 32;
  let count = spec.defaultCount;
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    count = Math.min(max, Math.max(min, raw));
  }
  const pins: PinSpec[] = [];
  for (const pin of def.pins) {
    if (pin.kind === 'exec' && pin.direction === 'out' && pin.name.startsWith(spec.prefix)) continue;
    pins.push(pin);
  }
  for (let i = 0; i < count; i += 1) {
    pins.push({ name: `${spec.prefix}${i}`, kind: 'exec', direction: 'out', label: String(i) });
  }
  return pins;
}

export function createBuiltinRegistry(): NodeRegistry {
  return createNodeRegistry(builtinNodeDefs);
}

/** Adds built-in defs that are not already present. */
export function registerBuiltinNodes(registry: NodeRegistry): NodeRegistry {
  for (const def of builtinNodeDefs) {
    if (!registry.get(def.typeId)) registry.register(def);
  }
  return registry;
}
