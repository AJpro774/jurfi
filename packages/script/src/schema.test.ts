import { describe, expect, it } from 'vitest';
import { builtinNodeDefs, createBuiltinRegistry, resolvePins } from './builtins';
import { nodeHandlerTypes } from './handlers';
import { createNodeRegistry } from './registry';
import { GRAPH_VERSION, readInstancePin, stripEditorData, type GraphDoc } from './schema';
import { coreGaps } from './world';

describe('graph schema', () => {
  it('strips editor data without mutating the document or nested subgraphs', () => {
    const doc: GraphDoc = {
      version: GRAPH_VERSION,
      nodes: [
        {
          id: 'start',
          type: 'core/OnStart',
          pos: { x: 1, y: 2 },
          pins: { condition: { value: 1 } },
          props: { component: 'Health' },
        },
      ],
      edges: [{ id: 'w1', from: { node: 'start', pin: 'then' }, to: { node: 'set', pin: 'exec' } }],
      groups: [{ id: 'g', title: 'EDITOR_ONLY_NOTE' }],
      comments: [{ id: 'c', text: 'EDITOR_ONLY_NOTE' }],
      subgraphs: {
        nested: {
          version: 1,
          nodes: [{ id: 'inner', type: 'core/OnStart', pos: { x: 3, y: 4 } }],
          edges: [],
          comments: [{ id: 'c2', text: 'NESTED_NOTE' }],
        },
      },
    };

    const stripped = stripEditorData(doc);

    expect(doc.nodes[0]?.pos).toEqual({ x: 1, y: 2 });
    expect(doc.groups?.[0]?.title).toBe('EDITOR_ONLY_NOTE');
    expect(stripped.nodes[0]?.pos).toBeUndefined();
    expect(stripped.groups).toBeUndefined();
    expect(stripped.comments).toBeUndefined();
    expect(stripped.nodes[0]?.props).toEqual({ component: 'Health' });
    expect(stripped.edges[0]?.id).toBe('w1');
    expect(stripped.subgraphs?.nested?.nodes[0]?.pos).toBeUndefined();
    expect(stripped.subgraphs?.nested?.comments).toBeUndefined();
    expect(JSON.stringify(stripped)).not.toContain('EDITOR_ONLY_NOTE');
    expect(JSON.stringify(stripped)).not.toContain('NESTED_NOTE');

    const pins = stripped.nodes[0]?.pins;
    if (pins) pins.condition = 9;
    expect(doc.nodes[0]?.pins?.condition).toEqual({ value: 1 });
    if (doc.edges[0]) doc.edges[0].from.node = 'mutated';
    expect(stripped.edges[0]?.from.node).toBe('start');
  });

  it('reads structured pin values and bare literals', () => {
    expect(readInstancePin({ condition: { value: false } }, 'condition')).toEqual({
      present: true,
      value: false,
    });
    expect(readInstancePin({ condition: { dataType: 'bool' } }, 'condition')).toEqual({
      present: false,
      value: undefined,
    });
    expect(readInstancePin({ value: { hp: 3 } }, 'value')).toEqual({
      present: true,
      value: { hp: 3 },
    });
    expect(readInstancePin({ value: 10 }, 'value')).toEqual({ present: true, value: 10 });
    expect(readInstancePin(undefined, 'value')).toEqual({ present: false, value: undefined });
  });
});

describe('node registry', () => {
  it('registers, fetches, and lists definitions in order', () => {
    const registry = createNodeRegistry();
    const def = builtinNodeDefs[0];
    if (!def) throw new Error('missing builtin');
    registry.register(def);
    expect(registry.get(def.typeId)?.doc).toBe(def.doc);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.list().map((item) => item.typeId)).toEqual([def.typeId]);
    const listed = registry.list();
    listed.pop();
    expect(registry.list()).toHaveLength(1);
    expect(() => registry.register(def)).toThrow(/already registered/);
  });

  it('exposes stable core type ids with separate exec and data pins', () => {
    const registry = createBuiltinRegistry();
    const add = registry.get('core/Add');
    const branch = registry.get('core/Branch');
    expect(add?.pure).toBe(true);
    expect(add?.pins.some((pin) => pin.kind === 'exec')).toBe(false);
    expect(add?.pins.find((pin) => pin.name === 'result')).toMatchObject({
      kind: 'data',
      dataType: 'number',
      direction: 'out',
    });
    expect(branch?.pins.filter((pin) => pin.kind === 'exec').map((pin) => pin.name)).toEqual([
      'exec',
      'true',
      'false',
    ]);
    expect(branch?.pins.find((pin) => pin.name === 'condition')).toMatchObject({
      kind: 'data',
      dataType: 'bool',
      required: true,
    });
    for (const def of registry.list()) {
      expect(def.typeId).toMatch(/^[a-z]+\/[A-Za-z0-9]+$/);
      expect(def.category.length).toBeGreaterThan(0);
      expect(def.doc.length).toBeGreaterThan(0);
    }
    expect(nodeHandlerTypes().sort()).toEqual(registry.list().map((def) => def.typeId).sort());
  });

  it('expands sequence outputs from props.count', () => {
    const def = createBuiltinRegistry().get('core/Sequence');
    if (!def) throw new Error('missing sequence');
    expect(resolvePins(def, { count: 3 }).map((pin) => pin.name)).toEqual([
      'exec',
      'then0',
      'then1',
      'then2',
    ]);
    expect(resolvePins(def, undefined).map((pin) => pin.name)).toEqual(['exec', 'then0', 'then1']);
  });
});

describe('core adapter gap', () => {
  it('records the ECS surface Play mode uses', () => {
    expect(coreGaps.package).toBe('@jurfi/core');
    expect(coreGaps.present).toContain('clamp');
    expect(coreGaps.present).toContain('createScriptWorld');
    expect(coreGaps.adapter).toBe('createScriptWorld');
    expect(coreGaps.missing).toEqual([]);
  });
});
