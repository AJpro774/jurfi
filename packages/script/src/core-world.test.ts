import { createScriptWorld, createWorld, defineComponent } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from './builtins';
import { defineScript } from './scripts';
import { createScriptRuntime } from './runtime';
import { e, g, n } from './test/graph';
import type { ScriptWorld } from './world';

const Hp = defineComponent('Hp', {
  hp: { type: 'number', default: 0 },
});

describe('core script world', () => {
  it('satisfies ScriptWorld and stores fields and entity variables on the ECS', () => {
    const ecs = createWorld();
    const player = ecs.create();
    const world: ScriptWorld = createScriptWorld(ecs, player);
    const runtime = createScriptRuntime({ world });
    runtime.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('field', 'core/SetField', { props: { component: 'Hp', field: 'hp' }, pins: { value: 3 } }),
          n('read', 'core/GetField', { props: { component: 'Hp', field: 'hp' } }),
          n('save', 'core/SetVariable', { props: { name: 'hp', scope: 'entity' } }),
        ],
        [
          e('start', 'then', 'field', 'exec'),
          e('field', 'then', 'save', 'exec'),
          e('read', 'value', 'save', 'value'),
        ],
      ),
    );
    runtime.start();
    expect(ecs.get(player, Hp)).toEqual({ hp: 3 });
    expect(runtime.getVariable('hp', 'entity')).toBe(3);
    expect(ecs.getVariable(player, 'hp')).toBe(3);
    expect(world.getField?.(world.self, 'Hp', 'hp')).toBe(3);
  });

  it('runs OnStart → Branch → SetComponent on the ECS', () => {
    const ecs = createWorld();
    const player = ecs.create();
    const world = createScriptWorld(ecs, player);
    const runtime = createScriptRuntime({ world });
    const loaded = runtime.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('branch', 'core/Branch', { pins: { condition: true } }),
          n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 10 } }),
          n('miss', 'core/SetComponent', { props: { component: 'Missed' }, pins: { value: true } }),
        ],
        [
          e('start', 'then', 'branch', 'exec'),
          e('branch', 'true', 'set', 'exec'),
          e('branch', 'false', 'miss', 'exec'),
        ],
      ),
    );
    expect(loaded.ok).toBe(true);
    runtime.start();
    expect(ecs.get(player, 'Health')).toBe(10);
    expect(ecs.get(player, 'Missed')).toBeUndefined();
    expect(world.getComponent(world.self, 'Health')).toBe(10);

    const missed = createScriptWorld(createWorld());
    const other = createScriptRuntime({ world: missed });
    other.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('branch', 'core/Branch', { pins: { condition: false } }),
          n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 10 } }),
          n('miss', 'core/SetComponent', { props: { component: 'Missed' }, pins: { value: true } }),
        ],
        [
          e('start', 'then', 'branch', 'exec'),
          e('branch', 'true', 'set', 'exec'),
          e('branch', 'false', 'miss', 'exec'),
        ],
      ),
    );
    other.start();
    expect(missed.getComponent(missed.self, 'Health')).toBeUndefined();
    expect(missed.getComponent(missed.self, 'Missed')).toBe(true);
  });

  it('defaults Play mode to a core world', () => {
    const runtime = createScriptRuntime();
    runtime.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 4 } }),
        ],
        [e('start', 'then', 'set', 'exec')],
      ),
    );
    runtime.start();
    expect(typeof runtime.world.self.id).toBe('number');
    expect(runtime.world.getComponent(runtime.world.self, 'Health')).toBe(4);
  });

  it('reloads on the ECS without dropping variables or components', () => {
    const ecs = createWorld();
    const player = ecs.create();
    const world = createScriptWorld(ecs, player);
    const runtime = createScriptRuntime({ world });
    const loaded = runtime.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('score', 'core/SetVariable', { props: { name: 'score' }, pins: { value: 5 } }),
          n('health', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 5 } }),
          n('upd', 'core/OnUpdate'),
          n('mode', 'core/SetComponent', { props: { component: 'Mode' }, pins: { value: 'a' } }),
        ],
        [
          e('start', 'then', 'score', 'exec'),
          e('score', 'then', 'health', 'exec'),
          e('upd', 'then', 'mode', 'exec'),
        ],
      ),
    );
    expect(loaded.ok).toBe(true);
    runtime.start();
    runtime.setVariable('kept', 1, 'entity');
    expect(ecs.get(player, 'Health')).toBe(5);
    expect(ecs.getVariable(player, 'kept')).toBe(1);

    const next = runtime.reload(
      g(
        [
          n('start', 'core/OnStart'),
          n('health', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 0 } }),
          n('upd', 'core/OnUpdate'),
          n('mode', 'core/SetComponent', { props: { component: 'Mode' }, pins: { value: 'b' } }),
        ],
        [e('start', 'then', 'health', 'exec'), e('upd', 'then', 'mode', 'exec')],
      ),
    );
    expect(next.ok).toBe(true);
    expect(runtime.running).toBe(true);
    expect(runtime.getVariable('score')).toBe(5);
    expect(ecs.get(player, 'Health')).toBe(5);
    expect(ecs.getVariable(player, 'kept')).toBe(1);
    runtime.tick(0.016);
    expect(ecs.get(player, 'Mode')).toBe('b');
    expect(ecs.get(player, 'Health')).toBe(5);

    const failed = runtime.reload({ version: 2, nodes: [], edges: [] });
    expect(failed.ok).toBe(false);
    expect(runtime.getVariable('score')).toBe(5);
    runtime.tick(0.016);
    expect(ecs.get(player, 'Mode')).toBe('b');
  });

  it('reports a node error and keeps writing to the ECS', () => {
    const boom = defineScript({
      typeId: 'game/CoreBoom',
      category: 'game',
      doc: 'Throws during Play mode.',
      run() {
        throw new Error('core boom');
      },
    });
    const registry = createBuiltinRegistry();
    boom.register(registry);
    const seen: string[] = [];
    const ecs = createWorld();
    const player = ecs.create();
    const world = createScriptWorld(ecs, player);
    const runtime = createScriptRuntime({
      world,
      registry,
      onNodeError(fault) {
        seen.push(fault.nodeId);
      },
    });
    const loaded = runtime.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('seq', 'core/Sequence'),
          n('boom', 'game/CoreBoom'),
          n('ok', 'core/SetComponent', { props: { component: 'Ok' }, pins: { value: true } }),
          n('upd', 'core/OnUpdate'),
          n('tick', 'core/SetComponent', { props: { component: 'Ticked' }, pins: { value: 1 } }),
        ],
        [
          e('start', 'then', 'seq', 'exec'),
          e('seq', 'then0', 'boom', 'exec'),
          e('seq', 'then1', 'ok', 'exec'),
          e('upd', 'then', 'tick', 'exec'),
        ],
      ),
    );
    expect(loaded.ok).toBe(true);
    expect(() => runtime.start()).not.toThrow();
    expect(runtime.running).toBe(true);
    expect(ecs.get(player, 'Ok')).toBe(true);
    expect(runtime.nodeErrors.find((fault) => fault.nodeId === 'boom')?.message).toContain('core boom');
    expect(seen).toContain('boom');
    runtime.tick(0.016);
    expect(ecs.get(player, 'Ticked')).toBe(1);
    expect(runtime.running).toBe(true);
  });
});
