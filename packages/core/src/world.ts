import { Transform } from './components';
import { EntityPool, entityIndex, isEntityId, packEntity, type Entity } from './entity';
import { EcsError } from './errors';
import { WorldEventBus, type WorldEventMap, type WorldEventName } from './events';
import { buildRenderScene, composeTrs, type RenderInput, type RenderScene } from './render-scene';
import {
  coerceComponentData,
  componentModel,
  resolveFieldPath,
  validateFieldWrite,
  type ComponentType,
} from './schema';
import {
  cloneJson,
  createComponentStore,
  JsonStore,
  readJsonPath,
  writeJsonPath,
  type ComponentStore,
} from './storage';
import { migrateScene } from './migrate';
import { WorldClock } from './time';

export const SCENE_VERSION = 1 as const;

export interface SceneEntityJson {
  id: number;
  name: string;
  parent: number | null;
  components: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export interface SceneJson {
  /** Envelope version. Older documents are migrated up to {@link SCENE_VERSION}. */
  version: number;
  entities: SceneEntityJson[];
  /**
   * Generation to issue for every index below the high-water mark.
   * Live slots store their current generation. Dead slots store the next one,
   * so a stale id cannot be revived by a load.
   */
  generations: number[];
  /**
   * Schema version of each component id when the scene was saved.
   * Missing keys are treated as version 1.
   */
  componentVersions?: Record<string, number>;
}

export interface Query {
  readonly components: readonly string[];
  entities(): Entity[];
  forEach(fn: (entity: Entity) => void): void;
  size(): number;
  [Symbol.iterator](): Iterator<Entity>;
}

export interface WorldPlugin {
  readonly id?: string;
  setup(world: World): void;
}

export type ComponentRef = ComponentType | string;

class WorldQuery implements Query {
  constructor(
    private readonly collect: () => Entity[],
    readonly components: readonly string[],
  ) {}

  entities(): Entity[] {
    return this.collect();
  }

  forEach(fn: (entity: Entity) => void): void {
    for (const entity of this.collect()) fn(entity);
  }

  size(): number {
    return this.collect().length;
  }

  *[Symbol.iterator](): Iterator<Entity> {
    yield* this.collect();
  }
}

/**
 * Generational entity store with sparse and structure-of-arrays components.
 * No three.js and no DOM. Component values are JSON-serializable.
 */
export class World {
  readonly events = new WorldEventBus();
  readonly time = new WorldClock();

  private readonly pool = new EntityPool();
  private readonly stores = new Map<string, ComponentStore>();
  private readonly json = new JsonStore();
  private readonly vars: Array<Map<string, unknown> | undefined> = [];
  private readonly names: string[] = [];
  private readonly parentOf: number[] = [];
  private readonly children = new Map<number, Set<number>>();
  private readonly aliasOf = new Map<string, number>();
  private readonly aliasByIndex: string[] = [];
  private matrixDirty = new Uint8Array(0);
  private readonly listeners = new Set<() => void>();
  private readonly plugins = new Set<string>();
  private notifyDepth = 0;
  private notifyPending = false;
  private disposed = false;

  create(): Entity {
    this.assertOpen();
    const entity = this.pool.create();
    const index = entityIndex(entity);
    this.names[index] = '';
    this.parentOf[index] = -1;
    this.markMatrixDirty(index);
    this.events.emit('created', { entity });
    this.touch();
    return entity;
  }

  destroy(entity: Entity): void {
    this.assertOpen();
    if (!this.pool.isAlive(entity)) return;
    const index = entityIndex(entity);
    const parent = this.parentOf[index] ?? -1;
    const kids = [...(this.children.get(index) ?? [])];
    for (const child of kids) {
      this.unlink(child);
      if (parent >= 0) {
        this.parentOf[child] = parent;
        this.link(parent, child);
      } else {
        this.parentOf[child] = -1;
      }
      this.markMatrixDirty(child);
    }
    this.children.delete(index);
    this.unlink(index);
    this.parentOf[index] = -1;
    this.names[index] = '';
    this.vars[index] = undefined;
    this.json.deleteEntity(index);
    for (const store of this.stores.values()) store.delete(index);
    this.clearAlias(index);
    if (index < this.matrixDirty.length) this.matrixDirty[index] = 0;
    this.pool.destroy(entity);
    this.events.emit('destroyed', { entity });
    this.touch();
  }

