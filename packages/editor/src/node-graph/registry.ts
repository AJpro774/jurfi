import type { GraphPin } from '@jurfi/script';

export interface NodePropField {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'boolean';
}

export interface NodeTypeDefinition {
  type: string;
  title: string;
  category: string;
  /** Short help shown in the palette and as the node's tooltip. */
  doc: string;
  pins: readonly GraphPin[];
  fields?: readonly NodePropField[];
  defaults?: Readonly<Record<string, unknown>>;
}

export interface NodeTypeRegistry {
  register(definition: NodeTypeDefinition): void;
  get(type: string): NodeTypeDefinition | undefined;
  list(): NodeTypeDefinition[];
  search(query: string): NodeTypeDefinition[];
}

const execOut = (id: string, name: string): GraphPin => ({ id, name, kind: 'exec', direction: 'out' });
const execIn = (id: string, name: string): GraphPin => ({ id, name, kind: 'exec', direction: 'in' });

export const BUILTIN_NODES: readonly NodeTypeDefinition[] = [
  {
    type: 'event.onStart',
    title: 'On Start',
    category: 'Event',
    doc: 'Fires the exec output once when the script starts.',
    pins: [execOut('exec', 'Out')],
  },
  {
    type: 'event.onTick',
    title: 'On Tick',
    category: 'Event',
    doc: 'Fires every frame. dt is the frame delta in seconds.',
    pins: [execOut('exec', 'Out'), { id: 'dt', name: 'dt', kind: 'data', direction: 'out', dataType: 'number' }],
  },
  {
    type: 'flow.branch',
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
    type: 'flow.sequence',
    title: 'Sequence',
    category: 'Flow',
    doc: 'Runs Then 0 and then Then 1 in order.',
    pins: [execIn('exec', 'In'), execOut('then0', 'Then 0'), execOut('then1', 'Then 1')],
  },
  {
    type: 'data.number',
    title: 'Number',
    category: 'Data',
    doc: 'Literal number value.',
    pins: [{ id: 'value', name: 'Value', kind: 'data', direction: 'out', dataType: 'number' }],
    fields: [{ key: 'value', label: 'Value', kind: 'number' }],
    defaults: { value: 0 },
  },
  {
    type: 'data.string',
    title: 'String',
    category: 'Data',
    doc: 'Literal string value.',
    pins: [{ id: 'value', name: 'Value', kind: 'data', direction: 'out', dataType: 'string' }],
    fields: [{ key: 'value', label: 'Value', kind: 'string' }],
    defaults: { value: '' },
  },
  {
    type: 'data.bool',
    title: 'Boolean',
    category: 'Data',
    doc: 'Literal boolean value.',
    pins: [{ id: 'value', name: 'Value', kind: 'data', direction: 'out', dataType: 'bool' }],
    fields: [{ key: 'value', label: 'Value', kind: 'boolean' }],
    defaults: { value: false },
  },
  {
    type: 'math.add',
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
    type: 'math.multiply',
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
    type: 'math.compare',
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
    type: 'action.print',
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
    type: 'action.setVariable',
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
    type: 'data.getVariable',
    title: 'Get Variable',
    category: 'Data',
    doc: 'Reads a named variable.',
    pins: [{ id: 'value', name: 'Value', kind: 'data', direction: 'out', dataType: 'any' }],
    fields: [{ key: 'name', label: 'Name', kind: 'string' }],
    defaults: { name: 'score' },
  },
];

export function createRegistry(definitions: readonly NodeTypeDefinition[] = []): NodeTypeRegistry {
  const map = new Map<string, NodeTypeDefinition>();
  const registry: NodeTypeRegistry = {
    register(definition) {
      map.set(definition.type, definition);
    },
    get(type) {
      return map.get(type);
    },
    list() {
      return [...map.values()];
    },
    search(query) {
      const needle = query.trim().toLowerCase();
      const all = registry.list();
      if (!needle) return all;
      return all.filter((definition) => {
        const haystack = `${definition.title} ${definition.type} ${definition.category} ${definition.doc}`.toLowerCase();
        return haystack.includes(needle);
      });
    },
  };
  for (const definition of definitions) registry.register(definition);
  return registry;
}

export function createDefaultRegistry(): NodeTypeRegistry {
  return createRegistry(BUILTIN_NODES);
}
