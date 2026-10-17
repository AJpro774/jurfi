import { describe, expect, it } from 'vitest';
import { GRAPH_VERSION } from '@jurfi/script';
import type { GraphDocument, GraphEndpoint } from '@jurfi/script';
import { createLocalCommandBus, resolveCommandBus } from '../shell/command-bus';
import type { CommandBus } from '../shell/command-bus';
import { createGraphController, createIdFactory } from './controller';
import { formatDebugValue, lookupWireValue } from './debug';
import { createDemoGraph } from './demo-document';
import { pinAnchor, wireGeometry } from './geometry';
import { createDefaultRegistry } from './registry';
import { idsTouchingRect, mergeIds, toggleMember } from './selection';
import { createEmptyGraph, deserializeGraph, GraphSchemaError, serializeGraph, stripEditorData } from './serialize';
import { evaluateConnection, validateGraph } from './validate';

function graph(): { controller: ReturnType<typeof createGraphController>; bus: CommandBus } {
  const bus = createLocalCommandBus();
  const controller = createGraphController({
    document: createEmptyGraph(),
    registry: createDefaultRegistry(),
    bus,
    ids: createIdFactory(),
  });
  return { controller, bus };
}

function end(node: string, pin: string): GraphEndpoint {
  return { node, pin };
}

describe('connection validation', () => {
  it('connects exec to exec and allows output fan-out', () => {
    const { controller } = graph();
    const start = controller.addNode('event.onStart', { x: 0, y: 0 }) ?? '';
    const printA = controller.addNode('action.print', { x: 200, y: 0 }) ?? '';
    const printB = controller.addNode('action.print', { x: 200, y: 120 }) ?? '';
    expect(controller.connect(end(start, 'exec'), end(printA, 'exec'))).toBeNull();
    expect(controller.connect(end(start, 'exec'), end(printB, 'exec'))).toBeNull();
    expect(controller.getDocument().edges).toHaveLength(2);
  });

  it('orients a drag that starts on the input', () => {
    const { controller } = graph();
    const start = controller.addNode('event.onStart', { x: 0, y: 0 }) ?? '';
    const print = controller.addNode('action.print', { x: 200, y: 0 }) ?? '';
    expect(controller.connect(end(print, 'exec'), end(start, 'exec'))).toBeNull();
    expect(controller.getDocument().edges[0]).toEqual({
      from: { node: start, pin: 'exec' },
      to: { node: print, pin: 'exec' },
    });
  });

  it('rejects data type mismatches, exec/data mixes, and input fan-in', () => {
    const { controller } = graph();
    const number = controller.addNode('data.number', { x: 0, y: 0 }) ?? '';
    const text = controller.addNode('data.string', { x: 0, y: 80 }) ?? '';
    const print = controller.addNode('action.print', { x: 240, y: 0 }) ?? '';
    const start = controller.addNode('event.onStart', { x: 0, y: 160 }) ?? '';
    expect(controller.connect(end(number, 'value'), end(print, 'message'))).toBe('Type mismatch: number → string');
    expect(controller.connect(end(start, 'exec'), end(print, 'message'))).toBe('Cannot connect exec to data');
    expect(controller.connect(end(text, 'value'), end(print, 'message'))).toBeNull();
    const other = controller.addNode('data.string', { x: 0, y: 240 }) ?? '';
    expect(controller.connect(end(other, 'value'), end(print, 'message'))).toBe('Input already connected');
    expect(controller.getDocument().edges).toHaveLength(1);
  });

  it('treats any as compatible with concrete data types', () => {
    const { controller } = graph();
    const variable = controller.addNode('data.getVariable', { x: 0, y: 0 }) ?? '';
    const add = controller.addNode('math.add', { x: 240, y: 0 }) ?? '';
    expect(evaluateConnection(controller.getDocument(), end(variable, 'value'), end(add, 'a')).ok).toBe(true);
  });

  it('rejects exec cycles and allows data cycles', () => {
    const { controller } = graph();
    const first = controller.addNode('action.print', { x: 0, y: 0 }) ?? '';
    const second = controller.addNode('action.print', { x: 240, y: 0 }) ?? '';
    expect(controller.connect(end(first, 'then'), end(second, 'exec'))).toBeNull();
    expect(controller.connect(end(second, 'then'), end(first, 'exec'))).toBe('Exec cycle');

    const addA = controller.addNode('math.add', { x: 0, y: 200 }) ?? '';
    const addB = controller.addNode('math.add', { x: 240, y: 200 }) ?? '';
    expect(controller.connect(end(addA, 'result'), end(addB, 'a'))).toBeNull();
    expect(controller.connect(end(addB, 'result'), end(addA, 'a'))).toBeNull();
    expect(validateGraph(controller.getDocument())).toEqual([]);
  });

  it('rejects a pin connected to itself and unknown pins', () => {
    const { controller } = graph();
    const add = controller.addNode('math.add', { x: 0, y: 0 }) ?? '';
    expect(evaluateConnection(controller.getDocument(), end(add, 'a'), end(add, 'a')).ok).toBe(false);
    const missing = evaluateConnection(controller.getDocument(), end(add, 'nope'), end(add, 'a'));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toBe('Unknown node or pin');
  });
});

