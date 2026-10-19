import { describe, expect, it } from 'vitest';
import { clamp } from '@jurfi/core';
import { createBuiltinRegistry, registerBuiltinNodes } from './builtins';
import { compile } from './compile';
import { createNodeRegistry } from './registry';
import { runScripts } from './callback';
import {
  createScriptRuntime,
  type DebugEvent,
  type DebugSource,
} from './runtime';
import { e, g, n } from './test/graph';
import { createMemoryWorld, type EntityRef, type ScriptWorld } from './world';

const registry = createBuiltinRegistry();

function sample(condition: boolean) {
  return g(
    [
      n('start', 'core/OnStart', { pos: { x: 0, y: 0 } }),
      n('branch', 'core/Branch', { pins: { condition }, pos: { x: 180, y: 0 } }),
      n('set', 'core/SetComponent', {
        props: { component: 'Health' },
        pins: { value: { value: 10 } },
        pos: { x: 360, y: -40 },
      }),
      n('miss', 'core/SetComponent', {
        props: { component: 'Missed' },
        pins: { value: true },
        pos: { x: 360, y: 80 },
      }),
    ],
    [
      e('start', 'then', 'branch', 'exec'),
      e('branch', 'true', 'set', 'exec'),
      e('branch', 'false', 'miss', 'exec'),
    ],
    {
      groups: [{ id: 'g', title: 'EDITOR_ONLY_NOTE' }],
      comments: [{ id: 'c', text: 'EDITOR_ONLY_NOTE' }],
    },
  );
}

describe('play mode sample', () => {
  it('runs OnStart → Branch → SetComponent', () => {
    const world = createMemoryWorld('player');
    const rt = createScriptRuntime({ world });
    const compiled = rt.load(sample(true));

    expect(compiled.ok).toBe(true);
    expect(compiled.source).not.toContain('EDITOR_ONLY_NOTE');
    expect(compiled.source).not.toContain('from "@jurfi/editor"');

    rt.start();

    expect(world.getComponent(world.self, 'Health')).toBe(10);
    expect(world.getComponent(world.self, 'Missed')).toBeUndefined();
    expect(rt.running).toBe(true);
    expect(rt.paused).toBe(false);
  });

  it('takes the false exec output when the condition is false', () => {
    const world = createMemoryWorld('player');
    const rt = createScriptRuntime({ world });
    rt.load(sample(false));
    rt.start();
    expect(world.getComponent(world.self, 'Health')).toBeUndefined();
    expect(world.getComponent(world.self, 'Missed')).toBe(true);
  });

  it('runs the same program from emitted JavaScript data via loadProgram', () => {
    const compiled = compile(sample(true), registry);
    if (!compiled.program) throw new Error('expected a program');
    const world = createMemoryWorld('player');
    const rt = createScriptRuntime({ world });
    rt.loadProgram(compiled.program);
    rt.start();
    expect(world.getComponent(world.self, 'Health')).toBe(10);
  });
});

