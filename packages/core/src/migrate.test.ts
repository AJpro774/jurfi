import { describe, expect, it } from 'vitest';
import { Transform } from './components';
import { EcsError } from './errors';
import gapScene from './fixtures/gap-v1.json';
import prefabFile from './fixtures/prefab-v1.json';
import labelScene from './fixtures/scene-label-v1.json';
import exportedScene from './fixtures/scene-export-v1.json';
import widgetScene from './fixtures/widget-v1.json';
import {
  migrateComponent,
  migratePrefab,
  migrateScene,
  registerMigration,
  registerPrefabMigration,
  registerSceneMigration,
} from './migrate';
import { instantiatePrefab } from './prefab';
import { defineComponent } from './schema';
import { createWorld, type SceneJson } from './world';

const MigWidget = defineComponent(
  'MigWidget',
  {
    health: { type: 'number', default: 0 },
    max: { type: 'number', default: 10 },
  },
  { version: 3 },
);

defineComponent('MigGap', { health: { type: 'number', default: 0 } }, { version: 3 });

registerMigration('MigWidget', 1, (data) => {
  const row = asRecord(data);
  return { hp: row.hp, max: 10 };
});
registerMigration('MigWidget', 2, (data) => {
  const row = asRecord(data);
  return { health: row.hp, max: row.max };
});
registerMigration('MigGap', 1, (data) => data);

registerSceneMigration(1, (data) => {
  const scene = asRecord(data);
  const entities = Array.isArray(scene.entities) ? scene.entities : [];
  return {
    ...scene,
    entities: entities.map((entity) => {
      const row = asRecord(entity);
      const name = typeof row.name === 'string' ? row.name : typeof row.label === 'string' ? row.label : '';
      return { ...row, name };
    }),
  };
});
registerSceneMigration(2, (data) => {
  const scene = asRecord(data);
  const entities = Array.isArray(scene.entities) ? scene.entities : [];
  return {
    ...scene,
    entities: entities.map((entity) => {
      const row = asRecord(entity);
      const variables = asRecord(row.variables);
      return { ...row, variables: { ...variables, ready: true } };
    }),
  };
});

registerPrefabMigration(1, (data) => renamePrefab(data));
registerPrefabMigration(2, (data) => suffixPrefab(data, ' v3'));

describe('migrations', () => {
  it('loads an exported scene fixture without editor code', () => {
    const world = createWorld();
    world.loadScene(exportedScene as SceneJson);
    const parent = 1048576;
    const child = 1048577;
    expect(world.getName(parent)).toBe('Parent');
    expect(world.getName(child)).toBe('Child');
    expect(world.getParent(child)).toBe(parent);
    expect(world.getField(parent, Transform, 'position')).toEqual([1, 2, 3]);
    expect(world.getVariable(parent, 'score')).toBe(4);
    expect(world.get(parent, Transform)).not.toHaveProperty('radius');

    const live = createWorld();
    const entity = live.create();
    live.setName(entity, 'Saved');
    live.add(entity, Transform, { position: [8, 0, 0] });
    live.setVariable(entity, 'n', 1);
    const copy = createWorld();
    copy.loadScene(JSON.parse(JSON.stringify(live.toScene())) as SceneJson);
    expect(copy.getName(entity)).toBe('Saved');
    expect(copy.getField(entity, Transform, 'position.x')).toBe(8);
    expect(copy.getVariable(entity, 'n')).toBe(1);
    expect(copy.toScene().componentVersions?.Transform).toBe(1);
  });

  it('runs two component migrations while loading a version 1 scene', () => {
    expect(migrateComponent('MigWidget', 1, 2, { hp: 4 })).toEqual({ hp: 4, max: 10 });
    expect(migrateComponent('MigWidget', 1, 3, { hp: 4 })).toEqual({ health: 4, max: 10 });
    const step = migrateScene(widgetScene, 1);
    expect(step.entities[0]?.components.MigWidget).toEqual({ health: 4, max: 10 });

    const world = createWorld();
    world.loadScene(widgetScene as SceneJson);
    const entity = 1048576;
    expect(world.get(entity, MigWidget)).toEqual({ health: 4, max: 10 });
    expect(world.toScene().componentVersions?.MigWidget).toBe(3);
    const again = createWorld();
    again.loadScene(world.toScene());
    expect(again.get(entity, MigWidget)).toEqual({ health: 4, max: 10 });
  });

  it('runs two scene-envelope migrations and two prefab-envelope migrations', () => {
    const named = migrateScene(labelScene, 2);
    expect(named.version).toBe(2);
    expect(named.entities[0]?.name).toBe('FromLabel');
    expect(named.entities[0]?.variables.ready).toBeUndefined();

    const ready = migrateScene(labelScene, 3);
    expect(ready.version).toBe(3);
    expect(ready.entities[0]?.name).toBe('FromLabel');
    expect(ready.entities[0]?.variables.ready).toBe(true);

    const prefabV2 = migratePrefab(prefabFile, 2);
    expect(prefabV2.version).toBe(2);
    expect(prefabV2.name).toBe('Turret');
    expect(prefabV2.children?.[0]?.name).toBe('Barrel');
    expect(prefabV2.name.endsWith(' v3')).toBe(false);

    const prefabV3 = migratePrefab(prefabFile, 3);
    expect(prefabV3.version).toBe(3);
    expect(prefabV3.name).toBe('Turret v3');
    expect(prefabV3.children?.[0]?.name).toBe('Barrel v3');
    expect(prefabV3.components.MigWidget).toEqual({ health: 2, max: 10 });
  });

  it('throws when a component migration step is missing', () => {
    expect(() => createWorld().loadScene(gapScene as SceneJson)).toThrow(EcsError);
    try {
      createWorld().loadScene(gapScene as SceneJson);
    } catch (error) {
      expect(error).toBeInstanceOf(EcsError);
      expect((error as EcsError).code).toBe('missing-migration');
      expect((error as EcsError).message).toContain('MigGap');
      expect((error as EcsError).message).toContain('version 2');
    }
  });

  it('instantiates a migrated prefab without editor code', () => {
    const world = createWorld();
    const root = instantiatePrefab(world, {
      version: 1,
      name: 'Turret',
      components: { MigWidget: { hp: 2 } },
      componentVersions: { MigWidget: 1 },
      children: [{ name: 'Barrel', components: {} }],
    });
    expect(world.getName(root)).toBe('Turret');
    expect(world.get(root, MigWidget)).toEqual({ health: 2, max: 10 });
    const child = world.entities().find((entity) => world.getName(entity) === 'Barrel');
    expect(child).toBeDefined();
    expect(world.getParent(child ?? 0)).toBe(root);
  });
});

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function renamePrefab(data: unknown): unknown {
  if (!asRecord(data) || Array.isArray(data) || data === null || typeof data !== 'object') return data;
  const row = asRecord(data);
  const name = typeof row.name === 'string' ? row.name : typeof row.label === 'string' ? row.label : '';
  const children = Array.isArray(row.children) ? row.children.map((child) => renamePrefab(child)) : [];
  return { ...row, name, children };
}

function suffixPrefab(data: unknown, suffix: string): unknown {
  const row = asRecord(data);
  const name = typeof row.name === 'string' ? row.name : '';
  const children = Array.isArray(row.children) ? row.children.map((child) => suffixPrefab(child, suffix)) : [];
  return { ...row, name: `${name}${suffix}`, children };
}