describe('serialization', () => {
  it('round-trips the demo graph and strips editor-only data', () => {
    const doc = createDemoGraph();
    expect(doc.version).toBe(GRAPH_VERSION);
    expect(validateGraph(doc)).toEqual([]);
    const json = serializeGraph(doc);
    expect(serializeGraph(deserializeGraph(json))).toBe(json);

    const stripped = stripEditorData(doc);
    expect(Object.keys(stripped).sort()).toEqual(['edges', 'nodes', 'version']);
    expect(stripped.nodes.every((node) => !('pos' in node))).toBe(true);
    expect(JSON.stringify(stripped)).not.toContain('"groups"');
    expect(JSON.stringify(stripped)).not.toContain('"comments"');
    expect(stripped.nodes[0]?.pins.length).toBeGreaterThan(0);
    expect(stripped.edges.length).toBe(doc.edges.length);
  });

  it('normalizes reversed edges and rejects invalid documents', () => {
    const doc = createEmptyGraph();
    doc.nodes.push(
      {
        id: 'start',
        type: 'event.onStart',
        pins: [{ id: 'exec', name: 'Out', kind: 'exec', direction: 'out' }],
        props: {},
        pos: { x: 0, y: 0 },
      },
      {
        id: 'print',
        type: 'action.print',
        pins: [
          { id: 'exec', name: 'In', kind: 'exec', direction: 'in' },
          { id: 'message', name: 'Message', kind: 'data', direction: 'in', dataType: 'string' },
          { id: 'then', name: 'Then', kind: 'exec', direction: 'out' },
        ],
        props: {},
        pos: { x: 10, y: 10 },
      },
    );
    doc.edges.push({ from: { node: 'print', pin: 'exec' }, to: { node: 'start', pin: 'exec' } });
    const loaded = deserializeGraph(serializeGraph(doc));
    expect(loaded.edges[0]).toEqual({ from: { node: 'start', pin: 'exec' }, to: { node: 'print', pin: 'exec' } });

    const cycled: GraphDocument = structuredClone(loaded);
    cycled.edges.push({ from: { node: 'print', pin: 'then' }, to: { node: 'print', pin: 'exec' } });
    expect(() => deserializeGraph(JSON.stringify(cycled))).toThrow(GraphSchemaError);

    expect(() => deserializeGraph('{')).toThrow(GraphSchemaError);
    expect(() => deserializeGraph({ version: 2, nodes: [], edges: [], groups: [], comments: [] })).toThrow(GraphSchemaError);
  });

  it('rejects fan-in that is already stored in the file', () => {
    const parsed = deserializeGraph(JSON.stringify(createDemoGraph()));
    const duplicated = structuredClone(parsed);
    const edge = duplicated.edges.find((item) => item.to.pin === 'message');
    const other = duplicated.nodes.find((node) => node.type === 'data.string' && node.id !== edge?.from.node);
    expect(edge && other).toBeTruthy();
    if (!edge || !other) return;
    duplicated.edges.push({ from: { node: other.id, pin: 'value' }, to: { ...edge.to } });
    expect(() => deserializeGraph(JSON.stringify(duplicated))).toThrow(/Input already connected/);
  });
});

