import { describe, expect, it } from 'vitest';
import { Transform } from './components';
import { EcsError } from './errors';
import type { Entity } from './entity';
import { createWorld } from './world';
import type { RenderScene } from './render-scene';

const HALF = Math.SQRT1_2;

describe('setParent keepWorldTransform', () => {
  it('keeps the world matrix under a rotated and uniformly scaled parent', () => {
    const world = createWorld();
    const parent = world.create();
    const child = world.create();
    const grandchild = world.create();
    world.add(parent, Transform, {
      position: [8, -2, 4],
      rotation: [0, HALF, 0, HALF],
      scale: [2, 2, 2],
    });
    world.add(child, Transform, {
      position: [3, 1, -2],
      rotation: [HALF, 0, 0, HALF],
      scale: [1, 2, 0.5],
    });
    world.add(grandchild, Transform, { position: [0, 4, 1], scale: [3, 1, 1] });
    world.setParent(grandchild, child);

    const before = world.renderScene();
    const childWorld = matrixOf(before, child);
    const grandchildWorld = matrixOf(before, grandchild);
    world.setParent(child, parent, { keepWorldTransform: true });

    const after = world.renderScene();
    expect(world.getParent(child)).toBe(parent);
    expect(world.getParent(grandchild)).toBe(child);
    expectMatrix(matrixOf(after, child), childWorld);
    expectMatrix(matrixOf(after, grandchild), grandchildWorld);
    expect(after.dirty[indexOf(after, child)]).toBe(1);
    expect(after.dirty[indexOf(after, grandchild)]).toBe(1);
  });

  it('keeps the world matrix under a 90 degree rotation and a non-uniform scale', () => {
    const world = createWorld();
    const parent = world.create();
    const child = world.create();
    world.add(parent, Transform, { position: [1, 2, 3], rotation: [0, HALF, 0, HALF], scale: [2, 3, 4] });
    world.add(child, Transform, { position: [4, 5, 6] });
    const before = matrixOf(world.renderScene(), child);
    world.setParent(child, parent, { keepWorldTransform: true });
    expectMatrix(matrixOf(world.renderScene(), child), before);
    expect(world.getParent(child)).toBe(parent);
  });

  it('keeps the world matrix under a non-uniform scale with no rotation', () => {
    const world = createWorld();
    const parent = world.create();
    const child = world.create();
    world.add(parent, Transform, { position: [5, 0, -1], scale: [2, 3, 4] });
    world.add(child, Transform, { position: [1, -2, 3], scale: [1, 0.5, 2] });
    const before = matrixOf(world.renderScene(), child);
    world.setParent(child, parent, { keepWorldTransform: true });
    expectMatrix(matrixOf(world.renderScene(), child), before);
  });

  it('bakes the world matrix into the local transform when unparenting', () => {
    const world = createWorld();
    const parent = world.create();
    const child = world.create();
    world.add(parent, Transform, {
      position: [10, 1, 0],
      rotation: [0, 0, HALF, HALF],
      scale: [2, 2, 2],
    });
    world.add(child, Transform, { position: [1, 0, 0] });
    world.setParent(child, parent);
    const before = matrixOf(world.renderScene(), child);
    world.setParent(child, null, { keepWorldTransform: true });
    expect(world.getParent(child)).toBeNull();
    expectMatrix(matrixOf(world.renderScene(), child), before);
  });

  it('leaves the local transform alone when keepWorldTransform is omitted', () => {
    const world = createWorld();
    const parent = world.create();
    const child = world.create();
    world.add(parent, Transform, { position: [10, 0, 0] });
    world.add(child, Transform, { position: [1, 2, 3] });
    world.setParent(child, parent);
    expect(world.get(child, Transform)?.position).toEqual([1, 2, 3]);
    expect(matrixOf(world.renderScene(), child)[12]).toBeCloseTo(11);
  });

  it('rejects a singular parent and a sheared compensation without relinking', () => {
    const world = createWorld();
    const parent = world.create();
    const child = world.create();
    world.add(parent, Transform, { scale: [0, 1, 1] });
    world.add(child, Transform, { position: [4, 5, 6] });
    expect(() => world.setParent(child, parent, { keepWorldTransform: true })).toThrow(EcsError);
    expect(world.getParent(child)).toBeNull();
    expect(world.get(child, Transform)?.position).toEqual([4, 5, 6]);

    const yaw = Math.PI / 8;
    world.set(parent, Transform, { rotation: [0, Math.sin(yaw), 0, Math.cos(yaw)], scale: [2, 3, 4] });
    expect(() => world.setParent(child, parent, { keepWorldTransform: true })).toThrow(/not a position-rotation-scale/);
    expect(world.getParent(child)).toBeNull();
    expect(world.childrenOf(parent)).toEqual([]);
  });
});

