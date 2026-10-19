import { Transform, type Entity, type World } from '@jurfi/core';
import { COLLIDER_SHAPES, RIGID_BODY_TYPES, Collider, RigidBody, type ColliderShape, type RigidBodyKind } from './components';
import {
  loadRapier,
  type RBody,
  type RCollider,
  type RColliderDesc,
  type Rapier,
  type RWorld,
} from './rapier';

/** Default gravity, meters per second squared, Y up. */
export const DEFAULT_GRAVITY: readonly [number, number, number] = [0, -9.81, 0];

/** Default fixed step, seconds. Matches a 60 Hz simulation. */
export const DEFAULT_FIXED_DT = 1 / 60;

const DEFAULT_MAX_SUBSTEPS = 120;
const MIN_EXTENT = 1e-4;
const MIN_MASS = 1e-3;
const POSE_EPS = 1e-6;

export interface PhysicsWorldOptions {
  /** World-space acceleration. Default {@link DEFAULT_GRAVITY}. */
  gravity?: readonly [number, number, number];
  /** Fixed integration step in seconds. Default {@link DEFAULT_FIXED_DT}. */
  fixedDt?: number;
  /**
   * Maximum fixed steps drained from one `step(dt)`.
   * Time beyond this is dropped so a long hitch cannot stall the frame. Default 120.
   */
  maxSubsteps?: number;
}

/** Return true to accept a hit. Omit the filter to accept every collider. */
export type RaycastFilter = (entity: Entity) => boolean;

export interface RaycastHit {
  hit: boolean;
  /** World-space point. `[0, 0, 0]` when `hit` is false. */
  point: readonly [number, number, number];
  /** Outward unit normal. `[0, 0, 0]` when `hit` is false. */
  normal: readonly [number, number, number];
  /** Distance along the normalized ray. `0` when `hit` is false. */
  toi: number;
  entity: Entity | null;
}

/**
 * Rapier world plus the ECS sync system.
 *
 * `step(dt)` accumulates variable frame time and integrates at `fixedDt`.
 * Pass `world.time.delta` after `world.time.tick` so the core clock drives the frame.
 * Dynamic poses are written back to `Transform`. Kinematic and teleported poses are
 * copied in before the step. Rapier handles live only in this object.
 */
export interface PhysicsWorld {
  readonly fixedDt: number;
  readonly gravity: readonly [number, number, number];
  /** Live Rapier bodies created from `RigidBody` components. */
  readonly bodyCount: number;
  /** Watch `world` and keep a Rapier body for each `RigidBody`. Replaces a previous binding. */
  attach(world: World): void;
  /**
   * Accumulate `dt` seconds and run as many fixed steps as are due.
   * Returns how many fixed steps ran.
   */
  step(dt: number): number;
  /**
   * Closest hit within `maxToi` meters. `dir` is normalized internally, so `maxToi` is a distance.
   * `filter` returns true to keep an entity.
   */
  raycast(
    origin: readonly [number, number, number],
    dir: readonly [number, number, number],
    maxToi: number,
    filter?: RaycastFilter,
  ): RaycastHit;
  /** Drop the ECS binding and free the Rapier world. Further calls throw, except `destroy` itself. */
  destroy(): void;
}

interface Pose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  rw: number;
}

interface BodyRecord {
  entity: Entity;
  body: RBody;
  collider: RCollider | null;
  colliderKey: string;
  kind: RigidBodyKind;
  mass: number;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  ccd: boolean;
  friction: number;
  restitution: number;
  sensor: boolean;
  groups: number;
  synced: Pose;
}

const IDENTITY: Pose = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, rw: 1 };

export const PhysicsWorld = {
  /**
   * Create a Rapier world. The WASM module is imported here, not when `@jurfi/physics` is first imported.
   * Rapier stays its own module; it is not linked into `@jurfi/wasm`.
   */
  create(options?: PhysicsWorldOptions): Promise<PhysicsWorld> {
    return RapierPhysics.create(options ?? {});
  },
};

class RapierPhysics implements PhysicsWorld {
  readonly fixedDt: number;
  readonly gravity: readonly [number, number, number];
  private readonly maxSubsteps: number;
  private readonly records = new Map<Entity, BodyRecord>();
  private accumulator = 0;
  private ecs: World | null = null;
  private unsubscribe: (() => void) | null = null;
  private applying = false;
  private stepping = false;
  private destroyed = false;