describe('runtime flow, data, and entities', () => {
  it('ticks OnUpdate with dt and accumulates through Add', () => {
    const rt = createScriptRuntime();
    rt.load(
      g(
        [
          n('tick', 'core/OnUpdate'),
          n('get', 'core/GetVariable', { props: { name: 'sum' } }),
          n('add', 'core/Add'),
          n('set', 'core/SetVariable', { props: { name: 'sum' } }),
        ],
        [
          e('tick', 'then', 'set', 'exec'),
          e('get', 'value', 'add', 'a'),
          e('tick', 'dt', 'add', 'b'),
          e('add', 'result', 'set', 'value'),
        ],
      ),
    );
    rt.start();
    expect(rt.getVariable('sum')).toBeUndefined();
    rt.tick(0.5);
    rt.tick(0.25);
    expect(rt.getVariable('sum')).toBe(0.75);
    rt.stop();
    rt.tick(1);
    expect(rt.getVariable('sum')).toBe(0.75);
    expect(rt.running).toBe(false);
  });

  it('stores graph variables locally and entity variables on the world', () => {
    const world = createMemoryWorld('pawn');
    const other = createScriptRuntime({ world });
    const rt = createScriptRuntime({ world });
    rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('graph', 'core/SetVariable', { props: { name: 'score', scope: 'graph' }, pins: { value: 2 } }),
          n('entity', 'core/SetVariable', { props: { name: 'hp', scope: 'entity' }, pins: { value: 9 } }),
        ],
        [e('start', 'then', 'graph', 'exec'), e('graph', 'then', 'entity', 'exec')],
      ),
    );
    rt.start();
    expect(rt.getVariable('score')).toBe(2);
    expect(rt.getVariable('hp', 'entity')).toBe(9);
    expect(world.getVariable(world.self, 'hp')).toBe(9);
    expect(other.getVariable('hp', 'entity')).toBe(9);
    expect(other.getVariable('score')).toBeUndefined();
  });

  it('falls back to a runtime side table when the world has no variable or field API', () => {
    const components = new Map<string, unknown>();
    const self: EntityRef = { id: 'pawn' };
    const world: ScriptWorld = {
      self,
      getComponent: (_entity, name) => components.get(name),
      setComponent: (_entity, name, value) => {
        components.set(name, value);
      },
    };
    const rt = createScriptRuntime({ world });
    rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('field', 'core/SetField', {
            props: { component: 'Health', field: 'hp' },
            pins: { value: 3 },
          }),
          n('read', 'core/GetField', { props: { component: 'Health', field: 'hp' } }),
          n('save', 'core/SetVariable', { props: { name: 'hp', scope: 'entity' } }),
        ],
        [
          e('start', 'then', 'field', 'exec'),
          e('field', 'then', 'save', 'exec'),
          e('read', 'value', 'save', 'value'),
        ],
      ),
    );
    rt.start();
    expect(components.get('Health')).toEqual({ hp: 3 });
    expect(rt.getVariable('hp', 'entity')).toBe(3);
  });

  it('sums a for-loop index and stops a while loop', () => {
    const rt = createScriptRuntime();
    rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('zero', 'core/SetVariable', { props: { name: 'sum' }, pins: { value: 0 } }),
          n('loop', 'core/ForLoop', { pins: { first: 1, last: 3 } }),
          n('get', 'core/GetVariable', { props: { name: 'sum' } }),
          n('add', 'core/Add'),
          n('acc', 'core/SetVariable', { props: { name: 'sum' } }),
        ],
        [
          e('start', 'then', 'zero', 'exec'),
          e('zero', 'then', 'loop', 'exec'),
          e('loop', 'body', 'acc', 'exec'),
          e('get', 'value', 'add', 'a'),
          e('loop', 'index', 'add', 'b'),
          e('add', 'result', 'acc', 'value'),
        ],
      ),
    );
    rt.start();
    expect(rt.getVariable('sum')).toBe(6);

    const world = createMemoryWorld();
    const looped = createScriptRuntime({ world });
    looped.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('init', 'core/SetVariable', { props: { name: 'n' }, pins: { value: 0 } }),
          n('loop', 'core/While'),
          n('get', 'core/GetVariable', { props: { name: 'n' } }),
          n('cmp', 'core/Less', { pins: { b: 3 } }),
          n('add', 'core/Add', { pins: { b: 1 } }),
          n('set', 'core/SetVariable', { props: { name: 'n' } }),
          n('done', 'core/SetComponent', { props: { component: 'Done' }, pins: { value: true } }),
        ],
        [
          e('start', 'then', 'init', 'exec'),
          e('init', 'then', 'loop', 'exec'),
          e('get', 'value', 'cmp', 'a'),
          e('cmp', 'result', 'loop', 'condition'),
          e('loop', 'body', 'set', 'exec'),
          e('get', 'value', 'add', 'a'),
          e('add', 'result', 'set', 'value'),
          e('loop', 'completed', 'done', 'exec'),
        ],
      ),
    );
    looped.start();
    expect(looped.getVariable('n')).toBe(3);
    expect(world.getComponent(world.self, 'Done')).toBe(true);
  });

  it('runs sequence outputs in order, delays across ticks, and delivers custom events', () => {
    const world = createMemoryWorld();
    const order: string[] = [];
    const rt = createScriptRuntime({ world });
    rt.attachDebugger({
      onEvent(event) {
        if (event.kind === 'node' && event.phase === 'enter') order.push(event.nodeId);
      },
    });
    rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('seq', 'core/Sequence', { props: { count: 2 } }),
          n('a', 'core/SetComponent', { props: { component: 'A' }, pins: { value: 1 } }),
          n('b', 'core/SetComponent', { props: { component: 'B' }, pins: { value: 2 } }),
        ],
        [
          e('start', 'then', 'seq', 'exec'),
          e('seq', 'then0', 'a', 'exec'),
          e('seq', 'then1', 'b', 'exec'),
        ],
      ),
    );
    rt.start();
    expect(order).toEqual(['start', 'seq', 'a', 'b']);
    expect(world.getComponent(world.self, 'A')).toBe(1);
    expect(world.getComponent(world.self, 'B')).toBe(2);
    rt.detachDebugger();

    const delayed = createScriptRuntime({ world: createMemoryWorld() });
    const delayWorld = delayed.world;
    delayed.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('wait', 'core/Delay', { pins: { seconds: 2 } }),
          n('set', 'core/SetComponent', { props: { component: 'Ready' }, pins: { value: true } }),
        ],
        [e('start', 'then', 'wait', 'exec'), e('wait', 'then', 'set', 'exec')],
      ),
    );
    delayed.start();
    expect(delayWorld.getComponent(delayWorld.self, 'Ready')).toBeUndefined();
    delayed.tick(1);
    expect(delayWorld.getComponent(delayWorld.self, 'Ready')).toBeUndefined();
    delayed.tick(1);
    expect(delayWorld.getComponent(delayWorld.self, 'Ready')).toBe(true);

    const events = createScriptRuntime();
    events.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('fire', 'core/FireEvent', { props: { event: 'ping' }, pins: { payload: 5 } }),
          n('get', 'core/GetVariable', { props: { name: 'seen' } }),
          n('after', 'core/SetVariable', { props: { name: 'after' } }),
          n('on', 'core/OnEvent', { props: { event: 'ping' } }),
          n('mark', 'core/SetVariable', { props: { name: 'seen' } }),
        ],
        [
          e('start', 'then', 'fire', 'exec'),
          e('fire', 'then', 'after', 'exec'),
          e('get', 'value', 'after', 'value'),
          e('on', 'then', 'mark', 'exec'),
          e('on', 'payload', 'mark', 'value'),
        ],
      ),
    );
    events.start();
    expect(events.getVariable('seen')).toBe(5);
    expect(events.getVariable('after')).toBe(5);
    events.emit('ping', 7);
    expect(events.getVariable('seen')).toBe(7);
  });

  it('clamps with @jurfi/core and runs a subgraph OnStart chain', () => {
    const rt = createScriptRuntime();
    rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('clamp', 'core/Clamp', { pins: { value: 5, min: 0, max: 1 } }),
          n('set', 'core/SetVariable', { props: { name: 'out' } }),
        ],
        [e('start', 'then', 'set', 'exec'), e('clamp', 'result', 'set', 'value')],
      ),
    );
    rt.start();
    expect(rt.getVariable('out')).toBe(clamp(5, 0, 1));

    const world = createMemoryWorld();
    const nested = createScriptRuntime({ world });
    nested.load(
      g(
        [n('start', 'core/OnStart'), n('sub', 'core/Subgraph', { props: { graph: 'addHp' } })],
        [e('start', 'then', 'sub', 'exec')],
        {
          subgraphs: {
            addHp: g(
              [
                n('start', 'core/OnStart'),
                n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 1 } }),
              ],
              [e('start', 'then', 'set', 'exec')],
            ),
          },
        },
      ),
    );
    nested.start();
    expect(world.getComponent(world.self, 'Health')).toBe(1);
  });

  it('passes exec through a custom node and stops infinite loops', () => {
    const custom = registerBuiltinNodes(createNodeRegistry());
    custom.register({
      typeId: 'test/Pass',
      category: 'test',
      doc: 'Passes execution through.',
      pins: [
        { name: 'exec', kind: 'exec', direction: 'in' },
        { name: 'then', kind: 'exec', direction: 'out' },
      ],
    });
    const world = createMemoryWorld();
    const rt = createScriptRuntime({ world, registry: custom });
    const loaded = rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('pass', 'test/Pass'),
          n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 4 } }),
        ],
        [e('start', 'then', 'pass', 'exec'), e('pass', 'then', 'set', 'exec')],
      ),
    );
    expect(loaded.ok).toBe(true);
    rt.start();
    expect(world.getComponent(world.self, 'Health')).toBe(4);

    const reported: string[] = [];
    const spinning = createScriptRuntime({
      maxSteps: 20,
      onNodeError(fault) {
        reported.push(fault.nodeId);
      },
    });
    spinning.load(
      g(
        [n('start', 'core/OnStart'), n('loop', 'core/While', { pins: { condition: true } })],
        [e('start', 'then', 'loop', 'exec')],
      ),
    );
    expect(() => spinning.start()).not.toThrow();
    expect(spinning.running).toBe(true);
    expect(
      spinning.nodeErrors.some((fault) => fault.nodeId === 'loop' && fault.message.includes('Exceeded')),
    ).toBe(true);
    expect(reported).toContain('loop');
    expect(() => spinning.tick(1)).not.toThrow();
  });

  it('compares strings, negates, and multiplies', () => {
    const rt = createScriptRuntime();
    rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('seq', 'core/Sequence', { props: { count: 3 } }),
          n('eq', 'core/Equal', { pins: { a: 'red', b: 'red' } }),
          n('not', 'core/Not'),
          n('mul', 'core/Multiply', { pins: { a: 3, b: 4 } }),
          n('setEq', 'core/SetVariable', { props: { name: 'eq' } }),
          n('setNot', 'core/SetVariable', { props: { name: 'not' } }),
          n('setMul', 'core/SetVariable', { props: { name: 'mul' } }),
        ],
        [
          e('start', 'then', 'seq', 'exec'),
          e('seq', 'then0', 'setEq', 'exec'),
          e('seq', 'then1', 'setNot', 'exec'),
          e('seq', 'then2', 'setMul', 'exec'),
          e('eq', 'result', 'setEq', 'value'),
          e('eq', 'result', 'not', 'value'),
          e('not', 'result', 'setNot', 'value'),
          e('mul', 'result', 'setMul', 'value'),
        ],
      ),
    );
    rt.start();
    expect(rt.getVariable('eq')).toBe(true);
    expect(rt.getVariable('not')).toBe(false);
    expect(rt.getVariable('mul')).toBe(12);
  });

  it('keeps the callback script helper', () => {
    const seen: number[] = [];
    runScripts([(ctx) => seen.push(ctx.dt)], 0.16);
    expect(seen).toEqual([0.16]);
  });
});

