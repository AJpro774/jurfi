import { EcsError } from './errors';

/** Column-major 4x4. `out` = `a` * `b`. */
export function multiplyMatrices(
  a: Float32Array,
  aOffset: number,
  b: Float32Array,
  bOffset: number,
  out: Float32Array,
  outOffset: number,
): void {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[aOffset + k * 4 + row] ?? 0) * (b[bOffset + column * 4 + k] ?? 0);
      }
      out[outOffset + column * 4 + row] = sum;
    }
  }
}

export function identityMatrix(): Float32Array {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

/** Returns null when `matrix` is singular. */
export function invertMatrix(matrix: Float32Array, offset = 0): Float32Array | null {
  const a00 = matrix[offset] ?? 0;
  const a01 = matrix[offset + 1] ?? 0;
  const a02 = matrix[offset + 2] ?? 0;
  const a03 = matrix[offset + 3] ?? 0;
  const a10 = matrix[offset + 4] ?? 0;
  const a11 = matrix[offset + 5] ?? 0;
  const a12 = matrix[offset + 6] ?? 0;
  const a13 = matrix[offset + 7] ?? 0;
  const a20 = matrix[offset + 8] ?? 0;
  const a21 = matrix[offset + 9] ?? 0;
  const a22 = matrix[offset + 10] ?? 0;
  const a23 = matrix[offset + 11] ?? 0;
  const a30 = matrix[offset + 12] ?? 0;
  const a31 = matrix[offset + 13] ?? 0;
  const a32 = matrix[offset + 14] ?? 0;
  const a33 = matrix[offset + 15] ?? 0;

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (det === 0 || !Number.isFinite(det)) return null;
  det = 1 / det;

  const out = new Float32Array(16);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export interface Trs {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

/** Decompose a column-major TRS matrix. Throws when a scale axis is zero. */
export function decomposeTrs(matrix: Float32Array, offset = 0): Trs {
  const te = (index: number) => matrix[offset + index] ?? 0;
  const position: [number, number, number] = [te(12), te(13), te(14)];
  let sx = Math.hypot(te(0), te(1), te(2));
  const sy = Math.hypot(te(4), te(5), te(6));
  const sz = Math.hypot(te(8), te(9), te(10));
  const det =
    te(0) * (te(5) * te(10) - te(6) * te(9)) -
    te(4) * (te(1) * te(10) - te(2) * te(9)) +
    te(8) * (te(1) * te(6) - te(2) * te(5));
  if (det < 0) sx = -sx;
  if (sx === 0 || sy === 0 || sz === 0 || !Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) {
    throw new EcsError('invalid-value', 'Transform scale cannot be zero');
  }
  const rotation = quaternionFromBasis(
    te(0) / sx,
    te(4) / sy,
    te(8) / sz,
    te(1) / sx,
    te(5) / sy,
    te(9) / sz,
    te(2) / sx,
    te(6) / sy,
    te(10) / sz,
  );
  return { position, rotation, scale: [sx, sy, sz] };
}

function quaternionFromBasis(
  m11: number,
  m12: number,
  m13: number,
  m21: number,
  m22: number,
  m23: number,
  m31: number,
  m32: number,
  m33: number,
): [number, number, number, number] {
  const trace = m11 + m22 + m33;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m32 - m23) / s;
    y = (m13 - m31) / s;
    z = (m21 - m12) / s;
  } else if (m11 > m22 && m11 > m33) {
    const s = Math.sqrt(1 + m11 - m22 - m33) * 2;
    w = (m32 - m23) / s;
    x = 0.25 * s;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = Math.sqrt(1 + m22 - m11 - m33) * 2;
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = 0.25 * s;
    z = (m23 + m32) / s;
  } else {
    const s = Math.sqrt(1 + m33 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}
