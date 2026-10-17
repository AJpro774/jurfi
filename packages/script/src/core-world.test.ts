import { createScriptWorld, createWorld, defineComponent } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
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
});
