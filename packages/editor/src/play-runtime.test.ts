import type { Clip } from '@jurfi/anim';
import { createEditorWorld } from '@jurfi/core';
import { createBuiltinRegistry, defineScript, type GraphDoc } from '@jurfi/script';
import { describe, expect, it } from 'vitest';
import { createEditorContext } from './context';
import { createPlaySession } from './play-runtime';
import { createWorld, type EditorWorld } from './world';

const boomGraph = (): GraphDoc => ({
  version: 1,
  nodes: [
    { id: 'start', type: 'core/OnStart' },
    { id: 'boom', type: 'game/Boom' },
  ],
  edges: [{ from: { node: 'start', pin: 'then' }, to: { node: 'boom', pin: 'exec' } }],
});

function positionY(world: EditorWorld, id: string): number {
  const transform = world.get(id)?.components.Transform;
  if (typeof transform !== 'object' || transform === null || !('position' in transform)) {
    throw new Error(`missing Transform on ${id}`);
  }
  const position = transform.position;
  const y = Array.isArray(position) ? position[1] : undefined;
  if (typeof y !== 'number') throw new Error(`missing position.y on ${id}`);
  return y;
}

function fallingWorld(): EditorWorld {
  const world = createEditorWorld();
  world.deserialize({
    entities: [
      {
        id: 'ground',
        name: 'Ground',
        parentId: null,
        components: {
          Transform: { position: [0, -0.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          RigidBody: { type: 'fixed' },
          Collider: { shape: 'box', halfExtents: [20, 0.5, 20] },
        },
      },
      {
        id: 'box',
        name: 'Box',
        parentId: null,
        components: {
          Transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          RigidBody: { type: 'dynamic', mass: 1 },
          Collider: { shape: 'box', halfExtents: [0.5, 0.5, 0.5], friction: 0.9, restitution: 0 },
        },
      },
    ],
  });
  return world;
}

describe('play runtime', () => {
  it('samples a clip onto an entity', async () => {
    const world = createWorld();
    world.add({ id: 'hero', name: 'Hero', parentId: null, components: { transform: { position: { x: 0, y: 0, z: 0 } } } });
    const clip: Clip = {
      version: 1,
      id: 'slide',
      name: 'Slide',
      duration: 1,
      fps: 30,
      loop: false,
      tracks: [
        {
          id: 'x',
          target: { entity: 'hero', component: 'transform', prop: 'position', channel: 0 },
          type: 'number',
          keys: [
            { t: 0, v: 0, interp: 'linear' },
            { t: 1, v: 10, interp: 'linear' },
          ],
        },
      ],
    };
    const session = createPlaySession({ world, clip: () => clip, schedule: () => 0 });
    await session.step(0.5);
    const position = world.get('hero')?.components.transform;
    expect(position).toMatchObject({ position: { x: 5 } });
    session.dispose();
  });

  it('drops a dynamic body onto fixed ground and stop restores the snapshot', async () => {
    const world = fallingWorld();
    const ctx = createEditorContext({ world });
    expect(positionY(world, 'box')).toBe(2);

    for (let frame = 0; frame < 180; frame += 1) await ctx.step();
    const landed = positionY(world, 'box');
    expect(landed).toBeGreaterThan(0.4);
    expect(landed).toBeLessThan(0.75);
    expect(positionY(world, 'ground')).toBeCloseTo(-0.5, 5);

    ctx.stop();
    expect(ctx.getPlayState()).toBe('editing');
    expect(positionY(world, 'box')).toBeCloseTo(2, 5);

    await ctx.step();
    expect(positionY(world, 'box')).toBeLessThan(2);
    ctx.stop();
    expect(positionY(world, 'box')).toBeCloseTo(2, 5);
    ctx.dispose();
  });

  it('reports a script fault and restores the world on stop', () => {
    const registry = createBuiltinRegistry();
    defineScript({
      typeId: 'game/Boom',
      run() {
        throw new Error('boom');
      },
    }).register(registry);
    const logs: string[] = [];
    const world = createWorld();
    const session = createPlaySession({
      world,
      registry,
      graph: boomGraph,
      schedule: () => 0,
      onLog(entry) {
        logs.push(entry.message);
      },
    });
    session.play();
    expect(logs.some((message) => message.includes('boom'))).toBe(true);
    session.dispose();

    const ctx = createEditorContext();
    ctx.play();
    ctx.world.update('player', { name: 'Ghost' });
    ctx.stop();
    expect(ctx.world.get('player')?.name).toBe('Player');
  });
});
