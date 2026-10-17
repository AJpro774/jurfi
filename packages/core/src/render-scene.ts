import type { Entity } from './entity';
import { EcsError } from './errors';

export interface RenderScene {
  /** Alive entities, ascending index, from the extraction that built this scene. */
  readonly entities: Uint32Array;
  /** Column-major 4x4 world matrices, 16 floats per entity, parallel to `entities`. */
  readonly worldMatrices: Float32Array;
  /** 1 when that entity's world matrix changed since the previous extraction. */
  readonly dirty: Uint32Array;
  /** Component values parallel to `entities`. Missing components are `undefined`. */
  view(component: string | { readonly id: string }): unknown[];
}

export interface RenderInput {
  entity: Entity;
  parent: Entity | null;
  /** Column-major local matrix. `null` is identity (no Transform). */
  local: Float32Array | null;
  dirty: boolean;
}

export function composeTrs(
  position: readonly number[],
  rotation: readonly number[],
  scale: readonly number[],
  out: Float32Array,
  offset: number,
): void {
  const px = position[0] ?? 0;
  const py = position[1] ?? 0;
  const pz = position[2] ?? 0;
  const qx = rotation[0] ?? 0;
  const qy = rotation[1] ?? 0;
  const qz = rotation[2] ?? 0;
  const qw = rotation[3] ?? 1;
  const sx = scale[0] ?? 1;
  const sy = scale[1] ?? 1;
  const sz = scale[2] ?? 1;
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  out[offset] = (1 - (yy + zz)) * sx;
  out[offset + 1] = (xy + wz) * sx;
  out[offset + 2] = (xz - wy) * sx;
  out[offset + 3] = 0;
  out[offset + 4] = (xy - wz) * sy;
  out[offset + 5] = (1 - (xx + zz)) * sy;
  out[offset + 6] = (yz + wx) * sy;
  out[offset + 7] = 0;
  out[offset + 8] = (xz + wy) * sz;
  out[offset + 9] = (yz - wx) * sz;
  out[offset + 10] = (1 - (xx + yy)) * sz;
  out[offset + 11] = 0;
  out[offset + 12] = px;
  out[offset + 13] = py;
  out[offset + 14] = pz;
  out[offset + 15] = 1;
}

function identity(out: Float32Array, offset: number): void {
  out.fill(0, offset, offset + 16);
  out[offset] = 1;
  out[offset + 5] = 1;
  out[offset + 10] = 1;
  out[offset + 15] = 1;
}

function multiply(parent: Float32Array, parentOffset: number, local: Float32Array, localOffset: number, out: Float32Array, outOffset: number): void {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (parent[parentOffset + k * 4 + row] ?? 0) * (local[localOffset + column * 4 + k] ?? 0);
      }
      out[outOffset + column * 4 + row] = sum;
    }
  }
}

export function buildRenderScene(
  items: readonly RenderInput[],
  readComponent: (entity: Entity, component: string) => unknown,
): RenderScene {
  const count = items.length;
  const entities = new Uint32Array(count);
  const worldMatrices = new Float32Array(count * 16);
  const dirty = new Uint32Array(count);
  const order = new Map<Entity, number>();
  items.forEach((item, index) => {
    entities[index] = item.entity;
    order.set(item.entity, index);
  });

  const visiting = new Set<Entity>();
  const placed = new Set<Entity>();

  const place = (item: RenderInput): void => {
    if (placed.has(item.entity)) return;
    if (visiting.has(item.entity)) {
      throw new EcsError('cycle', `Transform hierarchy contains a cycle at entity ${item.entity}`);
    }
    visiting.add(item.entity);
    const index = order.get(item.entity) ?? 0;
    const offset = index * 16;
    if (item.local) item.local.forEach((value, lane) => {
      worldMatrices[offset + lane] = value;
    });
    else identity(worldMatrices, offset);

    if (item.parent !== null && order.has(item.parent)) {
      const parent = items[order.get(item.parent) ?? 0];
      if (parent) {
        place(parent);
        const parentOffset = (order.get(item.parent) ?? 0) * 16;
        const combined = new Float32Array(16);
        multiply(worldMatrices, parentOffset, worldMatrices, offset, combined, 0);
        worldMatrices.set(combined, offset);
      }
    }
    visiting.delete(item.entity);
    placed.add(item.entity);
  };

  for (const item of items) place(item);

  const dirtyOf = (item: RenderInput, seen: Set<Entity>): boolean => {
    if (item.dirty) return true;
    if (item.parent === null || seen.has(item.entity)) return false;
    const parentIndex = order.get(item.parent);
    if (parentIndex === undefined) return false;
    const parent = items[parentIndex];
    if (!parent) return false;
    seen.add(item.entity);
    return dirtyOf(parent, seen);
  };

  items.forEach((item, index) => {
    dirty[index] = dirtyOf(item, new Set()) ? 1 : 0;
  });

  return {
    entities,
    worldMatrices,
    dirty,
    view(component: string | { readonly id: string }): unknown[] {
      const id = typeof component === 'string' ? component : component.id;
      return items.map((item) => readComponent(item.entity, id));
    },
  };
}
