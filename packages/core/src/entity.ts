import { EcsError } from './errors';

/** Packed entity id. Low 20 bits are the index, high 12 bits are the generation. */
export type Entity = number;

/** Index 0, generation 0. Never alive. */
export const NULL_ENTITY: Entity = 0;

export const INDEX_BITS = 20;
export const GENERATION_BITS = 12;
export const INDEX_MASK = (1 << INDEX_BITS) - 1;
export const GENERATION_MASK = (1 << GENERATION_BITS) - 1;
/** Highest legal index, inclusive. One million slots. */
export const MAX_ENTITY_INDEX = INDEX_MASK;

export function entityIndex(entity: Entity): number {
  return entity & INDEX_MASK;
}

export function entityGeneration(entity: Entity): number {
  return (entity >>> INDEX_BITS) & GENERATION_MASK;
}

export function packEntity(index: number, generation: number): Entity {
  return (((generation & GENERATION_MASK) << INDEX_BITS) | (index & INDEX_MASK)) >>> 0;
}

export function isEntityId(value: unknown): value is Entity {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

/** Next generation in 1..4095. Generation 0 is reserved for {@link NULL_ENTITY}. */
export function nextGeneration(generation: number): number {
  const next = (generation + 1) & GENERATION_MASK;
  return next === 0 ? 1 : next;
}

const INITIAL_CAPACITY = 16;

/**
 * Slot allocator. Dead ids keep their generation so a recycled index cannot
 * satisfy {@link EntityPool.isAlive} for a stale handle, until the 12-bit
 * generation wraps all the way around.
 */
export class EntityPool {
  private generations = new Uint16Array(INITIAL_CAPACITY);
  private aliveFlags = new Uint8Array(INITIAL_CAPACITY);
  private free: number[] = [];
  private nextIndex = 0;

  get highWater(): number {
    return this.nextIndex;
  }

  create(): Entity {
    let index: number;
    if (this.free.length > 0) {
      index = this.free.pop() as number;
    } else {
      if (this.nextIndex > MAX_ENTITY_INDEX) {
        throw new EcsError('capacity', `Entity index exceeds ${MAX_ENTITY_INDEX}`);
      }
      index = this.nextIndex;
      this.nextIndex += 1;
      this.ensure(this.nextIndex);
      if ((this.generations[index] ?? 0) === 0) this.generations[index] = 1;
    }
    this.aliveFlags[index] = 1;
    return packEntity(index, this.generations[index] ?? 1);
  }

  /** @returns false when `entity` is already dead or was never issued. */
  destroy(entity: Entity): boolean {
    if (!this.isAlive(entity)) return false;
    const index = entityIndex(entity);
    this.aliveFlags[index] = 0;
    this.generations[index] = nextGeneration(this.generations[index] ?? 1);
    this.free.push(index);
    return true;
  }

  /**
   * Mark `entity` alive at its packed generation.
   * Rolls a destroyed slot's generation back so undo can revive the old id.
   * The index is removed from the free list wherever it currently sits.
   */
  adopt(entity: Entity): void {
    if (!isEntityId(entity) || entityGeneration(entity) === 0) {
      throw new EcsError('invalid-entity', `Cannot adopt entity ${String(entity)}`);
    }
    const index = entityIndex(entity);
    if (index > MAX_ENTITY_INDEX) {
      throw new EcsError('capacity', `Entity index exceeds ${MAX_ENTITY_INDEX}`);
    }
    this.ensure(index + 1);
    if (index >= this.nextIndex) {
      for (let cursor = this.nextIndex; cursor < index; cursor += 1) {
        if ((this.generations[cursor] ?? 0) === 0) this.generations[cursor] = 1;
        this.aliveFlags[cursor] = 0;
        this.free.push(cursor);
      }
      this.nextIndex = index + 1;
    }
    if (this.aliveFlags[index] === 1) {
      throw new EcsError('invalid-entity', `Entity slot ${index} is already alive`);
    }
    const freeAt = this.free.lastIndexOf(index);
    if (freeAt >= 0) this.free.splice(freeAt, 1);
    this.generations[index] = entityGeneration(entity);
    this.aliveFlags[index] = 1;
  }

  /**
   * Mark `entity` dead and push its slot without advancing the generation.
   * Undoes {@link EntityPool.create} so the same id can be adopted again.
   */
  release(entity: Entity): void {
    if (!this.isAlive(entity)) {
      throw new EcsError('dead-entity', `Entity ${String(entity)} is not alive`);
    }
    const index = entityIndex(entity);
    this.aliveFlags[index] = 0;
    this.free.push(index);
  }

  isAlive(entity: Entity): boolean {
    if (!isEntityId(entity) || entityGeneration(entity) === 0) return false;
    const index = entityIndex(entity);
    if (index >= this.nextIndex || index >= this.aliveFlags.length) return false;
    return this.aliveFlags[index] === 1 && this.generations[index] === entityGeneration(entity);
  }

  generationAt(index: number): number {
    return this.generations[index] ?? 0;
  }

  alive(): Entity[] {
    const out: Entity[] = [];
    for (let index = 0; index < this.nextIndex; index += 1) {
      if (this.aliveFlags[index] === 1) out.push(packEntity(index, this.generations[index] ?? 1));
    }
    return out;
  }

  /** Generation that will be issued for each index below the high-water mark. */
  generationSnapshot(): number[] {
    const out: number[] = [];
    for (let index = 0; index < this.nextIndex; index += 1) out.push(this.generations[index] ?? 0);
    return out;
  }

  clear(): void {
    this.generations = new Uint16Array(INITIAL_CAPACITY);
    this.aliveFlags = new Uint8Array(INITIAL_CAPACITY);
    this.free = [];
    this.nextIndex = 0;
  }

  /**
   * Replace the pool with `live` entities.
   * `generations`, when present, is the next-to-issue generation of every
   * index below the high-water mark (live slots hold their current generation).
   */
  load(live: readonly Entity[], generations?: readonly number[]): void {
    for (const entity of live) {
      if (!isEntityId(entity) || entityGeneration(entity) === 0) {
        throw new EcsError('invalid-entity', `Cannot restore entity ${String(entity)}`);
      }
    }
    const high = Math.max(
      generations?.length ?? 0,
      live.reduce((max, entity) => Math.max(max, entityIndex(entity) + 1), 0),
    );
    if (high - 1 > MAX_ENTITY_INDEX) {
      throw new EcsError('capacity', `Entity index exceeds ${MAX_ENTITY_INDEX}`);
    }
    this.clear();
    if (high === 0) return;
    this.ensure(high);
    this.nextIndex = high;
    if (generations) {
      if (generations.length > high) {
        throw new EcsError('invalid-scene', 'Generation table is longer than the entity high-water mark');
      }
      for (let index = 0; index < high; index += 1) {
        const generation = generations[index] ?? 1;
        if (!Number.isInteger(generation) || generation < 1 || generation > GENERATION_MASK) {
          throw new EcsError('invalid-scene', `Generation at index ${index} must be in 1..${GENERATION_MASK}`);
        }
        this.generations[index] = generation;
      }
    } else {
      for (let index = 0; index < high; index += 1) this.generations[index] = 1;
    }
    const seen = new Set<number>();
    for (const entity of live) {
      const index = entityIndex(entity);
      if (seen.has(index)) {
        throw new EcsError('invalid-scene', `Duplicate entity index ${index}`);
      }
      seen.add(index);
      const generation = entityGeneration(entity);
      if (generations && this.generations[index] !== generation) {
        throw new EcsError(
          'invalid-scene',
          `Entity ${entity} does not match generation table index ${index}`,
        );
      }
      this.generations[index] = generation;
      this.aliveFlags[index] = 1;
    }
    for (let index = 0; index < high; index += 1) {
      if (this.aliveFlags[index] !== 1) this.free.push(index);
    }
  }

  private ensure(size: number): void {
    if (size <= this.generations.length) return;
    let capacity = this.generations.length;
    while (capacity < size) capacity *= 2;
    const generations = new Uint16Array(capacity);
    generations.set(this.generations);
    const aliveFlags = new Uint8Array(capacity);
    aliveFlags.set(this.aliveFlags);
    this.generations = generations;
    this.aliveFlags = aliveFlags;
  }
}