describe('parent cycles and ordered children', () => {
  it('rejects cycles and dead parents', () => {
    const world = createWorld();
    const parent = world.create();
    const child = world.create();
    const grandchild = world.create();
    world.setParent(child, parent);
    world.setParent(grandchild, child);
    expect(() => world.setParent(parent, grandchild)).toThrow(EcsError);
    expect(() => world.setParent(parent, parent)).toThrow(EcsError);
    expect(world.getParent(parent)).toBeNull();
    expect(world.getParent(child)).toBe(parent);
    expect(world.getParent(grandchild)).toBe(child);

    world.destroy(parent);
    expect(() => world.setParent(child, parent)).toThrow(EcsError);
  });

  it('appends, inserts, and reorders siblings', () => {
    const world = createWorld();
    const parent = world.create();
    const a = world.create();
    const b = world.create();
    const c = world.create();
    expect(world.childrenOf(null)).toEqual([parent, a, b, c]);

    world.setParent(a, parent);
    world.setParent(c, parent);
    world.setParent(a, parent);
    world.setParent(b, parent, { index: 1 });
    expect(world.childrenOf(parent)).toEqual([a, b, c]);
    expect(world.childrenOf(null)).toEqual([parent]);

    world.setChildIndex(c, 0);
    expect(world.childrenOf(parent)).toEqual([c, a, b]);
    world.setChildIndex(a, 99);
    expect(world.childrenOf(parent)).toEqual([c, b, a]);
    world.setChildIndex(b, -4);
    expect(world.childrenOf(parent)).toEqual([b, c, a]);
  });

  it('promotes children in order when a parent is destroyed', () => {
    const world = createWorld();
    const parent = world.create();
    const a = world.create();
    const b = world.create();
    const c = world.create();
    const d = world.create();
    world.setParent(a, parent);
    world.setParent(b, parent);
    world.setParent(c, a);
    world.setParent(d, a);
    world.destroy(a);
    expect(world.getParent(c)).toBe(parent);
    expect(world.getParent(d)).toBe(parent);
    expect(world.childrenOf(parent)).toEqual([b, c, d]);
  });

  it('round-trips sibling order through scene JSON', () => {
    const world = createWorld();
    const parent = world.create();
    const a = world.create();
    const b = world.create();
    const c = world.create();
    world.setName(b, 'b');
    world.setParent(a, parent);
    world.setParent(c, parent);
    world.setParent(b, parent, { index: 1 });
    const restored = createWorld();
    restored.loadScene(world.toScene());
    expect(restored.childrenOf(parent).map((entity) => restored.getName(entity))).toEqual(['', 'b', '']);
    expect(restored.childrenOf(parent)).toEqual([a, b, c]);
    expect(restored.childrenOf(null)).toEqual([parent]);
  });
});

function indexOf(scene: RenderScene, entity: Entity): number {
  return [...scene.entities].indexOf(entity);
}

function matrixOf(scene: RenderScene, entity: Entity): Float32Array {
  const index = indexOf(scene, entity);
  return scene.worldMatrices.slice(index * 16, index * 16 + 16);
}

function expectMatrix(actual: Float32Array, expected: Float32Array): void {
  for (let lane = 0; lane < 16; lane += 1) {
    expect(actual[lane] ?? Number.NaN).toBeCloseTo(expected[lane] ?? Number.NaN, 4);
  }
}
