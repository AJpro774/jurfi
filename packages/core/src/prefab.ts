import type { Entity } from './entity';
import { migratePrefab, type PrefabJson, type PrefabNode } from './migrate';
import type { World } from './world';

/** Migrate `prefab` to the current envelope version and spawn it under `parent`. */
export function instantiatePrefab(world: World, prefab: PrefabJson | unknown, parent: Entity | null = null): Entity {
  const migrated = migratePrefab(prefab);
  return spawnNode(world, migrated, parent);
}

function spawnNode(world: World, node: PrefabNode, parent: Entity | null): Entity {
  const entity = world.create();
  world.setName(entity, typeof node.name === 'string' ? node.name : '');
  for (const [key, value] of Object.entries(node.components)) world.set(entity, key, value);
  for (const [name, value] of Object.entries(node.variables ?? {})) world.setVariable(entity, name, value);
  if (parent !== null) world.setParent(entity, parent);
  for (const child of node.children ?? []) spawnNode(world, child, entity);
  return entity;
}
