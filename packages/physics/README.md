# @jurfi/physics

3D rigid bodies for Jurfi, backed by [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat`). The WASM module loads on `PhysicsWorld.create()`. Importing `overlaps` or the component types does not initialize it. Rapier stays its own module and is not linked into `@jurfi/wasm`.

`overlaps` and `clampPos` are the existing 2D helpers. Pong still uses `overlaps`.

## Components

`RigidBody` and `Collider` are core ECS components (`defineComponent`). Scene JSON stores only those fields. Rapier body and collider handles live on the `PhysicsWorld` and are never written onto the entity.

```ts
import { Transform, createWorld } from '@jurfi/core';
import { Collider, PhysicsWorld, RigidBody } from '@jurfi/physics';

const world = createWorld();
const physics = await PhysicsWorld.create({
  gravity: [0, -9.81, 0],
  fixedDt: 1 / 60,
});
physics.attach(world);

const ground = world.create();
world.add(ground, Transform, { position: [0, -0.5, 0] });
world.add(ground, RigidBody, { type: 'fixed' });
world.add(ground, Collider, { shape: 'box', halfExtents: [20, 0.5, 20] });

const box = world.create();
world.add(box, Transform, { position: [0, 2, 0] });
world.add(box, RigidBody, { type: 'dynamic', mass: 1, ccd: false });
world.add(box, Collider, {
  shape: 'box',
  halfExtents: [0.5, 0.5, 0.5],
  friction: 0.5,
  restitution: 0,
  layer: 0xffff,
  mask: 0xffff,
});
```

`RigidBody.type` is `dynamic`, `fixed`, or `kinematic` (position-based). `mass`, `linearDamping`, `angularDamping`, `gravityScale`, and `ccd` are the other body fields.

`Collider.shape` is `box`, `sphere`, `capsule`, or `cylinder`. Mesh shapes are not built yet; any other shape string throws. `halfExtents` is the box half-size. `radius` is the sphere, capsule, or cylinder radius. `halfHeight` is the capsule or cylinder half-length along Y and does not include a capsule's end caps. `sensor` emits overlaps without a solid response. `layer` and `mask` are 16-bit membership and filter bits: two colliders touch when each layer shares a bit with the other's mask.

A `Collider` with no `RigidBody` is ignored. Removing `RigidBody`, or destroying the entity, removes the Rapier body immediately.

## Stepping

`step(dt)` is a fixed-timestep accumulator. `dt` is the frame delta in seconds. The world integrates in steps of `fixedDt` (default `1 / 60`) and returns how many of those steps ran. Pass the core clock:

```ts
world.time.tick(frameSeconds);
physics.step(world.time.delta);
```

Dynamic bodies write `Transform` position and quaternion back after the step and leave scale alone. Kinematic bodies copy `Transform` in with `setNextKinematicTranslation` / `setNextKinematicRotation` on every fixed step. A dynamic or fixed body whose `Transform` moved outside the last physics write is teleported (velocity cleared) before the next integration. Poses are local: parented entities are not composed into world space, and `Transform.scale` does not resize the collider.

```ts
const hit = physics.raycast([0, 5, 0], [0, -1, 0], 20, (entity) => entity !== ignore);
// hit.hit, hit.point, hit.normal, hit.toi, hit.entity
```

`dir` is normalized, so `maxToi` is a distance in meters. The filter returns true to keep an entity. The cast tests each collider directly, so a body is visible as soon as it is created, without waiting for a simulation step. `layer` / `mask` filter contacts between colliders; they do not filter this ray.

`destroy()` unsubscribes from the ECS world and frees the Rapier world.

## Editor Play mode

Play mode on main does not tick a simulation. The fake solver is on open PR #37 (`cursor/editor-play-runtime-1f32`, `packages/editor/src/play-runtime.ts`, local `stepPhysics`). That function pushes overlapping `components.physics` AABBs apart with `overlaps` and `clampPos` because this package did not have a world yet. It targets the editor's string-id `EditorWorld`, not the core ECS, so it is not wired from this package. `overlaps` and `clampPos` stay exported and the editor package is unchanged, so that branch still builds.

When that session has a core `World`, replace `stepPhysics(options.world)` with a Rapier world created once for the play session:

```ts
const physics = await PhysicsWorld.create({ gravity: [0, -9.81, 0], fixedDt: 1 / 60 });
physics.attach(ecs);
// each playing frame, after the core clock ticks:
ecs.time.tick(dt);
physics.step(ecs.time.delta);
// on stop / dispose:
physics.destroy();
```

Give the entities `Transform`, `RigidBody`, and `Collider` instead of a `components.physics` AABB.
