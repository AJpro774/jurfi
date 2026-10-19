import { Transform, createWorld, type Entity, type World } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
import { Collider, DEFAULT_FIXED_DT, PhysicsWorld, RigidBody, clampPos, overlaps } from './index';

describe('aabb helpers', () => {
  it('keeps overlaps and clampPos', () => {
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 })).toBe(false);
    expect(clampPos(5, 0, 1)).toBe(1);
    expect(clampPos(-2, 0, 1)).toBe(0);
  });
});

describe('Rapier world', () => {
  it('drops a box onto fixed ground and writes the Transform back', async () => {
    await withPhysics(async (ecs, physics) => {
      const ground = addBody(ecs, [0, -0.5, 0], { type: 'fixed' }, { halfExtents: [20, 0.5, 20] });
      const box = addBody(
        ecs,
        [0, 2, 0],
        { type: 'dynamic', mass: 1 },
        { halfExtents: [0.5, 0.5, 0.5], friction: 0.9, restitution: 0 },
        [2, 3, 4],
      );

      for (let frame = 0; frame < 360; frame += 1) {
        ecs.time.tick(DEFAULT_FIXED_DT);
        physics.step(ecs.time.delta);
      }

      const landed = pose(ecs, box);
      expect(landed.y).toBeGreaterThan(0.4);
      expect(landed.y).toBeLessThan(0.75);
      expect(landed.y).toBeLessThan(1.5);
      expect(Math.abs(landed.x)).toBeLessThan(0.05);
      expect(Math.abs(landed.z)).toBeLessThan(0.05);
      expect(pose(ecs, ground).y).toBeCloseTo(-0.5, 5);
      expect(ecs.get(box, Transform)?.scale).toEqual([2, 3, 4]);

      for (let frame = 0; frame < 60; frame += 1) {
        ecs.time.tick(DEFAULT_FIXED_DT);
        physics.step(ecs.time.delta);
      }
      expect(Math.abs(pose(ecs, box).y - landed.y)).toBeLessThan(0.01);
    });
  });

  it('raycasts the closest body and honors the entity filter', async () => {
    await withPhysics(async (ecs, physics) => {
      const ground = addBody(ecs, [0, -0.5, 0], { type: 'fixed' }, { halfExtents: [10, 0.5, 10] });
      const box = addBody(ecs, [0, 3, 0], { type: 'dynamic' }, { halfExtents: [0.5, 0.5, 0.5] });

      const hit = physics.raycast([0, 8, 0], [0, -1, 0], 20);
      expect(hit.hit).toBe(true);
      expect(hit.entity).toBe(box);
      expect(hit.toi).toBeCloseTo(4.5, 3);
      expect(hit.point[1]).toBeCloseTo(3.5, 3);
      expect(hit.normal[1]).toBeCloseTo(1, 3);

      const groundHit = physics.raycast([0, 8, 0], [0, -1, 0], 20, (entity) => entity !== box);
      expect(groundHit.hit).toBe(true);
      expect(groundHit.entity).toBe(ground);
      expect(groundHit.point[1]).toBeCloseTo(0, 3);

      const miss = physics.raycast([0, 8, 0], [0, -1, 0], 20, () => false);
      expect(miss).toEqual({ hit: false, point: [0, 0, 0], normal: [0, 0, 0], toi: 0, entity: null });
    });
  });

  it('frees the Rapier body when the RigidBody component or the entity goes away', async () => {
    await withPhysics(async (ecs, physics) => {
      const ground = addBody(ecs, [0, -0.5, 0], { type: 'fixed' }, { halfExtents: [4, 0.5, 4] });
      const box = addBody(ecs, [0, 2, 0], { type: 'dynamic' }, { halfExtents: [0.5, 0.5, 0.5] });
      expect(physics.bodyCount).toBe(2);
      expect(physics.raycast([0, 2, 5], [0, 0, -1], 10).entity).toBe(box);

      ecs.remove(box, RigidBody);
      expect(ecs.has(box, Collider)).toBe(true);
      expect(physics.bodyCount).toBe(1);
      expect(physics.raycast([0, 2, 5], [0, 0, -1], 10).hit).toBe(false);
      expect(physics.raycast([0, 5, 0], [0, -1, 0], 20).entity).toBe(ground);

      ecs.destroy(ground);
      expect(physics.bodyCount).toBe(0);
      expect(physics.raycast([0, 5, 0], [0, -1, 0], 20).hit).toBe(false);
    });
  });

  it('matches fixed steps across variable frame dts', async () => {
    const fixed = DEFAULT_FIXED_DT;
    const uniform = Array.from({ length: 40 }, () => fixed);
    const varied = [fixed * 3, fixed * 3, fixed * 4, fixed * 2, fixed * 5, fixed * 7, fixed * 6, fixed * 5, fixed * 5];
    const halves = Array.from({ length: 80 }, () => fixed / 2);
    expect(varied.reduce((sum, dt) => sum + dt, 0)).toBeCloseTo(40 * fixed, 10);

    const [even, mixed, split, short] = await Promise.all([
      fall(uniform),
      fall(varied),
      fall(halves),
      fall(halves.slice(0, 79)),
    ]);

    expect(even.steps).toBe(40);
    expect(mixed.steps).toBe(40);
    expect(split.steps).toBe(40);
    expect(short.steps).toBe(39);
    expect(mixed.y).toBeCloseTo(even.y, 4);
    expect(split.y).toBeCloseTo(even.y, 4);
    expect(Math.abs(short.y - even.y)).toBeGreaterThan(0.05);
    expect(even.y).toBeLessThan(10);
  });

  it('holds a half step in the accumulator until a full fixed step is due', async () => {
    await withPhysics(async (ecs, physics) => {
      const box = addBody(ecs, [0, 6, 0], { type: 'dynamic' }, { halfExtents: [0.5, 0.5, 0.5] });
      expect(physics.step(DEFAULT_FIXED_DT / 2)).toBe(0);
      expect(pose(ecs, box).y).toBeCloseTo(6, 5);
      expect(physics.step(DEFAULT_FIXED_DT / 2)).toBe(1);
      expect(pose(ecs, box).y).toBeLessThan(6);
    });
  });

  it('teleports a dynamic body and pushes a kinematic body from Transform', async () => {
    await withPhysics(async (ecs, physics) => {
      const box = addBody(ecs, [0, 4, 0], { type: 'dynamic' }, { halfExtents: [0.4, 0.4, 0.4] });
      physics.step(DEFAULT_FIXED_DT);
      ecs.set(box, Transform, { position: [0, 12, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
      physics.step(DEFAULT_FIXED_DT);
      const teleported = pose(ecs, box);
      expect(teleported.y).toBeGreaterThan(11.9);
      expect(teleported.y).toBeLessThan(12);

      const platform = addBody(
        ecs,
        [2, 1, 0],
        { type: 'kinematic' },
        { halfExtents: [0.5, 0.25, 0.5] },
      );
      expect(physics.raycast([2, 4, 0], [0, -1, 0], 10).point[1]).toBeCloseTo(1.25, 3);
      ecs.set(platform, Transform, { position: [2, 3, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
      physics.step(DEFAULT_FIXED_DT);
      const moved = physics.raycast([2, 6, 0], [0, -1, 0], 10);
      expect(moved.entity).toBe(platform);
      expect(moved.point[1]).toBeCloseTo(3.25, 3);
    });
  });

  it('serializes authored components only and rebuilds bodies from the scene', async () => {
    await withPhysics(async (ecs, physics) => {
      addBody(ecs, [0, -0.5, 0], { type: 'fixed' }, { halfExtents: [3, 0.5, 3] });
      const box = addBody(ecs, [1, 2, 3], { type: 'dynamic', mass: 2.5 }, { shape: 'sphere', radius: 0.4 });
      expect(physics.bodyCount).toBe(2);

      const scene = ecs.toScene();
      const encoded = JSON.stringify(scene);
      expect(encoded).not.toContain('handle');
      const saved = scene.entities.find((entity) => entity.id === box);
      expect(saved?.components.RigidBody).toMatchObject({
        type: 'dynamic',
        mass: 2.5,
        linearDamping: 0,
        angularDamping: 0,
        gravityScale: 1,
        ccd: false,
      });
      expect(saved?.components.Collider).toMatchObject({ shape: 'sphere', radius: 0.4, sensor: false });
      expect(saved?.components.RigidBody).not.toHaveProperty('handle');

      const restored = createWorld();
      const next = await PhysicsWorld.create({ fixedDt: DEFAULT_FIXED_DT });
      try {
        next.attach(restored);
        restored.loadScene(scene);
        expect(next.bodyCount).toBe(2);
        const hit = next.raycast([1, 6, 3], [0, -1, 0], 10);
        expect(hit.hit).toBe(true);
        expect(hit.entity).toBe(box);
        expect(hit.toi).toBeCloseTo(3.6, 3);
      } finally {
        next.destroy();
      }
    });
  });

  it('builds sphere, capsule, and cylinder colliders', async () => {
    await withPhysics(async (ecs, physics) => {
      addBody(ecs, [0, 0, 0], { type: 'fixed' }, { shape: 'sphere', radius: 0.5 });
      addBody(ecs, [3, 0, 0], { type: 'fixed' }, { shape: 'capsule', radius: 0.3, halfHeight: 0.4 });
      addBody(ecs, [6, 0, 0], { type: 'fixed' }, { shape: 'cylinder', radius: 0.4, halfHeight: 0.6 });
      expect(physics.raycast([0, 3, 0], [0, -1, 0], 5).hit).toBe(true);
      expect(physics.raycast([3, 3, 0], [0, -1, 0], 5).hit).toBe(true);
      expect(physics.raycast([6, 3, 0], [0, -1, 0], 5).hit).toBe(true);
    });
  });
});

async function withPhysics<T>(run: (ecs: World, physics: PhysicsWorld) => Promise<T>): Promise<T> {
  const ecs = createWorld();
  const physics = await PhysicsWorld.create({ gravity: [0, -9.81, 0], fixedDt: DEFAULT_FIXED_DT });
  physics.attach(ecs);
  try {
    return await run(ecs, physics);
  } finally {
    physics.destroy();
  }
}

async function fall(dts: readonly number[]): Promise<{ y: number; steps: number }> {
  return withPhysics(async (ecs, physics) => {
    const box = addBody(ecs, [0, 10, 0], { type: 'dynamic' }, { halfExtents: [0.5, 0.5, 0.5] });
    let steps = 0;
    for (const dt of dts) {
      ecs.time.tick(dt);
      steps += physics.step(ecs.time.delta);
    }
    return { y: pose(ecs, box).y, steps };
  });
}

function addBody(
  ecs: World,
  position: [number, number, number],
  body: { type: 'dynamic' | 'fixed' | 'kinematic'; mass?: number; linearDamping?: number },
  collider: {
    shape?: 'box' | 'sphere' | 'capsule' | 'cylinder';
    halfExtents?: [number, number, number];
    radius?: number;
    halfHeight?: number;
    friction?: number;
    restitution?: number;
  },
  scale: [number, number, number] = [1, 1, 1],
): Entity {
  const entity = ecs.create();
  ecs.add(entity, Transform, { position, rotation: [0, 0, 0, 1], scale });
  ecs.add(entity, RigidBody, {
    type: body.type,
    mass: body.mass ?? 1,
    linearDamping: body.linearDamping ?? 0,
  });
  ecs.add(entity, Collider, {
    shape: collider.shape ?? 'box',
    halfExtents: collider.halfExtents ?? [0.5, 0.5, 0.5],
    radius: collider.radius ?? 0.5,
    halfHeight: collider.halfHeight ?? 0.5,
    friction: collider.friction ?? 0.8,
    restitution: collider.restitution ?? 0,
  });
  return entity;
}

function pose(ecs: World, entity: Entity): { x: number; y: number; z: number } {
  const transform = ecs.get(entity, Transform);
  const position = transform?.position;
  if (!position) throw new Error('missing Transform');
  return { x: position[0], y: position[1], z: position[2] };
}
