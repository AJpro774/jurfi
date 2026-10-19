import { Transform, World, type Entity } from '@jurfi/core';
import { IDENTITY_QUAT, cloneTransform } from '../math/vec';
import type { Quat, Transform as Pose, Vec3 } from '../math/vec';
import type { EditorWorld } from '../world';

/**
 * Mesh and transform reads for the viewport.
 * Values come from the core ECS: `Transform` is the schema component, `mesh` is the loose component the inspector edits.
 */
export type EntityShape = 'box' | 'sphere' | 'plane';

export const IDENTITY_TRANSFORM: Pose = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { ...IDENTITY_QUAT },
  scale: { x: 1, y: 1, z: 1 },
};

/** Transform captured when a gizmo drag starts. `present` is false when the component was absent. */
export interface DragBaseline {
  transform: Pose;
  present: boolean;
}

export function ecsOf(world: EditorWorld): World | null {
  if (!('ecs' in world)) return null;
  const ecs = (world as { ecs?: unknown }).ecs;
  return isWorld(ecs) ? ecs : null;
}

export function stableId(ecs: World, entity: Entity): string {
  return ecs.alias(entity) ?? String(entity);
}

/** Selection ids are aliases. A numeric string still resolves when the entity is alive. */
export function resolveEntity(ecs: World, id: string): Entity | undefined {
  const aliased = ecs.resolveAlias(id);
  if (aliased !== undefined) return aliased;
  if (/^\d+$/.test(id)) {
    const numeric = Number(id);
    if (ecs.isAlive(numeric)) return numeric;
  }
  return undefined;
}

/** Drawn when the entity has a Transform or a mesh. Scene roots and bare cameras have neither. */
export function isDrawable(ecs: World, entity: Entity): boolean {
  return ecs.has(entity, Transform) || ecs.has(entity, 'mesh');
}

export function entityShape(ecs: World, entity: Entity): EntityShape {
  const mesh = ecs.get(entity, 'mesh');
  if (isRecord(mesh) && (mesh.shape === 'box' || mesh.shape === 'sphere' || mesh.shape === 'plane')) return mesh.shape;
  return 'box';
}

export function hasTransform(ecs: World, entity: Entity): boolean {
  return ecs.has(entity, Transform);
}

export function readTransform(ecs: World, entity: Entity): Pose {
  const data = ecs.get(entity, Transform);
  if (!data) return cloneTransform(IDENTITY_TRANSFORM);
  return {
    position: readVec3(data.position, IDENTITY_TRANSFORM.position),
    rotation: readQuat(data.rotation),
    scale: readVec3(data.scale, IDENTITY_TRANSFORM.scale),
  };
}

export function baseline(ecs: World, entity: Entity): DragBaseline {
  return { transform: readTransform(ecs, entity), present: hasTransform(ecs, entity) };
}

/** Insert or replace `Transform`. Other components stay where they are. */
export function writeTransform(ecs: World, entity: Entity, transform: Pose): void {
  ecs.set(entity, Transform, {
    position: [transform.position.x, transform.position.y, transform.position.z],
    rotation: [transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w],
    scale: [transform.scale.x, transform.scale.y, transform.scale.z],
  });
}

/** Returns true when the world changed. */
export function applyBaseline(ecs: World, entity: Entity, pose: DragBaseline): boolean {
  if (!ecs.isAlive(entity)) return false;
  if (!pose.present) {
    if (!hasTransform(ecs, entity)) return false;
    ecs.remove(entity, Transform);
    return true;
  }
  if (hasTransform(ecs, entity) && samePose(readTransform(ecs, entity), pose.transform)) return false;
  writeTransform(ecs, entity, pose.transform);
  return true;
}

function samePose(left: Pose, right: Pose): boolean {
  return left.position.x === right.position.x
    && left.position.y === right.position.y
    && left.position.z === right.position.z
    && left.rotation.x === right.rotation.x
    && left.rotation.y === right.rotation.y
    && left.rotation.z === right.rotation.z
    && left.rotation.w === right.rotation.w
    && left.scale.x === right.scale.x
    && left.scale.y === right.scale.y
    && left.scale.z === right.scale.z;
}

function isWorld(value: unknown): value is World {
  if (value instanceof World) return true;
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<World>;
  return typeof candidate.transaction === 'function'
    && typeof candidate.onChanged === 'function'
    && typeof candidate.resolveAlias === 'function'
    && typeof candidate.entities === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readVec3(value: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(value)) {
    return { x: num(value[0], fallback.x), y: num(value[1], fallback.y), z: num(value[2], fallback.z) };
  }
  if (!isRecord(value)) return { ...fallback };
  return { x: num(value.x, fallback.x), y: num(value.y, fallback.y), z: num(value.z, fallback.z) };
}

function readQuat(value: unknown): Quat {
  if (Array.isArray(value)) {
    return { x: num(value[0], 0), y: num(value[1], 0), z: num(value[2], 0), w: num(value[3], 1) };
  }
  if (!isRecord(value)) return { ...IDENTITY_QUAT };
  return { x: num(value.x, 0), y: num(value.y, 0), z: num(value.z, 0), w: num(value.w, 1) };
}
