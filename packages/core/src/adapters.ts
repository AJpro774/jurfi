import { entityIndex, type Entity } from './entity';
import { componentModel, coerceComponentData } from './schema';
import { cloneJson } from './storage';
import { SCENE_VERSION, createWorld, resolveEntityId, type World } from './world';

/**
 * Editor document row. Field names match `EditorWorld` in `@jurfi/editor`.
 * Core does not import that package. String ids are aliases over numeric entities.
 */
export interface EditorEntityRecord {
  id: string;
  name: string;
  parentId: string | null;
  components: Record<string, unknown>;
  /** Packed ECS id. Present on rows read from the world so play mode can restore that slot. */
  eid?: number;
  /** Per-entity variables. Omitted by documents that predate the ECS adapter. */
  variables?: Record<string, unknown>;
}

export interface EditorSnapshot {
  entities: EditorEntityRecord[];
  /**
   * Next generation for every index below the high-water mark.
   * Present when the snapshot was read from the ECS, including dead slots.
   */
  generations?: number[];
}

/**
 * Structural match for `@jurfi/editor`'s `EditorWorld`.
 * `ecs` is the numeric world behind the document. Extra fields are fine to assign
 * into the editor interface.
 */
export interface EditorWorldView {
  readonly ecs: World;
  entities(): readonly EditorEntityRecord[];
  get(id: string): EditorEntityRecord | undefined;
  add(entity: EditorEntityRecord): void;
  update(id: string, patch: Partial<Omit<EditorEntityRecord, 'id'>>): void;
  remove(id: string): void;
  serialize(): EditorSnapshot;
  deserialize(snapshot: EditorSnapshot, options?: { preserveHistory?: boolean }): void;
  subscribe(listener: () => void): () => void;
}

export interface ScriptEntityRef {
  readonly id: string | number;
}

/** Structural match for `@jurfi/script`'s `ScriptWorld`, with the optional methods filled in. */
export interface ScriptWorldView {
  readonly ecs: World;
  readonly self: ScriptEntityRef;
  getComponent(entity: ScriptEntityRef, component: string): unknown;
  setComponent(entity: ScriptEntityRef, component: string, value: unknown): void;
  hasComponent(entity: ScriptEntityRef, component: string): boolean;
  getField(entity: ScriptEntityRef, component: string, field: string): unknown;
  setField(entity: ScriptEntityRef, component: string, field: string, value: unknown): void;
  getVariable(entity: ScriptEntityRef, name: string): unknown;
  setVariable(entity: ScriptEntityRef, name: string, value: unknown): void;
}