describe('commands', () => {
  it('undoes and redoes add, connect, move, prop edits, and delete', () => {
    const { controller, bus } = graph();
    const start = controller.addNode('event.onStart', { x: 1, y: 2 }) ?? '';
    const print = controller.addNode('action.print', { x: 20, y: 30 }) ?? '';
    controller.connect(end(start, 'exec'), end(print, 'exec'));
    controller.moveNodes({ [print]: { x: 80, y: 90 } });
    controller.setProp(print, 'note', 'hi');
    expect(controller.getDocument().nodes).toHaveLength(2);
    expect(controller.getDocument().edges).toHaveLength(1);

    bus.undo();
    expect(controller.getDocument().nodes.find((node) => node.id === print)?.props.note).toBeUndefined();
    bus.undo();
    expect(controller.getDocument().nodes.find((node) => node.id === print)?.pos).toEqual({ x: 20, y: 30 });
    bus.undo();
    expect(controller.getDocument().edges).toHaveLength(0);
    bus.undo();
    bus.undo();
    expect(controller.getDocument().nodes).toHaveLength(0);
    expect(bus.canUndo()).toBe(false);

    bus.redo();
    bus.redo();
    bus.redo();
    bus.redo();
    bus.redo();
    const restored = controller.getDocument();
    expect(restored.nodes).toHaveLength(2);
    expect(restored.edges).toHaveLength(1);
    expect(restored.nodes.find((node) => node.id === print)?.pos).toEqual({ x: 80, y: 90 });
    expect(restored.nodes.find((node) => node.id === print)?.props.note).toBe('hi');

    controller.remove({ nodes: [print], comments: [], groups: [], edge: null });
    expect(controller.getDocument().edges).toHaveLength(0);
    bus.undo();
    expect(controller.getDocument().edges).toHaveLength(1);
    expect(controller.getDocument().nodes.map((node) => node.id)).toContain(print);
  });

  it('does not record a rejected connection or a no-op move', () => {
    const labels: string[] = [];
    const inner = createLocalCommandBus();
    const bus: CommandBus = {
      execute(command) {
        labels.push(command.label);
        inner.execute(command);
      },
      undo: () => inner.undo(),
      redo: () => inner.redo(),
      canUndo: () => inner.canUndo(),
      canRedo: () => inner.canRedo(),
    };
    const controller = createGraphController({
      document: createEmptyGraph(),
      registry: createDefaultRegistry(),
      bus,
    });
    const number = controller.addNode('data.number', { x: 0, y: 0 }) ?? '';
    const print = controller.addNode('action.print', { x: 10, y: 10 }) ?? '';
    expect(controller.connect(end(number, 'value'), end(print, 'message'))).toMatch(/Type mismatch/);
    controller.moveNodes({ [number]: { x: 0, y: 0 } });
    expect(labels).toEqual(['Add node', 'Add node']);
  });

  it('undoes comments, groups, and paste', () => {
    const { controller, bus } = graph();
    const first = controller.addNode('math.add', { x: 0, y: 0 }) ?? '';
    const second = controller.addNode('math.add', { x: 40, y: 0 }) ?? '';
    controller.connect(end(first, 'result'), end(second, 'a'));
    const comment = controller.addComment({ x: 0, y: 0, w: 100, h: 40 }, 'Note') ?? '';
    controller.setCommentText(comment, 'Edited');
    const group = controller.addGroup([first, second], { x: -10, y: -10, w: 200, h: 120 }, 'Math') ?? '';
    controller.setGroupTitle(group, 'Sums');
    const copied = controller.copy({ nodes: [first, second], comments: [comment], groups: [group] });
    const pasted = controller.paste(copied, { x: 32, y: 32 });
    expect(pasted?.nodes).toHaveLength(2);
    expect(controller.getDocument().nodes).toHaveLength(4);
    expect(controller.getDocument().edges.length).toBeGreaterThan(1);
    expect(controller.getDocument().comments).toHaveLength(2);
    expect(controller.getDocument().groups).toHaveLength(2);

    bus.undo();
    expect(controller.getDocument().nodes).toHaveLength(2);
    expect(controller.getDocument().comments).toHaveLength(1);
    bus.undo();
    expect(controller.getDocument().groups[0]?.title).toBe('Math');
    bus.undo();
    expect(controller.getDocument().groups).toHaveLength(0);
    bus.undo();
    expect(controller.getDocument().comments[0]?.text).toBe('Note');
    bus.redo();
    expect(controller.getDocument().comments[0]?.text).toBe('Edited');
  });

  it('keeps a returned document from mutating the live graph', () => {
    const { controller } = graph();
    controller.addNode('data.bool', { x: 0, y: 0 });
    const copy = controller.getDocument();
    copy.nodes.length = 0;
    expect(controller.getDocument().nodes).toHaveLength(1);
  });

  it('prefers an explicit bus over the editor context', () => {
    const local = createLocalCommandBus();
    const contextBus = createLocalCommandBus();
    expect(resolveCommandBus({ commandBus: local, editorContext: { commandBus: contextBus } })).toBe(local);
    expect(resolveCommandBus({ editorContext: { commandBus: contextBus } })).toBe(contextBus);
    expect(resolveCommandBus({}).canUndo()).toBe(false);
  });

  it('blocks edits when read only', () => {
    const bus = createLocalCommandBus();
    const controller = createGraphController({
      document: createEmptyGraph(),
      registry: createDefaultRegistry(),
      bus,
      readOnly: true,
    });
    expect(controller.addNode('data.number', { x: 0, y: 0 })).toBeNull();
    expect(bus.canUndo()).toBe(false);
  });
});