  private constructor(
    private readonly rapier: Rapier,
    private raw: RWorld | null,
    gravity: readonly [number, number, number],
    fixedDt: number,
    maxSubsteps: number,
  ) {
    this.gravity = gravity;
    this.fixedDt = fixedDt;
    this.maxSubsteps = maxSubsteps;
  }

  static async create(options: PhysicsWorldOptions): Promise<PhysicsWorld> {
    const gravity = finite3(options.gravity ?? DEFAULT_GRAVITY, 'gravity');
    const fixedDt = options.fixedDt ?? DEFAULT_FIXED_DT;
    const maxSubsteps = options.maxSubsteps ?? DEFAULT_MAX_SUBSTEPS;
    if (!(fixedDt > 0) || !Number.isFinite(fixedDt)) {
      throw new Error('PhysicsWorld fixedDt must be a positive finite number of seconds');
    }
    if (!Number.isInteger(maxSubsteps) || maxSubsteps < 1) {
      throw new Error('PhysicsWorld maxSubsteps must be an integer >= 1');
    }
    const rapier = await loadRapier();
    const raw = new rapier.World({ x: gravity[0], y: gravity[1], z: gravity[2] });
    raw.timestep = fixedDt;
    return new RapierPhysics(rapier, raw, gravity, fixedDt, maxSubsteps);
  }

  get bodyCount(): number {
    return this.records.size;
  }

  attach(world: World): void {
    this.assertOpen();
    if (this.ecs === world) return;
    this.releaseBinding();
    this.ecs = world;
    this.unsubscribe = world.subscribe(() => {
      if (this.applying) return;
      this.reconcile();
    });
    this.reconcile();
  }

  step(dt: number): number {
    this.assertOpen();
    if (typeof dt !== 'number' || !Number.isFinite(dt)) {
      throw new Error('PhysicsWorld.step expects a finite dt in seconds');
    }
    if (this.stepping) throw new Error('PhysicsWorld.step cannot be re-entered');
    if (dt <= 0) return 0;
    this.stepping = true;
    try {
      this.reconcile();
      const steps = this.drain(dt);
      this.writeBack();
      return steps;
    } finally {
      this.stepping = false;
    }
  }

  raycast(
    origin: readonly [number, number, number],
    dir: readonly [number, number, number],
    maxToi: number,
    filter?: RaycastFilter,
  ): RaycastHit {
    this.assertOpen();
    const raw = this.raw;
    if (!raw) return miss();
    const from = finite3(origin, 'raycast origin');
    const direction = finite3(dir, 'raycast dir');
    if (typeof maxToi !== 'number' || !Number.isFinite(maxToi) || maxToi < 0) {
      throw new Error('PhysicsWorld.raycast maxToi must be a non-negative finite distance');
    }
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (length === 0 || maxToi === 0) return miss();
    const scale = 1 / length;
    const ray = new this.rapier.Ray(
      { x: from[0], y: from[1], z: from[2] },
      { x: direction[0] * scale, y: direction[1] * scale, z: direction[2] * scale },
    );
    // Rapier 0.21's world query reads the broad-phase, which stays empty until `step`.
    // Casting each collider uses the pose we just propagated, including bodies that have not stepped yet.
    raw.propagateModifiedBodyPositionsToColliders();
    let bestToi = maxToi;
    let best: RaycastHit | null = null;
    for (const record of this.records.values()) {
      const collider = record.collider;
      if (!collider) continue;
      if (filter && !filter(record.entity)) continue;
      const hit = collider.castRayAndGetNormal(ray, bestToi, true);
      if (!hit || hit.timeOfImpact < 0 || hit.timeOfImpact > bestToi) continue;
      const point = ray.pointAt(hit.timeOfImpact);
      bestToi = hit.timeOfImpact;
      best = {
        hit: true,
        point: [point.x, point.y, point.z],
        normal: [hit.normal.x, hit.normal.y, hit.normal.z],
        toi: hit.timeOfImpact,
        entity: record.entity,
      };
    }
    return best ?? miss();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseBinding();
    this.records.clear();
    this.raw?.free();
    this.raw = null;
  }

