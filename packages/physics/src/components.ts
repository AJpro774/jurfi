import { defineComponent } from '@jurfi/core';

/** Authored rigid-body kinds. `kinematic` is position-based. */
export const RIGID_BODY_TYPES = ['dynamic', 'fixed', 'kinematic'] as const;
export type RigidBodyKind = (typeof RIGID_BODY_TYPES)[number];

/**
 * Collider shapes Rapier can build today.
 * A future `mesh` shape is intentionally not accepted yet.
 */
export const COLLIDER_SHAPES = ['box', 'sphere', 'capsule', 'cylinder'] as const;
export type ColliderShape = (typeof COLLIDER_SHAPES)[number];

/**
 * Authored rigid body. Runtime Rapier handles are not fields on this component,
 * so they stay out of scene JSON.
 *
 * `type` is `dynamic`, `fixed`, or `kinematic`.
 * `mass` is kilograms for a dynamic body (collider density is not added on top).
 * `ccd` enables continuous collision detection.
 */
export const RigidBody = defineComponent('RigidBody', {
  type: { type: 'string', default: 'dynamic' },
  mass: { type: 'number', default: 1 },
  linearDamping: { type: 'number', default: 0 },
  angularDamping: { type: 'number', default: 0 },
  gravityScale: { type: 'number', default: 1 },
  ccd: { type: 'boolean', default: false },
});

/**
 * One collider on the same entity as {@link RigidBody}.
 * A collider without a rigid body is not simulated.
 *
 * `halfExtents` is the box half-size in meters. `radius` is the sphere, capsule,
 * or cylinder radius. `halfHeight` is the capsule or cylinder half-length along Y,
 * not counting a capsule's end caps.
 * `layer` is the 16-bit membership and `mask` is the 16-bit filter.
 * A pair collides when each layer shares a bit with the other's mask.
 */
export const Collider = defineComponent('Collider', {
  shape: { type: 'string', default: 'box' },
  halfExtents: { type: 'vec3', default: [0.5, 0.5, 0.5] },
  radius: { type: 'number', default: 0.5 },
  halfHeight: { type: 'number', default: 0.5 },
  friction: { type: 'number', default: 0.5 },
  restitution: { type: 'number', default: 0 },
  sensor: { type: 'boolean', default: false },
  layer: { type: 'number', default: 0xffff },
  mask: { type: 'number', default: 0xffff },
});
