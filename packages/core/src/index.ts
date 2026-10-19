export const VERSION = '0.0.0';

export interface Disposable {
  dispose(): void;
}

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export type { EcsErrorCode } from './errors';
export { EcsError } from './errors';

export type { Entity } from './entity';
export {
  GENERATION_BITS,
  GENERATION_MASK,
  INDEX_BITS,
  INDEX_MASK,
  MAX_ENTITY_INDEX,
  NULL_ENTITY,
  entityGeneration,
  entityIndex,
  isEntityId,
  nextGeneration,
  packEntity,
} from './entity';

export type { ComponentType, ComponentValue, FieldSchema, FieldType, Schema, StorageKind } from './schema';
export {
  FIELD_TYPES,
  defineComponent,
  getComponentType,
  listComponentTypes,
  resolveStorage,
} from './schema';

export { Light, Light2D, Transform } from './components';

export type { WorldEventMap, WorldEventName } from './events';
export { WorldEventBus } from './events';
export type { EntitySnapshot, WorldChange, WorldPatch } from './history';
export type { MigrationFn, PrefabJson, PrefabNode } from './migrate';
export {
  PREFAB_VERSION,
  migrateComponent,
  migratePrefab,
  migrateScene,
  registerMigration,
  registerPrefabMigration,
  registerSceneMigration,
} from './migrate';
export { instantiatePrefab } from './prefab';
export type { Query, SceneEntityJson, SceneJson, WorldPlugin, ComponentRef, SetParentOptions } from './world';
export { SCENE_VERSION, World, createWorld, resolveEntityId } from './world';

export type { RenderScene } from './render-scene';
export { WorldClock } from './time';

export type { EditorEntityRecord, EditorSnapshot, EditorWorldView, ScriptEntityRef, ScriptWorldView } from './adapters';
export { createEditorWorld, createScriptWorld } from './adapters';