  private drain(dt: number): number {
    const raw = this.raw;
    if (!raw) return 0;
    this.accumulator += dt;
    const cap = this.fixedDt * this.maxSubsteps;
    if (this.accumulator > cap) this.accumulator = cap;
    let steps = 0;
    while (steps < this.maxSubsteps && this.accumulator >= this.fixedDt - 1e-10) {
      // Refresh the kinematic target every substep so a large frame does not
      // treat one pose delta as a velocity and overshoot.
      this.pushKinematics();
      raw.step();
      this.accumulator -= this.fixedDt;
      steps += 1;
      if (Math.abs(this.accumulator) < 1e-10) this.accumulator = 0;
    }
    return steps;
  }

  private pushKinematics(): void {
    const ecs = this.ecs;
    if (!ecs) return;
    for (const record of this.records.values()) {
      if (record.kind !== 'kinematic' || !ecs.isAlive(record.entity)) continue;
      const pose = readPose(ecs, record.entity);
      record.body.setNextKinematicTranslation({ x: pose.px, y: pose.py, z: pose.pz });
      record.body.setNextKinematicRotation({ x: pose.rx, y: pose.ry, z: pose.rz, w: pose.rw });
      record.synced = pose;
    }
  }

  private reconcile(): void {
    const ecs = this.ecs;
    const raw = this.raw;
    if (!ecs || !raw || this.destroyed) return;
    const wanted = new Set<Entity>();
    for (const entity of ecs.query(RigidBody).entities()) wanted.add(entity);
    for (const entity of [...this.records.keys()]) {
      if (!wanted.has(entity) || !ecs.isAlive(entity)) this.drop(entity);
    }
    for (const entity of wanted) this.ensure(entity);
  }

  private ensure(entity: Entity): void {
    const ecs = this.ecs;
    const raw = this.raw;
    if (!ecs || !raw) return;
    const data = ecs.get(entity, RigidBody);
    if (!data || !ecs.isAlive(entity)) {
      this.drop(entity);
      return;
    }
    const kind = kindOf(data.type);
    const pose = readPose(ecs, entity);
    const collider = ecs.has(entity, Collider) ? ecs.get(entity, Collider) : undefined;
    let record = this.records.get(entity);
    if (!record) {
      record = this.spawn(entity, kind, data, pose);
      this.records.set(entity, record);
    } else {
      this.retarget(record, kind, data);
    }
    this.syncCollider(record, collider);
    this.pushPose(record, pose);
  }

  private spawn(entity: Entity, kind: RigidBodyKind, data: RigidBodyData, pose: Pose): BodyRecord {
    const raw = this.raw;
    if (!raw) throw new Error('PhysicsWorld has been destroyed');
    const mass = positiveMass(data.mass);
    const desc = this.bodyDesc(kind);
    desc.setTranslation(pose.px, pose.py, pose.pz);
    desc.setRotation({ x: pose.rx, y: pose.ry, z: pose.rz, w: pose.rw });
    desc.setLinearDamping(nonNegative(data.linearDamping));
    desc.setAngularDamping(nonNegative(data.angularDamping));
    desc.setGravityScale(finiteOr(data.gravityScale, 1));
    desc.setCcdEnabled(data.ccd);
    desc.setAdditionalMass(mass);
    const body = raw.createRigidBody(desc);
    const record: BodyRecord = {
      entity,
      body,
      collider: null,
      colliderKey: '',
      kind,
      mass,
      linearDamping: nonNegative(data.linearDamping),
      angularDamping: nonNegative(data.angularDamping),
      gravityScale: finiteOr(data.gravityScale, 1),
      ccd: data.ccd,
      friction: 0.5,
      restitution: 0,
      sensor: false,
      groups: 0xffffffff,
      synced: pose,
    };
    return record;
  }

  private retarget(record: BodyRecord, kind: RigidBodyKind, data: RigidBodyData): void {
    if (record.kind !== kind) {
      record.body.setBodyType(this.bodyType(kind), true);
      record.kind = kind;
    }
    const mass = positiveMass(data.mass);
    if (record.mass !== mass) {
      record.body.setAdditionalMass(mass, true);
      record.mass = mass;
    }
    const linearDamping = nonNegative(data.linearDamping);
    if (record.linearDamping !== linearDamping) {
      record.body.setLinearDamping(linearDamping);
      record.linearDamping = linearDamping;
    }
    const angularDamping = nonNegative(data.angularDamping);
    if (record.angularDamping !== angularDamping) {
      record.body.setAngularDamping(angularDamping);
      record.angularDamping = angularDamping;
    }
    const gravityScale = finiteOr(data.gravityScale, 1);
    if (record.gravityScale !== gravityScale) {
      record.body.setGravityScale(gravityScale, true);
      record.gravityScale = gravityScale;
    }
    if (record.ccd !== data.ccd) {
      record.body.enableCcd(data.ccd);
      record.ccd = data.ccd;
    }
  }

