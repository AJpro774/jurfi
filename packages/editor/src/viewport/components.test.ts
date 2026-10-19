import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { IDENTITY_TRANSFORM, entityShape, entityTransform, isDrawable, writeTransform } from './components';

describe('viewport scene components', () => {
  it('draws the default player and skips the scene root and camera', () => {
    const world = createWorld();
    const scene = world.get('scene');
    const camera = world.get('camera');
    const player = world.get('player');
    expect(scene && isDrawable(scene)).toBe(false);
    expect(camera && isDrawable(camera)).toBe(false);
    expect(player && isDrawable(player)).toBe(true);
    expect(player && entityShape(player)).toBe('box');
    expect(player && entityTransform(player)).toEqual(IDENTITY_TRANSFORM);
  });

  it('reads a mesh shape and falls back when transform data is partial', () => {
    const world = createWorld();
    world.add({
      id: 'orb',
      name: 'Orb',
      parentId: 'scene',
      components: { mesh: { shape: 'sphere' }, transform: { position: { x: 2 } } },
    });
    const orb = world.get('orb');
    expect(orb && entityShape(orb)).toBe('sphere');
    expect(orb && entityTransform(orb).position).toEqual({ x: 2, y: 0, z: 0 });
    expect(orb && entityTransform(orb).scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('writes a transform without dropping other component keys', () => {
    const world = createWorld();
    writeTransform(world, 'player', {
      position: { x: 3, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 2, y: 2, z: 2 },
    });
    const player = world.get('player');
    expect(player?.components.health).toBe(-1);
    expect(player?.components.kind).toBe('node');
    expect(player && entityTransform(player).position.x).toBe(3);
    expect(player && entityTransform(player).scale.x).toBe(2);
  });
});