describe('registry, geometry, and debug values', () => {
  it('searches by title, category, and doc', () => {
    const registry = createDefaultRegistry();
    expect(registry.search('print').map((item) => item.type)).toEqual(['action.print']);
    expect(registry.search('FLOW').some((item) => item.type === 'flow.branch')).toBe(true);
    expect(registry.search('does-not-exist')).toEqual([]);
    expect(registry.get('math.add')?.pins.map((pin) => pin.id)).toEqual(['a', 'b', 'result']);
  });

  it('places output pins on the right edge and builds a wire', () => {
    const { controller } = graph();
    const id = controller.addNode('event.onStart', { x: 10, y: 20 }) ?? '';
    const node = controller.getDocument().nodes[0];
    expect(node).toBeTruthy();
    if (!node) return;
    expect(pinAnchor(node, 'exec')).toEqual({ x: 230, y: 20 + 28 + 12 });
    const wire = wireGeometry({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(wire.path.startsWith('M 0 0 C')).toBe(true);
    expect(wire.path.endsWith('100 0')).toBe(true);
    expect(wire.mid.x).toBeGreaterThan(0);
    expect(id).toBe('node_1');
  });

  it('box-selects and shift-toggles ids', () => {
    expect(toggleMember(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleMember(['a', 'b'], 'a')).toEqual(['b']);
    expect(mergeIds(['a'], ['b'], true)).toEqual(['a', 'b']);
    expect(mergeIds(['a'], ['b'], false)).toEqual(['b']);
    const hits = idsTouchingRect(
      [
        { id: 'inside', rect: { x: 10, y: 10, w: 20, h: 20 } },
        { id: 'outside', rect: { x: 80, y: 80, w: 10, h: 10 } },
      ],
      { x: 0, y: 0, w: 40, h: 40 },
    );
    expect(hits).toEqual(['inside']);
  });

  it('reads live wire values from edge or pin keys', () => {
    const edge = { from: { node: 'a', pin: 'value' }, to: { node: 'b', pin: 'message' } };
    expect(lookupWireValue({ 'a:value->b:message': 'Hello' }, edge)).toBe('Hello');
    expect(lookupWireValue({ 'a:value': 3 }, edge)).toBe(3);
    expect(formatDebugValue('Hello, Jurfi')).toBe('Hello, Jurfi');
    expect(formatDebugValue({ ok: true })).toBe('{"ok":true}');
  });
});
