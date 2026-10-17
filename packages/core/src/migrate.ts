import { EcsError } from './errors';
import { componentModel } from './schema';
import type { SceneJson } from './world';

/** One step from version N to N+1. Return the migrated value. */
export type MigrationFn = (data: unknown) => unknown;

export interface PrefabNode {
  name: string;
  components: Record<string, unknown>;
  /** Schema version of each component when this node was saved. Missing keys are version 1. */
  componentVersions?: Record<string, number>;
  variables?: Record<string, unknown>;
  children?: PrefabNode[];
}

/** Reusable entity template. `version` is the prefab envelope, not a component schema. */
export interface PrefabJson extends PrefabNode {
  version: number;
}

export const PREFAB_VERSION = 1 as const;

const componentMigrations = new Map<string, Map<number, MigrationFn>>();
const sceneMigrations = new Map<number, MigrationFn>();
const prefabMigrations = new Map<number, MigrationFn>();

/**
 * Register a component step from `fromVersion` to `fromVersion + 1`.
 * Nothing is registered at import time, so unused migrations stay out of a bundle
 * until the caller invokes this.
 */
export function registerMigration(componentId: string, fromVersion: number, fn: MigrationFn): void {
  assertId(componentId);
  assertStep(fromVersion);
  assertFn(fn);
  let chain = componentMigrations.get(componentId);
  if (!chain) {
    chain = new Map();
    componentMigrations.set(componentId, chain);
  }
  if (chain.has(fromVersion)) {
    throw new EcsError(
      'duplicate-id',
      `Migration for "${componentId}" from version ${fromVersion} is already registered`,
    );
  }
  chain.set(fromVersion, fn);
}

/** Register a scene-envelope step from `fromVersion` to `fromVersion + 1`. */
export function registerSceneMigration(fromVersion: number, fn: MigrationFn): void {
  assertStep(fromVersion);
  assertFn(fn);
  if (sceneMigrations.has(fromVersion)) {
    throw new EcsError('duplicate-id', `Scene migration from version ${fromVersion} is already registered`);
  }
  sceneMigrations.set(fromVersion, fn);
}

/** Register a prefab-envelope step from `fromVersion` to `fromVersion + 1`. */
export function registerPrefabMigration(fromVersion: number, fn: MigrationFn): void {
  assertStep(fromVersion);
  assertFn(fn);
  if (prefabMigrations.has(fromVersion)) {
    throw new EcsError('duplicate-id', `Prefab migration from version ${fromVersion} is already registered`);
  }
  prefabMigrations.set(fromVersion, fn);
}

export function migrateComponent(componentId: string, fromVersion: number, toVersion: number, data: unknown): unknown {
  if (fromVersion > toVersion) {
    throw new EcsError(
      'invalid-scene',
      `Component "${componentId}" version ${fromVersion} is newer than ${toVersion}`,
    );
  }
  let version = fromVersion;
  let current = data;
  while (version < toVersion) {
    const fn = componentMigrations.get(componentId)?.get(version);
    if (!fn) {
      throw new EcsError(
        'missing-migration',
        `No migration for "${componentId}" from version ${version} to ${version + 1}`,
      );
    }
    current = fn(current);
    version += 1;
  }
  return current;
}

/**
 * Run envelope migrations up to `targetVersion`, then each component chain.
 * `loadScene` calls this with the current scene version.
 */
export function migrateScene(input: unknown, targetVersion: number): SceneJson {
  const raw = migrateEnvelope(input, targetVersion, sceneMigrations, 'scene');
  if (!isRecord(raw) || !Array.isArray(raw.entities) || !Array.isArray(raw.generations)) {
    throw new EcsError('invalid-scene', 'Scene JSON must include entities and generations arrays');
  }
  const versions = versionMap(raw.componentVersions);
  const entities = raw.entities.map((entity) => {
    if (!isRecord(entity)) throw new EcsError('invalid-scene', 'Scene entity must be an object');
    const components = migrateComponentMap(recordOrEmpty(entity.components), versions);
    return {
      id: entity.id as number,
      name: typeof entity.name === 'string' ? entity.name : '',
      parent: entity.parent === undefined ? null : (entity.parent as number | null),
      components,
      variables: recordOrEmpty(entity.variables),
    };
  });
  return {
    version: targetVersion,
    entities,
    generations: raw.generations as number[],
    componentVersions: currentComponentVersions(entities.flatMap((entity) => Object.keys(entity.components))),
  };
}