  isAlive(entity: Entity): boolean {
    return this.pool.isAlive(entity);
  }

  entities(): Entity[] {
    return this.pool.alive();
  }

  /** Alive entity currently stored at `index`, if any. */
  entityAt(index: number): Entity | undefined {
    const entity = packEntity(index, this.pool.generationAt(index));
    return this.pool.isAlive(entity) ? entity : undefined;
  }

  add<T extends object>(entity: Entity, component: ComponentType<T>, value?: Partial<T>): void;
  add(entity: Entity, component: string, value?: unknown): void;
  add(entity: Entity, component: ComponentRef, value?: unknown): void {
    this.assertAlive(entity);
    const index = entityIndex(entity);
    const model = componentModel(component);
    const id = componentId(component);
    if (!model) {
      if (this.json.has(index, id)) {
        throw new EcsError('duplicate-component', `Entity ${entity} already has "${id}"`);
      }
      this.json.set(index, id, value === undefined ? {} : value);
      this.events.emit('added', { entity, component: id });
      this.touch();
      return;
    }
    const store = this.storeFor(model.id, model);
    if (store.has(index)) {
      throw new EcsError('duplicate-component', `Entity ${entity} already has "${model.id}"`);
    }
    store.write(index, coerceComponentData(model, value));
    if (model.id === Transform.id) this.markMatrixDirty(index);
    this.events.emit('added', { entity, component: model.id });
    this.touch();
  }

  /** Insert or replace a component. Missing schema fields are filled with defaults. */
  set<T extends object>(entity: Entity, component: ComponentType<T>, value: Partial<T>): void;
  set(entity: Entity, component: string, value: unknown): void;
  set(entity: Entity, component: ComponentRef, value: unknown): void {
    this.assertAlive(entity);
    const index = entityIndex(entity);
    const model = componentModel(component);
    const id = componentId(component);
    if (!model) {
      const existed = this.json.has(index, id);
      this.json.set(index, id, value);
      this.events.emit(existed ? 'changed' : 'added', { entity, component: id });
      this.touch();
      return;
    }
    const store = this.storeFor(model.id, model);
    const existed = store.has(index);
    store.write(index, coerceComponentData(model, value));
    if (model.id === Transform.id) this.markMatrixDirty(index);
    this.events.emit(existed ? 'changed' : 'added', { entity, component: model.id });
    this.touch();
  }

  get<T extends object>(entity: Entity, component: ComponentType<T>): T | undefined;
  get(entity: Entity, component: string): unknown;
  get(entity: Entity, component: ComponentRef): unknown {
    if (!this.pool.isAlive(entity)) return undefined;
    const index = entityIndex(entity);
    const model = componentModel(component);
    if (!model) return this.json.get(index, componentId(component));
    return this.storeFor(model.id, model).read(index);
  }

  has(entity: Entity, component: ComponentRef): boolean {
    if (!this.pool.isAlive(entity)) return false;
    const index = entityIndex(entity);
    const model = componentModel(component);
    if (!model) return this.json.has(index, componentId(component));
    return this.storeFor(model.id, model).has(index);
  }

  remove(entity: Entity, component: ComponentRef): void {
    this.assertAlive(entity);
    const index = entityIndex(entity);
    const model = componentModel(component);
    const id = componentId(component);
    const removed = model ? this.storeFor(model.id, model).delete(index) : this.json.delete(index, id);
    if (!removed) return;
    if (id === Transform.id) this.markMatrixDirty(index);
    this.events.emit('removed', { entity, component: id });
    this.touch();
  }

  /**
   * Read one schema field, or a vector lane (`position.x`, `color.r`).
   * Returns `undefined` when the entity is dead or the component is absent.
   * An unknown field on a defined component throws.
   */
  getField(entity: Entity, component: ComponentRef, path: string): unknown {
    if (!this.pool.isAlive(entity)) return undefined;
    const index = entityIndex(entity);
    const model = componentModel(component);
    if (!model) {
      if (!this.json.has(index, componentId(component))) return undefined;
      return readJsonPath(this.json.get(index, componentId(component)), path);
    }
    const store = this.storeFor(model.id, model);
    if (!store.has(index)) return undefined;
    return store.readPath(index, resolveFieldPath(model, path));
  }