describe('debug hooks', () => {
  function recorder(): DebugSource & { events: DebugEvent[] } {
    const events: DebugEvent[] = [];
    return {
      events,
      onEvent(event) {
        events.push(event);
      },
    };
  }

  it('emits node and wire events only while a debugger is attached', () => {
    const world = createMemoryWorld('player');
    const rt = createScriptRuntime({ world });
    rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('self', 'core/Self'),
          n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 10 } }),
        ],
        [e('start', 'then', 'set', 'exec', 'pulse'), e('self', 'entity', 'set', 'entity', 'who')],
      ),
    );
    const source = recorder();
    rt.attachDebugger(source);
    rt.start();

    expect(source.events).toContainEqual({ kind: 'node', nodeId: 'start', phase: 'enter' });
    expect(source.events).toContainEqual({ kind: 'node', nodeId: 'start', phase: 'exit' });
    expect(source.events).toContainEqual({ kind: 'node', nodeId: 'set', phase: 'enter' });
    expect(source.events).toContainEqual({ kind: 'wire', wireId: 'pulse', value: true });
    expect(source.events).toContainEqual({ kind: 'wire', wireId: 'who', value: world.self });

    const enters = source.events.filter((event) => event.kind === 'node' && event.phase === 'enter');
    const exits = source.events.filter((event) => event.kind === 'node' && event.phase === 'exit');
    expect(enters.map((event) => (event.kind === 'node' ? event.nodeId : ''))).toEqual(['start', 'set']);
    expect(exits.map((event) => (event.kind === 'node' ? event.nodeId : ''))).toEqual(['start', 'set']);

    source.events.length = 0;
    rt.detachDebugger();
    rt.start();
    expect(source.events).toEqual([]);
    expect(world.getComponent(world.self, 'Health')).toBe(10);
  });

  it('pauses on breakpoints and supports step and resume', () => {
    const world = createMemoryWorld('player');
    const rt = createScriptRuntime({ world });
    rt.load(sample(true));

    rt.setBreakpoint('branch');
    rt.start();
    expect(rt.paused).toBe(true);
    expect(world.getComponent(world.self, 'Health')).toBeUndefined();

    rt.step();
    expect(rt.paused).toBe(true);
    expect(world.getComponent(world.self, 'Health')).toBeUndefined();

    rt.step();
    expect(world.getComponent(world.self, 'Health')).toBe(10);

    const resumed = createMemoryWorld('player');
    const again = createScriptRuntime({ world: resumed });
    again.load(sample(true));
    again.setBreakpoint('set');
    again.start();
    expect(again.paused).toBe(true);
    expect(resumed.getComponent(resumed.self, 'Health')).toBeUndefined();
    again.resume();
    expect(again.paused).toBe(false);
    expect(resumed.getComponent(resumed.self, 'Health')).toBe(10);
  });

  it('pause from a node event holds the next node until resume', () => {
    const world = createMemoryWorld('player');
    const rt = createScriptRuntime({ world });
    rt.load(sample(true));
    const seen: string[] = [];
    rt.attachDebugger({
      onEvent(event) {
        if (event.kind === 'node' && event.phase === 'enter') {
          seen.push(event.nodeId);
          if (event.nodeId === 'branch') rt.pause();
        }
      },
    });
    rt.start();
    expect(rt.paused).toBe(true);
    expect(seen).toEqual(['start', 'branch']);
    expect(world.getComponent(world.self, 'Health')).toBeUndefined();
    rt.resume();
    expect(world.getComponent(world.self, 'Health')).toBe(10);
    expect(rt.paused).toBe(false);
  });

  it('ignores ticks while paused between frames', () => {
    const rt = createScriptRuntime();
    rt.load(
      g(
        [
          n('tick', 'core/OnUpdate'),
          n('get', 'core/GetVariable', { props: { name: 'n' } }),
          n('add', 'core/Add', { pins: { b: 1 } }),
          n('set', 'core/SetVariable', { props: { name: 'n' } }),
        ],
        [
          e('tick', 'then', 'set', 'exec'),
          e('get', 'value', 'add', 'a'),
          e('add', 'result', 'set', 'value'),
        ],
      ),
    );
    rt.start();
    rt.pause();
    rt.tick(1);
    expect(rt.getVariable('n')).toBeUndefined();
    rt.resume();
    rt.tick(1);
    expect(rt.getVariable('n')).toBe(1);
  });

  it('short-circuits And so the unread input emits no wire', () => {
    const rt = createScriptRuntime();
    rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('and', 'core/And', { pins: { a: false } }),
          n('get', 'core/GetVariable', { props: { name: 'hidden' } }),
          n('set', 'core/SetVariable', { props: { name: 'out' } }),
        ],
        [
          e('start', 'then', 'set', 'exec'),
          e('get', 'value', 'and', 'b', 'hidden-wire'),
          e('and', 'result', 'set', 'value'),
        ],
      ),
    );
    const source = recorder();
    rt.attachDebugger(source);
    rt.start();
    expect(rt.getVariable('out')).toBe(false);
    expect(source.events.some((event) => event.kind === 'wire' && event.wireId === 'hidden-wire')).toBe(
      false,
    );
  });
});
