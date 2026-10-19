/** Structural view of the Rapier compat build. The real module is loaded only from {@link loadRapier}. */

export interface RVector {
  x: number;
  y: number;
  z: number;
}

export interface RRotation {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface RBodyDesc {
  setTranslation(x: number, y: number, z: number): RBodyDesc;
  setRotation(rot: RRotation): RBodyDesc;
  setGravityScale(scale: number): RBodyDesc;
  setAdditionalMass(mass: number): RBodyDesc;
  setLinearDamping(damping: number): RBodyDesc;
  setAngularDamping(damping: number): RBodyDesc;
  setCcdEnabled(enabled: boolean): RBodyDesc;
}

export interface RColliderDesc {
  setDensity(density: number): RColliderDesc;
  setFriction(friction: number): RColliderDesc;
  setRestitution(restitution: number): RColliderDesc;
  setSensor(sensor: boolean): RColliderDesc;
  setCollisionGroups(groups: number): RColliderDesc;
}

export interface RRayHit {
  timeOfImpact: number;
  normal: RVector;
}

export interface RCollider {
  readonly handle: number;
  setFriction(friction: number): void;
  setRestitution(restitution: number): void;
  setSensor(sensor: boolean): void;
  setCollisionGroups(groups: number): void;
  castRayAndGetNormal(ray: RRay, maxToi: number, solid: boolean): RRayHit | null;
}

export interface RBody {
  readonly handle: number;
  translation(): RVector;
  rotation(): RRotation;
  setTranslation(tra: RVector, wakeUp: boolean): void;
  setRotation(rot: RRotation, wakeUp: boolean): void;
  setNextKinematicTranslation(t: RVector): void;
  setNextKinematicRotation(rot: RRotation): void;
  setLinvel(vel: RVector, wakeUp: boolean): void;
  setAngvel(vel: RVector, wakeUp: boolean): void;
  setGravityScale(factor: number, wakeUp: boolean): void;
  setLinearDamping(factor: number): void;
  setAngularDamping(factor: number): void;
  setAdditionalMass(mass: number, wakeUp: boolean): void;
  setBodyType(type: number, wakeUp: boolean): void;
  enableCcd(enabled: boolean): void;
}

export interface RRay {
  pointAt(t: number): RVector;
}

export interface RWorld {
  timestep: number;
  step(): void;
  createRigidBody(desc: RBodyDesc): RBody;
  createCollider(desc: RColliderDesc, parent?: RBody): RCollider;
  removeRigidBody(body: RBody): void;
  removeCollider(collider: RCollider, wakeUp: boolean): void;
  /** Copy body poses onto colliders without integrating. Rapier's broad-phase query waits for a step. */
  propagateModifiedBodyPositionsToColliders(): void;
  free(): void;
}

export interface Rapier {
  init(): Promise<void>;
  World: new (gravity: RVector) => RWorld;
  Ray: new (origin: RVector, dir: RVector) => RRay;
  RigidBodyDesc: {
    dynamic(): RBodyDesc;
    fixed(): RBodyDesc;
    kinematicPositionBased(): RBodyDesc;
  };
  ColliderDesc: {
    cuboid(hx: number, hy: number, hz: number): RColliderDesc;
    ball(radius: number): RColliderDesc;
    capsule(halfHeight: number, radius: number): RColliderDesc;
    cylinder(halfHeight: number, radius: number): RColliderDesc;
  };
  RigidBodyType: {
    Dynamic: number;
    Fixed: number;
    KinematicPositionBased: number;
  };
}

let loading: Promise<Rapier> | null = null;

/** Load and initialize `@dimforge/rapier3d-compat` once. Callers that never simulate never pay for this. */
export function loadRapier(): Promise<Rapier> {
  if (!loading) {
    loading = importRapier().catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

async function importRapier(): Promise<Rapier> {
  const mod: unknown = await import('@dimforge/rapier3d-compat');
  const api = unwrap(mod);
  await api.init();
  return api;
}

function unwrap(mod: unknown): Rapier {
  if (isRapier(mod)) return mod;
  if (isRecord(mod) && isRapier(mod.default)) return mod.default;
  throw new Error('Could not load @dimforge/rapier3d-compat');
}

function isRapier(value: unknown): value is Rapier {
  if (!isRecord(value)) return false;
  return typeof value.init === 'function' && typeof value.World === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
