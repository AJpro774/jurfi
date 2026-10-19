import { describe, expect, it } from 'vitest';
import { createEditorWorld } from './adapters';
import { entityIndex, nextGeneration, entityGeneration } from './entity';
import { createWorld } from './world';

describe('stable ids across play stop', () => {
  it('restores packed ids, variables, and the generation table', () => {
    const view = createEditorWorld();
    view.deserialize({
      entities: [
        { id: 'scene', name: 'Scene', parentId: null, components: {} },
        { id: 'player', name: 'Player', parentId: 'scene', components: { health: -1 } },
      ],
    });
    const ecs = view.ecs;
    const scene = ecs.resolveAlias('scene');
    const player = ecs.resolveAlias('player');
    expect(scene).toBeDefined();
    expect(player).toBeDefined();
    ecs.setVariable(player ?? 0, 'score', { n: 7 });
    const burned = ecs.create();
    ecs.destroy(burned);
    const before = ecs.toScene();

    const snapshot = view.serialize();
    ecs.setVariable(player ?? 0, 'score', { n: 99 });
    ecs.setName(player ?? 0, 'Hero');
    const spawned = ecs.create();
    expect(entityIndex(spawned)).toBe(entityIndex(burned));
    expect(entityGeneration(spawned)).toBe(nextGeneration(entityGeneration(burned)));
    ecs.destroy(spawned);
    view.add({ id: 'bullet', name: 'Bullet', parentId: 'scene', components: { health: 1 } });

    view.deserialize(snapshot);
    expect(ecs.resolveAlias('scene')).toBe(scene);
    expect(ecs.resolveAlias('player')).toBe(player);
    expect(ecs.isAlive(spawned)).toBe(false);
    expect(view.get('player')?.name).toBe('Player');
    expect(view.get('player')?.parentId).toBe('scene');
    expect(view.get('player')?.components).toEqual({ health: -1 });
    expect(ecs.getVariable(player ?? 0, 'score')).toEqual({ n: 7 });
    expect(view.get('bullet')).toBeUndefined();
    expect(ecs.toScene().generations).toEqual(before.generations);
    expect(ecs.toScene().entities.map((entity) => entity.id)).toEqual(before.entities.map((entity) => entity.id));

    const again = ecs.create();
    expect(again).toBe(spawned);
    expect(ecs.getVariable(again, 'score')).toBeUndefined();
    expect(view.get('player')?.eid).toBe(player);
    expect(view.get('player')?.variables).toEqual({ score: { n: 7 } });
  });

  it('still allocates ids for documents that have no packed ids', () => {
    const view = createEditorWorld(createWorld());
    view.deserialize({
      entities: [{ id: 'only', name: 'Only', parentId: null, components: {}, variables: { n: 1 } }],
    });
    const first = view.ecs.resolveAlias('only');
    view.deserialize({
      entities: [{ id: 'only', name: 'Only', parentId: null, components: {}, variables: { n: 1 } }],
    });
    const second = view.ecs.resolveAlias('only');
    expect(second).not.toBe(first);
    expect(view.ecs.getVariable(second ?? 0, 'n')).toBe(1);
  });
});
