import type { Clip } from '@jurfi/anim';
import { createBuiltinRegistry, defineScript, type GraphDoc } from '@jurfi/script';
import { describe, expect, it } from 'vitest';
import { createEditorContext } from './context';
import { createPlaySession } from './play-runtime';
import { createWorld } from './world';

const boomGraph = (): GraphDoc => ({
  version: 1,
  nodes: [
    { id: 'start', type: 'core/OnStart' },
    { id: 'boom', type: 'game/Boom' },
  ],
  edges: [{ from: { node: 'start', pin: 'then' }, to: { node: 'boom', pin: 'exec' } }],
});

describe('play runtime', () => {
  it('samples a clip onto an entity and separates overlapping physics boxes', () => {
    const world = createWorld();
    world.add({ id: 'hero', name: 'Hero', parentId: null, components: { transform: { position: { x: 0, y: 0, z: 0 } } } });
    world.add({
      id: 'a',
      name: 'A',
      parentId: null,
      components: { physics: { x: 0, y: 0, w: 2, h: 2 } },
    });
    world.add({
      id: 'b',
      name: 'B',
      parentId: null,
      components: { physics: { x: 1, y: 0, w: 2, h: 2 } },
    });
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
    session.step(0.5);
    const position = world.get('hero')?.components.transform;
    expect(position).toMatchObject({ position: { x: 5 } });
    expect(world.get('b')?.components.physics).toMatchObject({ x: 2 });
    session.dispose();
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
