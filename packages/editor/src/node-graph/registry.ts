import type { GraphPin } from '@jurfi/script';

export interface NodePropField {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'boolean';
}

/**
 * A node type the canvas can place. `typeId` is the document's `node.type`
 * (`core/Add`, `anim/Clip`, …). `title`, `fields`, and `defaults` are optional
 * canvas extras; a host can omit them.
 */
export interface NodeDefinition {
  typeId: string;
  title?: string;
  category: string;
  /** Short help shown in the palette and as the node's tooltip. */
  doc: string;
  pins: readonly GraphPin[];
  fields?: readonly NodePropField[];
  defaults?: Readonly<Record<string, unknown>>;
}

/** Domain-agnostic catalog. The canvas never hard-codes node types. */
export interface NodeRegistry {
  register(def: NodeDefinition): void;
  get(typeId: string): NodeDefinition | undefined;
  list(): readonly NodeDefinition[];
}

export function nodeTitle(def: NodeDefinition | undefined, typeId: string): string {
  if (def?.title) return def.title;
  const leaf = typeId.split('/').pop();
  return leaf && leaf.length > 0 ? leaf : typeId;
}

export function searchNodes(registry: NodeRegistry, query: string): readonly NodeDefinition[] {
  const needle = query.trim().toLowerCase();
  const all = registry.list();
  if (!needle) return all;
  return all.filter((def) => {
    const title = nodeTitle(def, def.typeId);
    return `${title} ${def.typeId} ${def.category} ${def.doc}`.toLowerCase().includes(needle);
  });
}

const execOut = (id: string, name: string): GraphPin => ({ id, name, kind: 'exec', direction: 'out' });
const execIn = (id: string, name: string): GraphPin => ({ id, name, kind: 'exec', direction: 'in' });

export const BUILTIN_NODES: readonly NodeDefinition[] = [
  {
    typeId: 'core/OnStart',
    title: 'On Start',
    category: 'Event',
    doc: 'Fires the exec output once when the script starts.',
    pins: [execOut('exec', 'Out')],
  },
  {
    typeId: 'core/OnTick',
    title: 'On Tick',
    category: 'Event',
    doc: 'Fires every frame. dt is the frame delta in seconds.',
    pins: [execOut('exec', 'Out'), { id: 'dt', name: 'dt', kind: 'data', direction: 'out', dataType: 'number' }],
  },
  {
    typeId: 'core/Branch',
    title: 'Branch',
    category: 'Flow',
    doc: 'Routes execution to True or False from a boolean condition.',
    pins: [
      execIn('exec', 'In'),
      { id: 'condition', name: 'Condition', kind: 'data', direction: 'in', dataType: 'bool' },
      execOut('thenTrue', 'True'),
      execOut('thenFalse', 'False'),
    ],
  },
  {
    typeId: 'core/Sequence',
    title: 'Sequence',
    category: 'Flow',
    doc: 'Runs Then 0 and then Then 1 in order.',
    pins: [execIn('exec', 'In'), execOut('then0', 'Then 0'), execOut('then1', 'Then 1')],
  },
  {
    typeId: 'core/Number',
    title: 'Number',
    category: 'Data',
    doc: 'Literal number value.',
    pins: [{ id: 'value', name: 'Value', kind: 'data', direction: 'out', dataType: 'number' }],
    fields: [{ key: 'value', label: 'Value', kind: 'number' }],
    defaults: { value: 0 },
  },
  {
    typeId: 'core/String',
    title: 'String',
    category: 'Data',
    doc: 'Literal string value.',
    pins: [{ id: 'value', name: 'Value', kind: 'data', direction: 'out', dataType: 'string' }],
    fields: [{ key: 'value', label: 'Value', kind: 'string' }],
    defaults: { value: '' },
  },
  {
    typeId: 'core/Bool',
    title: 'Boolean',
    category: 'Data',
    doc: 'Literal boolean value.',
    pins: [{ id: 'value', name: 'Value', kind: 'data', direction: 'out', dataType: 'bool' }],
    fields: [{ key: 'value', label: 'Value', kind: 'boolean' }],
    defaults: { value: false },
  },
  {
    typeId: 'core/Add',
    title: 'Add',
    category: 'Math',
    doc: 'Adds two numbers.',
    pins: [
      { id: 'a', name: 'A', kind: 'data', direction: 'in', dataType: 'number' },
      { id: 'b', name: 'B', kind: 'data', direction: 'in', dataType: 'number' },
      { id: 'result', name: 'Result', kind: 'data', direction: 'out', dataType: 'number' },
    ],
  },
  {
    typeId: 'core/Multiply',
    title: 'Multiply',
    category: 'Math',
    doc: 'Multiplies two numbers.',
    pins: [
      { id: 'a', name: 'A', kind: 'data', direction: 'in', dataType: 'number' },
      { id: 'b', name: 'B', kind: 'data', direction: 'in', dataType: 'number' },
      { id: 'result', name: 'Result', kind: 'data', direction: 'out', dataType: 'number' },
    ],
  },
  {
    typeId: 'core/Compare',
    title: 'Compare',
    category: 'Math',
    doc: 'Compares two numbers. op is ==, <, or >.',
    pins: [
      { id: 'a', name: 'A', kind: 'data', direction: 'in', dataType: 'number' },
      { id: 'b', name: 'B', kind: 'data', direction: 'in', dataType: 'number' },
      { id: 'result', name: 'Result', kind: 'data', direction: 'out', dataType: 'bool' },
    ],
    fields: [{ key: 'op', label: 'Op', kind: 'string' }],
    defaults: { op: '==' },
  },
  {
    typeId: 'core/Print',
    title: 'Print',
    category: 'Action',
    doc: 'Prints the message when execution arrives, then continues.',
    pins: [
      execIn('exec', 'In'),
      { id: 'message', name: 'Message', kind: 'data', direction: 'in', dataType: 'string' },
      execOut('then', 'Then'),
    ],
  },
  {
    typeId: 'core/SetVariable',
    title: 'Set Variable',
    category: 'Action',
    doc: 'Writes a value to a named variable, then continues.',
    pins: [
      execIn('exec', 'In'),
      { id: 'value', name: 'Value', kind: 'data', direction: 'in', dataType: 'any' },
      execOut('then', 'Then'),
    ],
    fields: [{ key: 'name', label: 'Name', kind: 'string' }],
    defaults: { name: 'score' },
  },
  {
    typeId: 'core/GetVariable',
    title: 'Get Variable',
    category: 'Data',
    doc: 'Reads a named variable.',
    pins: [{ id: 'value', name: 'Value', kind: 'data', direction: 'out', dataType: 'any' }],
    fields: [{ key: 'name', label: 'Name', kind: 'string' }],
    defaults: { name: 'score' },
  },
];

export function createRegistry(definitions: readonly NodeDefinition[] = []): NodeRegistry {
  const map = new Map<string, NodeDefinition>();
  const registry: NodeRegistry = {
    register(def) {
      map.set(def.typeId, def);
    },
    get(typeId) {
      return map.get(typeId);
    },
    list() {
      return [...map.values()];
    },
  };
  for (const definition of definitions) registry.register(definition);
  return registry;
}

export function createDefaultRegistry(): NodeRegistry {
  return createRegistry(BUILTIN_NODES);
}
