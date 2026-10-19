/**
 * Entity and component access for visual scripts.
 *
 * Play mode and the compiled host default to `createScriptWorld(createWorld())` from `@jurfi/core`.
 * `createMemoryWorld` is a test stand-in with string ids and map storage.
 */
export interface EntityRef {
  readonly id: string | number;
}

export interface ScriptWorld {
  /** Entity the running graph is attached to. */
  readonly self: EntityRef;
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
 * `missing` stays empty while `createScriptWorld` covers components, fields, and entity variables.
 * Spawn, destroy, remove, and queries exist on `World` and are not script nodes yet.
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