  private syncCollider(record: BodyRecord, data: ColliderData | undefined): void {
    const raw = this.raw;
    if (!raw) return;
    if (!data) {
      this.clearCollider(record);
      return;
    }
    const key = colliderKey(data);
    if (!record.collider || record.colliderKey !== key) {
      this.clearCollider(record);
      const collider = raw.createCollider(this.colliderDesc(data), record.body);
      record.collider = collider;
      record.colliderKey = key;
      record.friction = clamp01(data.friction);
      record.restitution = clamp01(data.restitution);
      record.sensor = data.sensor;
      record.groups = collisionGroups(data.layer, data.mask);
      return;
    }
    const friction = clamp01(data.friction);
    if (record.friction !== friction) {
      record.collider.setFriction(friction);
      record.friction = friction;
    }
    const restitution = clamp01(data.restitution);
    if (record.restitution !== restitution) {
      record.collider.setRestitution(restitution);
      record.restitution = restitution;
    }
    if (record.sensor !== data.sensor) {
      record.collider.setSensor(data.sensor);
      record.sensor = data.sensor;
    }
    const groups = collisionGroups(data.layer, data.mask);
    if (record.groups !== groups) {
      record.collider.setCollisionGroups(groups);
      record.groups = groups;
    }
  }

  private clearCollider(record: BodyRecord): void {
    if (!record.collider) return;
    this.raw?.removeCollider(record.collider, true);
    record.collider = null;
    record.colliderKey = '';
  }

  private pushPose(record: BodyRecord, pose: Pose): void {
    const position = { x: pose.px, y: pose.py, z: pose.pz };
    const rotation = { x: pose.rx, y: pose.ry, z: pose.rz, w: pose.rw };
    if (record.kind === 'kinematic') {
      record.body.setNextKinematicTranslation(position);
      record.body.setNextKinematicRotation(rotation);
      record.synced = pose;
      return;
    }
    if (samePose(record.synced, pose)) return;
    record.body.setTranslation(position, true);
    record.body.setRotation(rotation, true);
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    record.synced = pose;
  }

  private writeBack(): void {
    const ecs = this.ecs;
    if (!ecs) return;
    this.applying = true;
    try {
      for (const record of this.records.values()) {
        if (record.kind !== 'dynamic') continue;
        if (!ecs.isAlive(record.entity) || !ecs.has(record.entity, Transform)) continue;
        const position = record.body.translation();
        const rotation = record.body.rotation();
        const next: Pose = {
          px: position.x,
          py: position.y,
          pz: position.z,
          rx: rotation.x,
          ry: rotation.y,
          rz: rotation.z,
          rw: rotation.w,
        };
        if (!samePose(readPose(ecs, record.entity), next)) {
          const current = ecs.get(record.entity, Transform);
          const scale = current?.scale ?? [1, 1, 1];
          ecs.set(record.entity, Transform, {
            position: [next.px, next.py, next.pz],
            rotation: [next.rx, next.ry, next.rz, next.rw],
            scale: [scale[0], scale[1], scale[2]],
          });
        }
        record.synced = next;
      }
    } finally {
      this.applying = false;
    }
  }

  private drop(entity: Entity): void {
    const record = this.records.get(entity);
    if (!record) return;
    this.clearCollider(record);
    this.raw?.removeRigidBody(record.body);
    this.records.delete(entity);
  }