/** Run prefab envelope migrations, then component chains on every node. */
export function migratePrefab(input: unknown, targetVersion: number = PREFAB_VERSION): PrefabJson {
  const migrated = migrateEnvelope(input, targetVersion, prefabMigrations, 'prefab');
  return stampPrefab(migrated as PrefabNode, targetVersion);
}

function stampPrefab(node: unknown, version: number): PrefabJson {
  if (!isRecord(node)) throw new EcsError('invalid-scene', 'Prefab node must be an object');
  const components = migrateComponentMap(recordOrEmpty(node.components), versionMap(node.componentVersions));
  const rawChildren = Array.isArray(node.children) ? node.children : [];
  const children = rawChildren.map((child) => {
    const stamped = stampPrefab(child, version);
    return {
      name: stamped.name,
      components: stamped.components,
      componentVersions: stamped.componentVersions,
      variables: stamped.variables,
      children: stamped.children,
    };
  });
  return {
    version,
    name: typeof node.name === 'string' ? node.name : '',
    components,
    componentVersions: currentComponentVersions(Object.keys(components)),
    variables: recordOrEmpty(node.variables),
    children,
  };
}

function versionMap(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, version] of Object.entries(value)) {
    if (typeof version === 'number' && Number.isInteger(version) && version >= 1) out[key] = version;
  }
  return out;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function migrateComponentMap(
  components: Record<string, unknown> | undefined,
  versions: Record<string, number> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(components ?? {})) {
    const from = versions?.[key] ?? 1;
    const declared = componentModel(key)?.version;
    const to = declared ?? latestRegistered(key, from);
    out[key] = migrateComponent(key, from, to, value);
  }
  return out;
}

function currentComponentVersions(ids: readonly string[]): Record<string, number> {
  const versions: Record<string, number> = {};
  for (const id of ids) versions[id] = componentModel(id)?.version ?? latestRegistered(id, 1);
  return versions;
}

function latestRegistered(componentId: string, from: number): number {
  let version = from;
  const chain = componentMigrations.get(componentId);
  while (chain?.has(version)) version += 1;
  return version;
}

function migrateEnvelope(
  input: unknown,
  targetVersion: number,
  registry: Map<number, MigrationFn>,
  kind: 'scene' | 'prefab',
): unknown {
  if (!isRecord(input) || typeof input.version !== 'number' || !Number.isInteger(input.version)) {
    throw new EcsError('invalid-scene', `${kind} JSON is missing an integer version`);
  }
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new EcsError('invalid-value', `${kind} target version must be an integer >= 1`);
  }
  if (input.version > targetVersion) {
    throw new EcsError(
      'invalid-scene',
      `${kind} version ${input.version} is newer than supported version ${targetVersion}`,
    );
  }
  if (input.version < 1) {
    throw new EcsError('invalid-scene', `${kind} version ${input.version} is not supported`);
  }
  let version = input.version;
  let current: unknown = input;
  while (version < targetVersion) {
    const fn = registry.get(version);
    if (!fn) {
      throw new EcsError('missing-migration', `No migration for ${kind} from version ${version} to ${version + 1}`);
    }
    current = fn(current);
    version += 1;
    if (!isRecord(current)) {
      throw new EcsError('invalid-scene', `${kind} migration to version ${version} did not return an object`);
    }
    current = { ...current, version };
  }
  return current;
}

function assertId(componentId: string): void {
  if (typeof componentId !== 'string' || componentId.length === 0) {
    throw new EcsError('invalid-value', 'Component id must be a non-empty string');
  }
}

function assertStep(fromVersion: number): void {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new EcsError('invalid-value', 'Migration fromVersion must be an integer >= 1');
  }
}

function assertFn(fn: MigrationFn): void {
  if (typeof fn !== 'function') throw new EcsError('invalid-value', 'Migration must be a function');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
