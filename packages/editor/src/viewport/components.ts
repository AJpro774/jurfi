import { IDENTITY_QUAT, cloneTransform } from '../math/vec';
import type { Quat, Transform, Vec3 } from '../math/vec';
import type { EditorWorld, EntityRecord } from '../world';

/**
 * Scene-document keys the viewport reads and writes.
 * `transform` is position, quaternion rotation, and scale.
 * `mesh.shape` is `box`, `sphere`, or `plane`. Other component keys are preserved.
 */
export type EntityShape = 'box' | 'sphere' | 'plane';

export const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { ...IDENTITY_QUAT },
  scale: { x: 1, y: 1, z: 1 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readVec3(value: unknown, fallback: Vec3): Vec3 {
  if (!isRecord(value)) return { ...fallback };
  return {
    x: num(value.x, fallback.x),
    y: num(value.y, fallback.y),
    z: num(value.z, fallback.z),
  };
}

function readQuat(value: unknown): Quat {
  if (!isRecord(value)) return { ...IDENTITY_QUAT };
  return {
    x: num(value.x, 0),
    y: num(value.y, 0),
    z: num(value.z, 0),
    w: num(value.w, 1),
  };
}

export function hasTransform(components: Record<string, unknown>): boolean {
  return isRecord(components.transform);
}

export function hasMesh(components: Record<string, unknown>): boolean {
  return isRecord(components.mesh);
}

/** Nodes, meshes, and transforms are drawn. The scene root and a bare camera are not. */
export function isDrawable(entity: EntityRecord): boolean {
  if (entity.id === 'scene') return false;
  const kind = entity.components.kind;
  const explicit = hasMesh(entity.components) || hasTransform(entity.components);
  if (kind === 'camera' || kind === 'scene') return explicit;
  return explicit || kind === 'node';
}

export function entityShape(entity: EntityRecord): EntityShape {
  const mesh = entity.components.mesh;
  if (isRecord(mesh) && (mesh.shape === 'box' || mesh.shape === 'sphere' || mesh.shape === 'plane')) return mesh.shape;
  return 'box';
}

export function entityTransform(entity: EntityRecord): Transform {
  const raw = entity.components.transform;
  if (!isRecord(raw)) return cloneTransform(IDENTITY_TRANSFORM);
  return {
    position: readVec3(raw.position, IDENTITY_TRANSFORM.position),
    rotation: readQuat(raw.rotation),
    scale: readVec3(raw.scale, IDENTITY_TRANSFORM.scale),
  };
}

/** Replace or remove `components.transform` and keep every other component key. */
export function writeTransform(world: EditorWorld, id: string, transform: Transform | null): void {
  const entity = world.get(id);
  if (!entity) return;
  const components = { ...entity.components };
  if (transform === null) delete components.transform;
  else {
    const next = cloneTransform(transform);
    components.transform = {
      position: next.position,
      rotation: next.rotation,
      scale: next.scale,
    };
  }
  world.update(id, { components });
}