  private releaseBinding(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const entity of [...this.records.keys()]) this.drop(entity);
    this.ecs = null;
  }

  private bodyDesc(kind: RigidBodyKind) {
    if (kind === 'fixed') return this.rapier.RigidBodyDesc.fixed();
    if (kind === 'kinematic') return this.rapier.RigidBodyDesc.kinematicPositionBased();
    return this.rapier.RigidBodyDesc.dynamic();
  }

  private bodyType(kind: RigidBodyKind): number {
    if (kind === 'fixed') return this.rapier.RigidBodyType.Fixed;
    if (kind === 'kinematic') return this.rapier.RigidBodyType.KinematicPositionBased;
    return this.rapier.RigidBodyType.Dynamic;
  }

  private colliderDesc(data: ColliderData): RColliderDesc {
    const shape = shapeOf(data.shape);
    const desc = this.shapeDesc(shape, data);
    desc.setDensity(0);
    desc.setFriction(clamp01(data.friction));
    desc.setRestitution(clamp01(data.restitution));
    desc.setSensor(data.sensor);
    desc.setCollisionGroups(collisionGroups(data.layer, data.mask));
    return desc;
  }

  private shapeDesc(shape: ColliderShape, data: ColliderData): RColliderDesc {
    const api = this.rapier.ColliderDesc;
    if (shape === 'sphere') return api.ball(extent(data.radius));
    if (shape === 'capsule') return api.capsule(extent(data.halfHeight), extent(data.radius));
    if (shape === 'cylinder') return api.cylinder(extent(data.halfHeight), extent(data.radius));
    const [hx, hy, hz] = data.halfExtents;
    return api.cuboid(extent(hx), extent(hy), extent(hz));
  }

  private assertOpen(): void {
    if (this.destroyed) throw new Error('PhysicsWorld has been destroyed');
  }
}

interface RigidBodyData {
  type: string;
  mass: number;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  ccd: boolean;
}

interface ColliderData {
  shape: string;
  halfExtents: readonly [number, number, number];
  radius: number;
  halfHeight: number;
  friction: number;
  restitution: number;
  sensor: boolean;
  layer: number;
  mask: number;
}

function kindOf(type: string): RigidBodyKind {
  if ((RIGID_BODY_TYPES as readonly string[]).includes(type)) return type as RigidBodyKind;
  throw new Error(`RigidBody type "${type}" must be dynamic, fixed, or kinematic`);
}

function shapeOf(shape: string): ColliderShape {
  if ((COLLIDER_SHAPES as readonly string[]).includes(shape)) return shape as ColliderShape;
  throw new Error(`Collider shape "${shape}" is not supported (mesh comes later)`);
}

function readPose(ecs: World, entity: Entity): Pose {
  const transform = ecs.get(entity, Transform);
  if (!transform) return IDENTITY;
  const [px, py, pz] = transform.position;
  const [rx, ry, rz, rw] = transform.rotation;
  return { px, py, pz, rx, ry, rz, rw };
}

function samePose(a: Pose, b: Pose): boolean {
  return (
    Math.abs(a.px - b.px) <= POSE_EPS &&
    Math.abs(a.py - b.py) <= POSE_EPS &&
    Math.abs(a.pz - b.pz) <= POSE_EPS &&
    Math.abs(a.rx - b.rx) <= POSE_EPS &&
    Math.abs(a.ry - b.ry) <= POSE_EPS &&
    Math.abs(a.rz - b.rz) <= POSE_EPS &&
    Math.abs(a.rw - b.rw) <= POSE_EPS
  );
}

function collisionGroups(layer: number, mask: number): number {
  const membership = Math.trunc(layer) & 0xffff;
  const filter = Math.trunc(mask) & 0xffff;
  return ((membership << 16) | filter) >>> 0;
}

function colliderKey(data: ColliderData): string {
  const [hx, hy, hz] = data.halfExtents;
  return `${data.shape}:${extent(hx)}:${extent(hy)}:${extent(hz)}:${extent(data.radius)}:${extent(data.halfHeight)}`;
}

function extent(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(Math.abs(value), MIN_EXTENT);
}

function positiveMass(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return MIN_MASS;
  return value;
}

function nonNegative(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function finiteOr(value: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function finite3(value: readonly [number, number, number], label: string): [number, number, number] {
  const x = value[0];
  const y = value[1];
  const z = value[2];
  if (![x, y, z].every((lane) => typeof lane === 'number' && Number.isFinite(lane))) {
    throw new Error(`${label} must be a finite vec3`);
  }
  return [x, y, z];
}

function miss(): RaycastHit {
  return { hit: false, point: [0, 0, 0], normal: [0, 0, 0], toi: 0, entity: null };
}