  /**
   * Write one field. Creates the component from defaults when it is missing.
   * Values are checked against the component schema.
   */
  setField(entity: Entity, component: ComponentRef, path: string, value: unknown): void {
    this.assertAlive(entity);
    const index = entityIndex(entity);
    const model = componentModel(component);
    const id = componentId(component);
    if (!model) {
      const existed = this.json.has(index, id);
      const next = writeJsonPath(existed ? this.json.get(index, id) : {}, path, cloneJson(value));
      this.json.set(index, id, next);
      this.events.emit(existed ? 'changed' : 'added', { entity, component: id, field: path });
      this.touch();
      return;
    }
    const store = this.storeFor(model.id, model);
    const resolved = resolveFieldPath(model, path);
    const checked = validateFieldWrite(model, resolved, value);
    const existed = store.has(index);
    if (!existed) store.write(index, coerceComponentData(model, undefined));
    store.writePath(index, resolved, checked);
    if (model.id === Transform.id) this.markMatrixDirty(index);
    this.events.emit(existed ? 'changed' : 'added', { entity, component: model.id, field: path });
    this.touch();
  }

  componentKeys(entity: Entity): string[] {
    if (!this.pool.isAlive(entity)) return [];
    const index = entityIndex(entity);
    const keys: string[] = [];
    for (const [id, store] of this.stores) {
      if (store.has(index)) keys.push(id);
    }
    for (const key of this.json.keys(index)) keys.push(key);
    return keys;
  }

  getVariable(entity: Entity, name: string): unknown {
    if (!this.pool.isAlive(entity)) return undefined;
    const value = this.vars[entityIndex(entity)]?.get(name);
    if (value === undefined) return undefined;
    return cloneJson(value);
  }

  setVariable(entity: Entity, name: string, value: unknown): void {
    this.assertAlive(entity);
    if (typeof name !== 'string' || name.length === 0) {
      throw new EcsError('invalid-value', 'Variable name must be a non-empty string');
    }
    const index = entityIndex(entity);
    let bucket = this.vars[index];
    if (!bucket) {
      bucket = new Map();
      this.vars[index] = bucket;
    }
    if (value === undefined) bucket.delete(name);
    else bucket.set(name, cloneJson(value));
    this.touch();
  }

  hasVariable(entity: Entity, name: string): boolean {
    if (!this.pool.isAlive(entity)) return false;
    return this.vars[entityIndex(entity)]?.has(name) ?? false;
  }

  deleteVariable(entity: Entity, name: string): void {
    this.assertAlive(entity);
    this.vars[entityIndex(entity)]?.delete(name);
    this.touch();
  }

  getName(entity: Entity): string {
    if (!this.pool.isAlive(entity)) return '';
    return this.names[entityIndex(entity)] ?? '';
  }

  setName(entity: Entity, name: string): void {
    this.assertAlive(entity);
    if (typeof name !== 'string') throw new EcsError('invalid-value', 'Entity name must be a string');
    this.names[entityIndex(entity)] = name;
    this.touch();
  }

  getParent(entity: Entity): Entity | null {
    if (!this.pool.isAlive(entity)) return null;
    const parent = this.parentOf[entityIndex(entity)] ?? -1;
    if (parent < 0) return null;
    return this.entityAt(parent) ?? null;
  }

  setParent(entity: Entity, parent: Entity | null): void {
    this.assertAlive(entity);
    const index = entityIndex(entity);
    if (parent === null) {
      this.unlink(index);
      this.parentOf[index] = -1;
      this.markMatrixDirty(index);
      this.touch();
      return;
    }
    if (!this.pool.isAlive(parent)) {
      throw new EcsError('dead-entity', `Parent ${parent} is not alive`);
    }
    const parentIndex = entityIndex(parent);
    if (parentIndex === index || this.isUnder(parentIndex, index)) {
      throw new EcsError('cycle', `Parenting entity ${entity} to ${parent} would form a cycle`);
    }
    this.unlink(index);
    this.parentOf[index] = parentIndex;
    this.link(parentIndex, index);
    this.markMatrixDirty(index);
    this.touch();
  }

  query(...components: ComponentRef[]): Query {
    const names = components.map(componentId);
    return new WorldQuery(() => this.match(names), names);
  }

  use(plugin: WorldPlugin): this {
    this.assertOpen();
    if (plugin.id !== undefined && this.plugins.has(plugin.id)) return this;
    plugin.setup(this);
    if (plugin.id !== undefined) this.plugins.add(plugin.id);
    return this;
  }

