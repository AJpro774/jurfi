/** JSON scene document the editor saves, snapshots, and hands to panels. */
export interface EntityRecord {
  id: string;
  name: string;
  parentId: string | null;
  /** JSON-serializable component bag. Panel owners agree on the keys. */
  components: Record<string, unknown>;
}

export interface WorldSnapshot {
  entities: EntityRecord[];
}

export interface EditorWorld {
  entities(): readonly EntityRecord[];
  get(id: string): EntityRecord | undefined;
  add(entity: EntityRecord): void;
  update(id: string, patch: Partial<Omit<EntityRecord, 'id'>>): void;
  remove(id: string): void;
  serialize(): WorldSnapshot;
  /** `preserveHistory` keeps the undo stack. Core scene loads use it when play stops. */
  deserialize(snapshot: WorldSnapshot, options?: { preserveHistory?: boolean }): void;
  subscribe(listener: () => void): () => void;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWorldSnapshot(value: unknown): value is WorldSnapshot {
  if (!isRecord(value) || !Array.isArray(value.entities)) return false;
  return value.entities.every((entity) => {
    if (!isRecord(entity)) return false;
    return typeof entity.id === 'string'
      && entity.id.length > 0
      && typeof entity.name === 'string'
      && (entity.parentId === null || typeof entity.parentId === 'string')
      && isRecord(entity.components);
  });
}

export function createDefaultSnapshot(): WorldSnapshot {
  return {
    entities: [
      { id: 'scene', name: 'Scene', parentId: null, components: {} },
      { id: 'camera', name: 'Camera', parentId: 'scene', components: { kind: 'camera' } },
      { id: 'player', name: 'Player', parentId: 'scene', components: { kind: 'node', health: -1 } },
    ],
  };
}

export function createWorld(initial: WorldSnapshot = createDefaultSnapshot()): EditorWorld {
  const entities = new Map<string, EntityRecord>();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const load = (snapshot: WorldSnapshot): void => {
    if (!isWorldSnapshot(snapshot)) throw new Error('Invalid world snapshot');
    entities.clear();
    for (const entity of snapshot.entities) entities.set(entity.id, clone(entity));
  };

  load(initial);

  return {
    entities() {
      return [...entities.values()].map((entity) => clone(entity));
    },
    get(id) {
      const entity = entities.get(id);
      return entity ? clone(entity) : undefined;
    },
    add(entity) {
      if (entities.has(entity.id)) throw new Error(`Entity "${entity.id}" already exists`);
      entities.set(entity.id, clone(entity));
      emit();
    },
    update(id, patch) {
      const current = entities.get(id);
      if (!current) return;
      const next: EntityRecord = {
        ...current,
        ...patch,
        id: current.id,
        components: patch.components ? clone(patch.components) : current.components,
      };
      entities.set(id, next);
      emit();
    },
    remove(id) {
      const entity = entities.get(id);
      if (!entity) return;
      for (const other of entities.values()) {
        if (other.parentId === id) other.parentId = entity.parentId;
      }
      entities.delete(id);
      emit();
    },
    serialize() {
      return { entities: [...entities.values()].map((entity) => clone(entity)) };
    },
    deserialize(snapshot) {
      load(snapshot);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
