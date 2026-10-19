import type { Vec3 } from '../math/vec';

/** Snap `value` to a multiple of `step`. Non-positive steps and non-finite values pass through. */
export function snapScalar(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  return Math.round(value / step) * step;
}

export function snapVec3(value: Vec3, step: number): Vec3 {
  return {
    x: snapScalar(value.x, step),
    y: snapScalar(value.y, step),
    z: snapScalar(value.z, step),
  };
}

export function snapAngle(radians: number, stepRadians: number): number {
  return snapScalar(radians, stepRadians);
}
