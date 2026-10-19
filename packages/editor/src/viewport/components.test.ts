import { createEditorWorld, Transform } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
import { createDefaultSnapshot } from '../world';
import { IDENTITY_TRANSFORM, entityShape, isDrawable, readTransform, writeTransform } from './components';

describe('viewport scene components', () => {
  it('draws entities that have a mesh or Transform and skips the scene root', () => {
    const world = createEditorWorld();
    world.deserialize(createDefaultSnapshot());
    const ecs = world.ecs;
    const scene = ecs.resolveAlias('scene');
    const camera = ecs.resolveAlias('camera');
    const player = ecs.resolveAlias('player');
    expect(scene).toBeDefined();
    expect(camera).toBeDefined();
    expect(player).toBeDefined();
    if (scene === undefined || camera === undefined || player === undefined) return;
    expect(isDrawable(ecs, scene)).toBe(false);
    expect(isDrawable(ecs, camera)).toBe(false);
    expect(isDrawable(ecs, player)).toBe(false);
    ecs.set(player, 'mesh', { shape: 'box' });
    expect(isDrawable(ecs, player)).toBe(true);
    expect(entityShape(ecs, player)).toBe('box');
    expect(readTransform(ecs, player)).toEqual(IDENTITY_TRANSFORM);
  });

  it('reads a mesh shape and Transform arrays', () => {
    const world = createEditorWorld();
    const ecs = world.ecs;
    const orb = ecs.create();
    ecs.setAlias(orb, 'orb');
    ecs.set(orb, 'mesh', { shape: 'sphere' });
    ecs.set(orb, Transform, { position: [2, 0, 0] });
    expect(entityShape(ecs, orb)).toBe('sphere');
    expect(readTransform(ecs, orb).position).toEqual({ x: 2, y: 0, z: 0 });
    expect(readTransform(ecs, orb).scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('writes a Transform without dropping other components', () => {
    const world = createEditorWorld();
    world.deserialize(createDefaultSnapshot());
    const ecs = world.ecs;
    const player = ecs.resolveAlias('player');
    expect(player).toBeDefined();
    if (player === undefined) return;
    writeTransform(ecs, player, {
      position: { x: 3, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 2, y: 2, z: 2 },
    });
    expect(ecs.get(player, 'health')).toBe(-1);
    expect(ecs.get(player, 'kind')).toBe('node');
    expect(readTransform(ecs, player).position.x).toBe(3);
    expect(readTransform(ecs, player).scale.x).toBe(2);
  });
});
