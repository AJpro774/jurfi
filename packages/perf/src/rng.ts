/** Seeded PCG32 (XSH-RR). Deterministic; never uses Math.random. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max): min inclusive, max exclusive. Requires max > min. */
  int(min: number, max: number): number;
  /** Uniformly pick an element; throws on an empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Independent stream derived from this stream's current state and `label`; does not advance this stream. */
  fork(label: string): Rng;
  /** Serialisable state (hex string). Assign a value from `state` to restore. */
  state: string;
}

const MASK64 = (1n << 64n) - 1n;
const MULT = 6364136223846793005n;

function hashString(s: string): bigint {
  // FNV-1a 64-bit
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h;
}

function mix(x: bigint): bigint {
  // splitmix64 finalizer
  x = (x + 0x9e3779b97f4a7c15n) & MASK64;
  x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return x ^ (x >> 31n);
}

function seedBits(seed: number | string): bigint {
  if (typeof seed === 'string') return hashString('s:' + seed);
  if (!Number.isFinite(seed)) throw new RangeError('seed must be finite');
  return hashString('n:' + String(seed));
}

function build(state0: bigint, inc0: bigint): Rng {
  let state = state0;
  let inc = inc0 | 1n;

  const nextU32 = (): number => {
    const old = state;
    state = (old * MULT + inc) & MASK64;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  };
  const init = (s: bigint, seq: bigint) => {
    state = 0n;
    inc = ((seq << 1n) | 1n) & MASK64;
    nextU32();
    state = (state + s) & MASK64;
    nextU32();
  };
  if (inc0 === 0n) init(state0, mix(state0 ^ 0x5851f42d4c957f2dn));

  const rng: Rng = {
    next: () => nextU32() / 4294967296,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min) {
        throw new RangeError('int(min, max) requires integers with max > min');
      }
      const range = max - min;
      if (range > 4294967296) throw new RangeError('range too large');
      // unbiased rejection sampling
      const limit = 4294967296 - (4294967296 % range);
      let r = nextU32();
      while (r >= limit) r = nextU32();
      return min + (r % range);
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new RangeError('pick from empty array');
      return arr[rng.int(0, arr.length)] as T;
    },
    fork(label) {
      const h = hashString(label);
      const s = mix(state ^ h);
      const q = mix(inc ^ (h << 1n) ^ 0xda3e39cb94b95bdbn);
      return build(s, q);
    },
    get state() {
      return state.toString(16).padStart(16, '0') + inc.toString(16).padStart(16, '0');
    },
    set state(v: string) {
      if (!/^[0-9a-f]{32}$/i.test(v)) throw new RangeError('invalid rng state');
      state = BigInt('0x' + v.slice(0, 16));
      inc = BigInt('0x' + v.slice(16)) | 1n;
    },
  };
  return rng;
}

export function createRng(seed: number | string): Rng {
  const b = seedBits(seed);
  return build(b, 0n);
}