  setAlias(entity: Entity, alias: string): void {
    this.assertAlive(entity);
    if (typeof alias !== 'string' || alias.length === 0) {
      throw new EcsError('invalid-value', 'Alias must be a non-empty string');
    }
    const index = entityIndex(entity);
    const owner = this.aliasOf.get(alias);
    if (owner !== undefined && owner !== index) {
      throw new EcsError('duplicate-alias', `Alias "${alias}" is already in use`);
    }
    const previous = this.aliasByIndex[index];
    if (previous && previous !== alias) this.aliasOf.delete(previous);
    this.aliasOf.set(alias, index);
    this.aliasByIndex[index] = alias;
  }

  alias(entity: Entity): string | undefined {
    if (!this.pool.isAlive(entity)) return undefined;
    const name = this.aliasByIndex[entityIndex(entity)];
    return name ? name : undefined;
  }

  resolveAlias(alias: string): Entity | undefined {
    const index = this.aliasOf.get(alias);
    if (index === undefined) return undefined;
    return this.entityAt(index);
  }

  /**
   * Alive entities in index order, with world matrices parallel to that list.
   * `view(componentId)` is aligned with `entities`.
   */
  renderScene(): RenderScene {
    this.assertOpen();
    const alive = this.pool.alive();
    const items: RenderInput[] = alive.map((entity) => ({
      entity,
      parent: this.getParent(entity),
      local: this.localMatrix(entity),
      dirty: (this.matrixDirty[entityIndex(entity)] ?? 0) === 1,
    }));
    const scene = buildRenderScene(items, (entity, component) => this.get(entity, component));
    for (const entity of alive) {
      const index = entityIndex(entity);
      if (index < this.matrixDirty.length) this.matrixDirty[index] = 0;
    }
    return scene;
  }

  toScene(): SceneJson {
    const entities: SceneEntityJson[] = [];
    const componentVersions: Record<string, number> = {};
    for (const entity of this.pool.alive()) {
      const components: Record<string, unknown> = {};
      for (const key of this.componentKeys(entity)) {
        components[key] = this.get(entity, key);
        componentVersions[key] = componentModel(key)?.version ?? 1;
      }
      const variables: Record<string, unknown> = {};
      const bucket = this.vars[entityIndex(entity)];
      if (bucket) {
        for (const [name, value] of bucket) variables[name] = cloneJson(value);
      }
      entities.push({
        id: entity,
        name: this.getName(entity),
        parent: this.getParent(entity),
        components,
        variables,
      });
    }
    return {
      version: SCENE_VERSION,
      entities,
      generations: this.pool.generationSnapshot(),
      componentVersions,
    };
  }

