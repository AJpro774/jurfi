import { Light, Transform, createWorld, type World } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
import { applyClip } from './bind';
import type { Clip, Track } from './types';

function clip(tracks: Track[]): Clip {
  return {
    version: 1,
    id: 'clip',
    name: 'Move',
    duration: 1,
    fps: 30,
    loop: false,
    tracks,
  };
}

function track(partial: Partial<Track> & Pick<Track, 'target' | 'keys'>): Track {
  return { id: partial.id ?? 'track', type: partial.type, target: partial.target, keys: partial.keys };
}

function quiet(world: World, doc: Clip, t: number, recordHistory = true) {
  return applyClip(world, doc, t, { warn() {}, recordHistory });
}

describe('applyClip', () => {
  it('writes a channel and a quaternion onto Transform by alias', () => {
    const world = createWorld();
    const entity = world.create();
    world.setAlias(entity, 'player');
    world.add(entity, Transform);

    const warnings = quiet(
      world,
      clip([
        track({
          id: 'x',
          type: 'number',
          target: { entity: 'player', component: 'transform', prop: 'position', channel: 0 },
          keys: [
            { t: 0, v: 0, interp: 'linear' },
            { t: 1, v: 4, interp: 'linear' },
          ],
        }),
        track({
          id: 'rot',
          type: 'quat',
          target: { entity: 'player', component: 'Transform', prop: 'rotation' },
          keys: [
            { t: 0, v: [0, 0, 0, 1], interp: 'linear' },
            { t: 1, v: [0, 1, 0, 0], interp: 'linear' },
          ],
        }),
      ]),
      0.5,
    );

    expect(warnings).toEqual([]);
    expect(world.getField(entity, Transform, 'position.x')).toBeCloseTo(2);
    expect(world.getField(entity, Transform, 'position.y')).toBe(0);
    const rotation = world.getField(entity, Transform, 'rotation') as number[];
    expect(rotation[1]).toBeGreaterThan(0.5);
    expect(rotation[3]).toBeGreaterThan(0.5);
  });

  it('mirrors schema writes into the viewport transform object', () => {
    const world = createWorld();
    const entity = world.create();
    world.setAlias(entity, 'player');
    world.add(entity, Transform, { position: [0, 1, 0] });
    world.set(entity, 'transform', {
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });

    const warnings = quiet(
      world,
      clip([
        track({
          id: 'y',
          type: 'number',
          target: { entity: 'player', component: 'transform', prop: 'position', channel: 1 },
          keys: [
            { t: 0, v: 1, interp: 'linear' },
            { t: 1, v: 3, interp: 'linear' },
          ],
        }),
        track({
          id: 'rot',
          type: 'quat',
          target: { entity: 'player', component: 'transform', prop: 'rotation' },
          keys: [{ t: 0, v: [0, 0, 0, 1], interp: 'linear' }],
        }),
      ]),
      1,
    );

    expect(warnings).toEqual([]);
    expect(world.getField(entity, Transform, 'position')).toEqual([0, 3, 0]);
    expect(world.getField(entity, 'transform', 'position')).toEqual({ x: 0, y: 3, z: 0 });
    expect(world.getField(entity, 'transform', 'rotation')).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('writes a JSON component that is not a schema, including array channels', () => {
    const world = createWorld();
    const entity = world.create();
    world.setAlias(entity, 'player');
    world.set(entity, 'note', { label: 'idle', score: [1, 2, 3] });

    const warnings = quiet(
      world,
      clip([
        track({
          id: 'label',
          type: 'string',
          target: { entity: 'player', component: 'note', prop: 'label' },
          keys: [{ t: 0, v: 'run', interp: 'step' }],
        }),
        track({
          id: 'score',
          type: 'number',
          target: { entity: 'player', component: 'note', prop: 'score', channel: 1 },
          keys: [{ t: 0, v: 9, interp: 'step' }],
        }),
      ]),
      0,
    );

    expect(warnings).toEqual([]);
    expect(world.getField(entity, 'note', 'label')).toBe('run');
    expect(world.getField(entity, 'note', 'score')).toEqual([1, 9, 3]);
  });

  it('warns for an unknown entity, a missing component, and a bad channel without throwing', () => {
    const world = createWorld();
    const entity = world.create();
    world.setAlias(entity, 'player');
    world.add(entity, Transform);
    world.add(entity, Light);

    const warnings = quiet(
      world,
      clip([
        track({
          id: 'missing-entity',
          target: { entity: 'hero', component: 'Transform', prop: 'position', channel: 0 },
          keys: [{ t: 0, v: 1, interp: 'linear' }],
        }),
        track({
          id: 'missing-component',
          target: { entity: 'player', component: 'sprite', prop: 'color', channel: 0 },
          keys: [{ t: 0, v: 1, interp: 'linear' }],
        }),
        track({
          id: 'bad-channel',
          target: { entity: 'player', component: 'Transform', prop: 'position', channel: 3 },
          keys: [{ t: 0, v: 1, interp: 'linear' }],
        }),
        track({
          id: 'bad-field',
          target: { entity: 'player', component: 'Light', prop: 'radius' },
          keys: [{ t: 0, v: 2, interp: 'linear' }],
        }),
      ]),
      0,
    );

    expect(warnings.map((warning) => warning.trackId)).toEqual([
      'missing-entity',
      'missing-component',
      'bad-channel',
      'bad-field',
    ]);
    expect(warnings[0]?.message).toContain('Unknown entity "hero"');
    expect(warnings[1]?.message).toContain('Unknown component "sprite"');
    expect(warnings[2]?.message).toContain('out of range');
    expect(warnings[3]?.message).toContain('Unknown field "Light.radius"');
    expect(world.getField(entity, Transform, 'position.x')).toBe(0);
  });

  it('skips muted tracks and can leave the undo stack alone', () => {
    const world = createWorld();
    const entity = world.create();
    world.setAlias(entity, 'player');
    world.add(entity, Transform);
    world.clearHistory();

    const doc = clip([
      track({
        id: 'x',
        target: { entity: 'player', component: 'Transform', prop: 'position', channel: 0 },
        keys: [{ t: 0, v: 5, interp: 'step' }],
      }),
      track({
        id: 'y',
        target: { entity: 'player', component: 'Transform', prop: 'position', channel: 1 },
        keys: [{ t: 0, v: 6, interp: 'step' }],
      }),
    ]);
    const warnings = applyClip(world, doc, 0, { skip: new Set(['y']), recordHistory: false, warn() {} });
    expect(warnings).toEqual([]);
    expect(world.getField(entity, Transform, 'position')).toEqual([5, 0, 0]);
    expect(world.canUndo()).toBe(false);
  });
});