export function createEditorWorld(world: World = createWorld()): EditorWorldView {
  const unresolved = new Map<number, string>();
  const listeners = new Set<() => void>();

  world.events.on('destroyed', ({ entity }) => {
    unresolved.delete(entityIndex(entity));
  });
  world.subscribe(() => {
    for (const listener of [...listeners]) listener();
  });

  const editorId = (entity: Entity): string => world.alias(entity) ?? String(entity);

  const requireEntity = (id: string): Entity | undefined => {
    const aliased = world.resolveAlias(id);
    if (aliased !== undefined) return aliased;
    if (/^\d+$/.test(id)) {
      const numeric = Number(id);
      if (world.isAlive(numeric)) return numeric;
    }
    return undefined;
  };

  const recordOf = (entity: Entity): EditorEntityRecord => {
    const parent = world.getParent(entity);
    const pending = unresolved.get(entityIndex(entity));
    const components: Record<string, unknown> = {};
    for (const key of world.componentKeys(entity)) components[key] = world.get(entity, key);
    return {
      id: editorId(entity),
      name: world.getName(entity),
      parentId: pending ?? (parent === null ? null : editorId(parent)),
      components,
      eid: entity,
      variables: world.getVariables(entity),
    };
  };

  const applyParent = (entity: Entity, parentId: string | null): void => {
    const index = entityIndex(entity);
    if (parentId === null) {
      unresolved.delete(index);
      world.setParent(entity, null);
      return;
    }
    const parent = requireEntity(parentId);
    if (!parent) {
      world.setParent(entity, null);
      unresolved.set(index, parentId);
      return;
    }
    unresolved.delete(index);
    world.setParent(entity, parent);
  };

  const relink = (alias: string, parent: Entity): void => {
    for (const [index, pending] of [...unresolved]) {
      if (pending !== alias) continue;
      unresolved.delete(index);
      const child = world.entityAt(index);
      if (child) world.setParent(child, parent);
    }
  };

  return {
    ecs: world,
    entities() {
      return world.entities().map(recordOf);
    },
    get(id) {
      const entity = requireEntity(id);
      return entity ? recordOf(entity) : undefined;
    },
    add(entity) {
      if (typeof entity.id !== 'string' || entity.id.length === 0) {
        throw new Error('Entity id must be a non-empty string');
      }
      if (requireEntity(entity.id)) throw new Error(`Entity "${entity.id}" already exists`);
      world.transaction('Add entity', () => {
        const created = world.create();
        world.setAlias(created, entity.id);
        world.setName(created, entity.name);
        replaceComponents(world, created, entity.components);
        applyParent(created, entity.parentId);
        relink(entity.id, created);
      });
    },
    update(id, patch) {
      const entity = requireEntity(id);
      if (!entity) return;
      world.transaction('Update entity', () => {
        if (patch.name !== undefined) world.setName(entity, patch.name);
        if (patch.parentId !== undefined) applyParent(entity, patch.parentId);
        if (patch.components !== undefined) replaceComponents(world, entity, patch.components);
        if (patch.name === undefined && patch.parentId === undefined && patch.components === undefined) {
          world.setName(entity, world.getName(entity));
        }
      });
    },
    remove(id) {
      const entity = requireEntity(id);
      if (!entity) return;
      unresolved.delete(entityIndex(entity));
      world.transaction('Remove entity', () => {
        world.destroy(entity);
      });
    },
    serialize() {
      return { entities: world.entities().map(recordOf), generations: world.toScene().generations };
    },
    deserialize(snapshot, options) {
      if (!isEditorSnapshot(snapshot)) throw new Error('Invalid world snapshot');
      const seen = new Set<string>();
      for (const row of snapshot.entities) {
        if (seen.has(row.id)) throw new Error(`Entity "${row.id}" already exists`);
        seen.add(row.id);
      }
      const stable = snapshot.generations !== undefined && snapshot.entities.every((row) => typeof row.eid === 'number');
      const replace = (): void => {
        unresolved.clear();
        if (stable && snapshot.generations) {
          world.loadScene({
            version: SCENE_VERSION,
            generations: snapshot.generations,
            entities: snapshot.entities.map((row) => ({
              id: row.eid as number,
              name: row.name,
              parent: null,
              components: row.components,
              variables: row.variables ?? {},
            })),
          }, { preserveHistory: options?.preserveHistory });
          for (const row of snapshot.entities) {
            if (row.eid !== undefined) world.setAlias(row.eid, row.id);
          }
          for (const row of snapshot.entities) {
            if (row.eid === undefined || !world.isAlive(row.eid)) continue;
            applyParent(row.eid, row.parentId);
          }
          return;
        }
        for (const entity of [...world.entities()]) world.destroy(entity);
        const created: Entity[] = [];
        for (const row of snapshot.entities) {
          const entity = world.create();
          world.setAlias(entity, row.id);
          world.setName(entity, row.name);
          replaceComponents(world, entity, row.components);
          const variables = row.variables ?? {};
          for (const [name, value] of Object.entries(variables)) world.setVariable(entity, name, value);
          created.push(entity);
        }
        snapshot.entities.forEach((row, index) => {
          const entity = created[index];
          if (entity) applyParent(entity, row.parentId);
        });
      };
      if (options?.preserveHistory) {
        world.suspendHistory();
        try {
          replace();
        } finally {
          world.resumeHistory();
        }
        return;
      }
      world.batch(replace);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createScriptWorld(world: World, self?: Entity | ScriptEntityRef): ScriptWorldView {
  const created = self === undefined ? world.create() : undefined;
  const selfRef: ScriptEntityRef =
    typeof self === 'number' ? { id: self } : self ? { id: self.id } : { id: created ?? 0 };

  const entityOf = (ref: ScriptEntityRef): Entity => resolveEntityId(world, ref.id);

  return {
    ecs: world,
    self: selfRef,
    getComponent(entity, component) {
      return world.get(entityOf(entity), component);
    },
    setComponent(entity, component, value) {
      world.set(entityOf(entity), component, value);
    },
    hasComponent(entity, component) {
      return world.has(entityOf(entity), component);
    },
    getField(entity, component, field) {
      return world.getField(entityOf(entity), component, field);
    },
    setField(entity, component, field, value) {
      world.setField(entityOf(entity), component, field, value);
    },
    getVariable(entity, name) {
      return world.getVariable(entityOf(entity), name);
    },
    setVariable(entity, name, value) {
      world.setVariable(entityOf(entity), name, value);
    },
  };
}

function replaceComponents(world: World, entity: Entity, bag: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(bag)) {
    const model = componentModel(key);
    if (model) coerceComponentData(model, value);
    else cloneJson(value);
  }
  const next = new Set(Object.keys(bag));
  for (const key of world.componentKeys(entity)) {
    if (!next.has(key)) world.remove(entity, key);
  }
  for (const [key, value] of Object.entries(bag)) world.set(entity, key, value);
}

function isEditorSnapshot(value: unknown): value is EditorSnapshot {
  if (!isRecord(value) || !Array.isArray(value.entities)) return false;
  return value.entities.every((entity) => {
    if (!isRecord(entity)) return false;
    return (
      typeof entity.id === 'string' &&
      entity.id.length > 0 &&
      typeof entity.name === 'string' &&
      (entity.parentId === null || typeof entity.parentId === 'string') &&
      isRecord(entity.components)
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