  loadScene(scene: SceneJson): void {
    this.assertOpen();
    const migrated = migrateScene(scene, SCENE_VERSION);
    scene = migrated;
    if (!Array.isArray(scene.entities)) {
      throw new EcsError('invalid-scene', 'Scene JSON must include an entities array');
    }
    const live: Entity[] = [];
    for (const row of scene.entities) {
      if (!row || typeof row !== 'object' || !isEntityId(row.id)) {
        throw new EcsError('invalid-scene', 'Scene entity is missing a numeric id');
      }
      live.push(row.id);
    }
    this.batch(() => {
      this.resetStorage();
      this.pool.load(live, scene.generations);
      for (const row of scene.entities) {
        const entity = row.id;
        this.names[entityIndex(entity)] = typeof row.name === 'string' ? row.name : '';
        const components = row.components ?? {};
        if (!isRecord(components)) throw new EcsError('invalid-scene', `Entity ${entity} components must be an object`);
        for (const [key, value] of Object.entries(components)) this.set(entity, key, value);
        const variables = row.variables ?? {};
        if (!isRecord(variables)) throw new EcsError('invalid-scene', `Entity ${entity} variables must be an object`);
        for (const [name, value] of Object.entries(variables)) this.setVariable(entity, name, value);
      }
      for (const row of scene.entities) {
        if (row.parent === null || row.parent === undefined) continue;
        if (!this.pool.isAlive(row.parent)) {
          throw new EcsError('invalid-scene', `Entity ${row.id} parent ${String(row.parent)} is not in the scene`);
        }
        this.setParent(row.id, row.parent);
      }
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Run `fn` and notify subscribers once, after the last nested batch finishes. */
  batch<T>(fn: () => T): T {
    this.notifyDepth += 1;
    try {
      return fn();
    } finally {
      this.notifyDepth -= 1;
      if (this.notifyDepth === 0 && this.notifyPending) {
        this.notifyPending = false;
        this.flush();
      }
    }
  }

  on<K extends WorldEventName>(type: K, listener: (event: WorldEventMap[K]) => void): () => void {
    return this.events.on(type, listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.resetStorage();
    this.listeners.clear();
    this.disposed = true;
  }

  private match(names: readonly string[]): Entity[] {
    const alive = this.pool.alive();
    if (names.length === 0) return alive;
    return alive.filter((entity) => names.every((name) => this.has(entity, name)));
  }

  private storeFor(id: string, model: NonNullable<ReturnType<typeof componentModel>>): ComponentStore {
    let store = this.stores.get(id);
    if (!store) {
      store = createComponentStore(model);
      this.stores.set(id, store);
    }
    return store;
  }

  private localMatrix(entity: Entity): Float32Array | null {
    if (!this.has(entity, Transform)) return null;
    const data = this.get(entity, Transform);
    if (!data) return null;
    const matrix = new Float32Array(16);
    composeTrs(data.position, data.rotation, data.scale, matrix, 0);
    return matrix;
  }

  private markMatrixDirty(index: number): void {
    this.ensureDirty(index);
    if (this.matrixDirty[index] === 1) return;
    this.matrixDirty[index] = 1;
    const kids = this.children.get(index);
    if (!kids) return;
    for (const child of kids) this.markMatrixDirty(child);
  }

  private ensureDirty(index: number): void {
    if (index < this.matrixDirty.length) return;
    const next = new Uint8Array(Math.max(index + 1, this.matrixDirty.length * 2, 8));
    next.set(this.matrixDirty);
    this.matrixDirty = next;
  }

  private link(parent: number, child: number): void {
    let kids = this.children.get(parent);
    if (!kids) {
      kids = new Set();
      this.children.set(parent, kids);
    }
    kids.add(child);
  }

  private unlink(index: number): void {
    const parent = this.parentOf[index] ?? -1;
    if (parent >= 0) this.children.get(parent)?.delete(index);
  }

  /** True when `index` is `ancestor` or sits under it. */
  private isUnder(index: number, ancestor: number): boolean {
    let cursor = index;
    const seen = new Set<number>();
    while (cursor >= 0 && !seen.has(cursor)) {
      if (cursor === ancestor) return true;
      seen.add(cursor);
      cursor = this.parentOf[cursor] ?? -1;
    }
    return false;
  }

  private clearAlias(index: number): void {
    const alias = this.aliasByIndex[index];
    if (alias) this.aliasOf.delete(alias);
    this.aliasByIndex[index] = '';
  }

  private resetStorage(): void {
    this.pool.clear();
    for (const store of this.stores.values()) store.clear();
    this.stores.clear();
    this.json.clear();
    this.vars.length = 0;
    this.names.length = 0;
    this.parentOf.length = 0;
    this.children.clear();
    this.aliasOf.clear();
    this.aliasByIndex.length = 0;
    this.matrixDirty = new Uint8Array(0);
  }

  private assertAlive(entity: Entity): void {
    this.assertOpen();
    if (!this.pool.isAlive(entity)) {
      throw new EcsError('dead-entity', `Entity ${String(entity)} is not alive`);
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new EcsError('disposed', 'World has been disposed');
  }

  private touch(): void {
    if (this.notifyDepth > 0) {
      this.notifyPending = true;
      return;
    }
    this.flush();
  }

  private flush(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function componentId(component: ComponentRef): string {
  return typeof component === 'string' ? component : component.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createWorld(): World {
  return new World();
}

/** Resolve a script or editor id to a packed entity. Dead numeric ids are returned as-is. */
export function resolveEntityId(world: World, id: string | number): Entity {
  if (typeof id === 'number' && isEntityId(id)) return id;
  if (typeof id === 'string') {
    const alias = world.resolveAlias(id);
    if (alias !== undefined) return alias;
    if (/^\d+$/.test(id)) {
      const numeric = Number(id);
      if (isEntityId(numeric)) return numeric;
    }
  }
  return 0;
}
