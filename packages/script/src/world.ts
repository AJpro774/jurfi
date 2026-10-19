/**
 * Entity and component access for visual scripts.
 *
 * Play mode and the compiled host default to `createScriptWorld(createWorld())` from `@jurfi/core`.
 * `createMemoryWorld` is a test stand-in with string ids and map storage.
 */
import { resolveEntityId, type World } from '@jurfi/core';

export interface EntityRef {
  readonly id: string | number;
}

export interface ScriptWorld {
  /** Entity the running graph is attached to. */
  readonly self: EntityRef;
  /** Set by `createScriptWorld`. Spawn, destroy, add, remove, and query use this world. */
  readonly ecs?: World;
  getComponent(entity: EntityRef, component: string): unknown;
  setComponent(entity: EntityRef, component: string, value: unknown): void;
  hasComponent?(entity: EntityRef, component: string): boolean;
  getField?(entity: EntityRef, component: string, field: string): unknown;
  setField?(entity: EntityRef, component: string, field: string, value: unknown): void;
  /**
   * Optional entity-scoped variable storage.
   * When omitted, the script runtime keeps a side table keyed by `entity.id`.
   */
  getVariable?(entity: EntityRef, name: string): unknown;
  setVariable?(entity: EntityRef, name: string, value: unknown): void;
}

/**
 * ECS surface visual scripts use from `@jurfi/core`.
 * `missing` stays empty while `createScriptWorld` covers components, fields, entity variables,
 * and the `World` methods behind spawn, destroy, add, remove, and query.
 */
export const coreGaps = {
  package: '@jurfi/core',
  present: [
    'VERSION',
    'Disposable',
    'clamp',
    'createWorld',
    'createScriptWorld',
    'generational entity ids',
    'component get, set, and has',
    'component field get and set',
    'per-entity JSON variables',
  ],
  missing: [],
  adapter: 'createScriptWorld',
} as const;

export interface MemoryWorld extends ScriptWorld {
  getComponent(entity: EntityRef, component: string): unknown;
  setComponent(entity: EntityRef, component: string, value: unknown): void;
  hasComponent(entity: EntityRef, component: string): boolean;
  getField(entity: EntityRef, component: string, field: string): unknown;
  setField(entity: EntityRef, component: string, field: string, value: unknown): void;
  getVariable(entity: EntityRef, name: string): unknown;
  setVariable(entity: EntityRef, name: string, value: unknown): void;
}

/** Component names from a string array or a comma-separated string. */
export function componentNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    const names: string[] = [];
    for (const item of value) {
      if (typeof item === 'string' && item.trim() !== '') names.push(item.trim());
    }
    return names;
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
  }
  return [];
}

function requireEcs(world: ScriptWorld): World {
  if (world.ecs) return world.ecs;
  throw new Error('Spawn, destroy, add, remove, and query need createScriptWorld()');
}

function packed(world: ScriptWorld, ref: EntityRef) {
  return resolveEntityId(requireEcs(world), ref.id);
}

export function spawnEntity(world: ScriptWorld): EntityRef {
  return { id: requireEcs(world).create() };
}

export function destroyEntity(world: ScriptWorld, ref: EntityRef): void {
  requireEcs(world).destroy(packed(world, ref));
}

export function addEntityComponent(world: ScriptWorld, ref: EntityRef, component: string, value: unknown): void {
  requireEcs(world).add(packed(world, ref), component, value);
}

export function removeEntityComponent(world: ScriptWorld, ref: EntityRef, component: string): void {
  requireEcs(world).remove(packed(world, ref), component);
}

export function entityHasComponent(world: ScriptWorld, ref: EntityRef, component: string): boolean {
  return requireEcs(world).has(packed(world, ref), component);
}

/** Snapshot of entity refs that have every named component. An empty set matches nothing. */
export function queryEntities(world: ScriptWorld, components: readonly string[]): EntityRef[] {
  if (components.length === 0) return [];
  const ecs = requireEcs(world);
  const refs: EntityRef[] = [];
  for (const entity of ecs.query(...components)) refs.push({ id: entity });
  return refs;
}

/** Copy an iterable of entity ids or `{ id }` refs. Strings are not iterated. */
export function entityList(value: unknown): EntityRef[] {
  if (value === null || typeof value !== 'object' || !(Symbol.iterator in value)) return [];
  const refs: EntityRef[] = [];
  for (const item of value as Iterable<unknown>) {
    if (typeof item === 'number' && Number.isInteger(item)) {
      refs.push({ id: item });
      continue;
    }
    if (item && typeof item === 'object' && 'id' in item) {
      const id = (item as { id: unknown }).id;
      if (typeof id === 'string' || typeof id === 'number') refs.push({ id });
    }
  }
  return refs;
}

/** In-memory components and entity variables for tests. Not the Play-mode world. */
export function createMemoryWorld(self: EntityRef | string = { id: 'self' }): MemoryWorld {
  const selfRef: EntityRef = typeof self === 'string' ? { id: self } : self;
  const components = new Map<string, Map<string, unknown>>();
  const variables = new Map<string, Map<string, unknown>>();

  function componentBucket(entity: EntityRef): Map<string, unknown> {
    const key = String(entity.id);
    let bucket = components.get(key);
    if (!bucket) {
      bucket = new Map();
      components.set(key, bucket);
    }
    return bucket;
  }

  function variableBucket(entity: EntityRef): Map<string, unknown> {
    const key = String(entity.id);
    let bucket = variables.get(key);
    if (!bucket) {
      bucket = new Map();
      variables.set(key, bucket);
    }
    return bucket;
  }

  return {
    self: selfRef,
    getComponent(entity, component) {
      return componentBucket(entity).get(component);
    },
    setComponent(entity, component, value) {
      componentBucket(entity).set(component, value);
    },
    hasComponent(entity, component) {
      return componentBucket(entity).has(component);
    },
    getField(entity, component, field) {
      const current = componentBucket(entity).get(component);
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        return (current as Record<string, unknown>)[field];
      }
      return undefined;
    },
    setField(entity, component, field, value) {
      const bucket = componentBucket(entity);
      const current = bucket.get(component);
      const base: Record<string, unknown> =
        current && typeof current === 'object' && !Array.isArray(current)
          ? { ...(current as Record<string, unknown>) }
          : {};
      base[field] = value;
      bucket.set(component, base);
    },
    getVariable(entity, name) {
      return variableBucket(entity).get(name);
    },
    setVariable(entity, name, value) {
      variableBucket(entity).set(name, value);
    },
  };
}
