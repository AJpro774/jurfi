/** Quaternion `[x, y, z, w]` ↔ Euler XYZ radians. Used so quat keys stay whole values. */

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

export function eulerToQuat(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** XYZ Euler radians, the inverse of `eulerToQuat`. Pitch is `asin`, so ±90° is gimbal-locked. */
export function quatToEuler(q: readonly number[]): [number, number, number] {
  const x = q[0] ?? 0;
  const y = q[1] ?? 0;
  const z = q[2] ?? 0;
  const w = q[3] ?? 0;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const ww = w * w;
  const roll = Math.atan2(2 * (x * w - y * z), ww - xx - yy + zz);
  const pitch = Math.asin(clampUnit(2 * (x * z + y * w)));
  const yaw = Math.atan2(2 * (z * w - x * y), ww + xx - yy - zz);
  return [roll, pitch, yaw];
}

export function eulerDegreesToQuat(degrees: readonly number[]): [number, number, number, number] {
  const toRad = Math.PI / 180;
  return eulerToQuat((degrees[0] ?? 0) * toRad, (degrees[1] ?? 0) * toRad, (degrees[2] ?? 0) * toRad);
}

export function quatToEulerDegrees(q: readonly number[]): [number, number, number] {
  const [roll, pitch, yaw] = quatToEuler(q);
  const toDeg = 180 / Math.PI;
  return [roll * toDeg, pitch * toDeg, yaw * toDeg];
}
