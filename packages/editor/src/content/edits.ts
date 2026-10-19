import type { Entity } from '@jurfi/core';
import type { EditorContext } from '../context';
import { componentSchema } from './components';
import { commitEcs, ecsOf, freshEntityId, resolveEntity, siblingRecords } from './ecs';
import { flagBook, isRecord, readFlags } from './flags';

export interface Placement {
  parentId: string | null;
  /** Insert before this entity. Null appends after the last sibling. */
  beforeId: string | null;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function descendantIds(ctx: EditorContext, root: string): Set<string> {
  const found = new Set<string>();
  const walk = (id: string): void => {
    for (const child of siblingRecords(ctx, id)) {
      if (found.has(child.id)) continue;
      found.add(child.id);
      walk(child.id);
    }
  };
  walk(root);
  return found;
}

export function renameEntity(ctx: EditorContext, id: string, name: string): boolean {
  const entity = ctx.world.get(id);
  if (!entity || readFlags(ctx, id).locked || entity.name === name) return false;
  const ecs = ecsOf(ctx.world);
  const numeric = ecs ? resolveEntity(ecs, id) : undefined;
  if (!ecs || numeric === undefined) {
    const previous = entity.name;
    ctx.world.update(id, { name });
    ctx.undo.push({
      label: 'Rename',
      mergeKey: `entity:${id}:name`,
      undo: () => ctx.world.update(id, { name: previous }),
      redo: () => ctx.world.update(id, { name }),
    });
    return true;
  }
  return commitEcs(ctx, 'Rename', `entity:${id}:name`, (world) => {
    world.setName(numeric, name);
  });
}

export function setFlag(ctx: EditorContext, id: string, key: 'visible' | 'locked', value: boolean): boolean {
  if (!ctx.world.get(id)) return false;
  const flags = readFlags(ctx, id);
  if (flags[key] === value) return false;
  const before = flags;
  const next = { ...flags, [key]: value };
  const apply = (state: typeof flags): void => {
    flagBook(ctx).write(id, state);
    ctx.project.markDirty();
  };
  apply(next);
  ctx.undo.push({
    label: key === 'visible' ? 'Toggle visibility' : 'Toggle lock',
    undo: () => apply(before),
    redo: () => apply(next),
  });
  return true;
}

export function moveEntity(ctx: EditorContext, id: string, placement: Placement): boolean {
  const ecs = ecsOf(ctx.world);
  const moving = ctx.world.get(id);
  if (!ecs || !moving || readFlags(ctx, id).locked) return false;
  if (placement.parentId === id || placement.beforeId === id) return false;
  if (placement.parentId !== null && descendantIds(ctx, id).has(placement.parentId)) return false;
  if (placement.parentId !== null && (!ctx.world.get(placement.parentId) || readFlags(ctx, placement.parentId).locked)) {
    return false;
  }
  const entity = resolveEntity(ecs, id);
  const parent = placement.parentId === null ? null : resolveEntity(ecs, placement.parentId);
  if (entity === undefined || parent === undefined) return false;
  const siblings = siblingRecords(ctx, placement.parentId).filter((row) => row.id !== id);
  let index = siblings.length;
  if (placement.beforeId !== null) {
    const before = siblings.findIndex((row) => row.id === placement.beforeId);
    if (before >= 0) index = before;
  }
  const currentIndex = siblingRecords(ctx, moving.parentId).findIndex((row) => row.id === id);
  if (moving.parentId === placement.parentId && index === currentIndex) return false;
  return commitEcs(ctx, 'Move entity', undefined, (world) => {
    world.setParent(entity, parent, { keepWorldTransform: true, index });
  });
}

export function createEntity(ctx: EditorContext, parentId: string | null, name = 'Entity'): string | null {
  const ecs = ecsOf(ctx.world);
  if (!ecs) return null;
  if (parentId !== null && (!ctx.world.get(parentId) || readFlags(ctx, parentId).locked)) return null;
  const id = freshEntityId(ctx);
  const parent = parentId === null ? null : resolveEntity(ecs, parentId);
  if (parent === undefined) return null;
  const ok = commitEcs(ctx, parentId ? 'Create child' : 'Create entity', undefined, (world) => {
    const created = world.create();
    world.setAlias(created, id);
    world.setName(created, name);
    if (parent !== null) world.setParent(created, parent);
  });
  return ok ? id : null;
}

export function duplicateEntity(ctx: EditorContext, id: string): string | null {
  const ecs = ecsOf(ctx.world);
  const source = ctx.world.get(id);
  if (!ecs || !source || readFlags(ctx, id).locked) return null;
  const copyId = freshEntityId(ctx);
  const siblings = siblingRecords(ctx, source.parentId);
  const index = siblings.findIndex((row) => row.id === id);
  const parent = source.parentId === null ? null : resolveEntity(ecs, source.parentId);
  if (parent === undefined) return null;
  const components = source.components;
  const name = `${source.name} Copy`;
  const ok = commitEcs(ctx, 'Duplicate', undefined, (world) => {
    const created = world.create();
    world.setAlias(created, copyId);
    world.setName(created, name);
    for (const [key, value] of Object.entries(components)) world.set(created, key, value);
    world.setParent(created, parent, { index: index < 0 ? undefined : index + 1 });
  });
  return ok ? copyId : null;
}

export function deleteEntities(ctx: EditorContext, ids: readonly string[]): boolean {
  const ecs = ecsOf(ctx.world);
  if (!ecs) return false;
  const targets = ids.filter((id) => ctx.world.get(id) !== undefined && !readFlags(ctx, id).locked);
  if (targets.length === 0) return false;
  const entities: Entity[] = [];
  for (const id of targets) {
    const entity = resolveEntity(ecs, id);
    if (entity !== undefined) entities.push(entity);
  }
  if (entities.length === 0) return false;
  return commitEcs(ctx, targets.length === 1 ? 'Delete' : 'Delete entities', undefined, (world) => {
    for (const entity of entities) {
      if (world.isAlive(entity)) world.destroy(entity);
    }
  });
}

export function writeComponentField(
  ctx: EditorContext,
  ids: readonly string[],
  type: string,
  key: string,
  value: unknown,
  lane: string | undefined,
  mergeKey: string,
): boolean {
  const ecs = ecsOf(ctx.world);
  if (!ecs) return writeBagField(ctx, ids, type, key, value, lane, mergeKey);
  const edits: { entity: Entity; path: string }[] = [];
  for (const id of ids) {
    const entity = ctx.world.get(id);
    const numeric = resolveEntity(ecs, id);
    if (!entity || numeric === undefined || readFlags(ctx, id).locked) continue;
    const current = entity.components[type];
    if (!isRecord(current)) continue;
    const path = lane === undefined ? key : `${key}.${lane}`;
    const currentValue = lane === undefined ? current[key] : laneValue(current[key], lane);
    if (sameValue(currentValue, value)) continue;
    edits.push({ entity: numeric, path });
  }
  if (edits.length === 0) return false;
  return commitEcs(ctx, `Edit ${key}`, mergeKey, (world) => {
    for (const edit of edits) world.setField(edit.entity, type, edit.path, value);
  });
}

export function writeLooseField(
  ctx: EditorContext,
  id: string,
  key: string,
  value: unknown,
  mergeKey: string,
): boolean {
  const entity = ctx.world.get(id);
  if (!entity || readFlags(ctx, id).locked || sameValue(entity.components[key], value)) return false;
  const ecs = ecsOf(ctx.world);
  const numeric = ecs ? resolveEntity(ecs, id) : undefined;
  if (!ecs || numeric === undefined) {
    const before = entity.components;
    const components = { ...entity.components, [key]: value };
    ctx.world.update(id, { components });
    ctx.undo.push({
      label: `Edit ${key}`,
      mergeKey,
      undo: () => ctx.world.update(id, { components: before }),
      redo: () => ctx.world.update(id, { components }),
    });
    return true;
  }
  return commitEcs(ctx, `Edit ${key}`, mergeKey, (world) => {
    world.set(numeric, key, value);
  });
}

export function addComponentType(ctx: EditorContext, ids: readonly string[], type: string): boolean {
  const schema = componentSchema(type);
  if (!schema) return false;
  const ecs = ecsOf(ctx.world);
  if (!ecs) return addBagComponent(ctx, ids, type, schema.defaults(), schema.title);
  const targets: Entity[] = [];
  for (const id of ids) {
    const entity = ctx.world.get(id);
    const numeric = resolveEntity(ecs, id);
    if (!entity || numeric === undefined || readFlags(ctx, id).locked || entity.components[type] !== undefined) continue;
    targets.push(numeric);
  }
  if (targets.length === 0) return false;
  const defaults = schema.defaults();
  return commitEcs(ctx, `Add ${schema.title}`, undefined, (world) => {
    for (const entity of targets) world.add(entity, type, defaults);
  });
}

export function removeComponentType(ctx: EditorContext, ids: readonly string[], type: string): boolean {
  const schema = componentSchema(type);
  const ecs = ecsOf(ctx.world);
  if (!ecs) return removeBagComponent(ctx, ids, type, schema?.title ?? type);
  const targets: Entity[] = [];
  for (const id of ids) {
    const entity = ctx.world.get(id);
    const numeric = resolveEntity(ecs, id);
    if (!entity || numeric === undefined || readFlags(ctx, id).locked || entity.components[type] === undefined) continue;
    targets.push(numeric);
  }
  if (targets.length === 0) return false;
  return commitEcs(ctx, `Remove ${schema?.title ?? type}`, undefined, (world) => {
    for (const entity of targets) world.remove(entity, type);
  });
}

export function looseKeys(components: Record<string, unknown>): string[] {
  return Object.keys(components).filter((key) => {
    if (componentSchema(key) || key === 'transform' || key === 'mesh') return false;
    const value = components[key];
    return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
  });
}

function laneValue(value: unknown, lane: string): unknown {
  if (Array.isArray(value)) {
    const labels = ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'];
    const index = labels.indexOf(lane);
    return index >= 0 ? value[index] : undefined;
  }
  if (!isRecord(value)) return undefined;
  return value[lane];
}

function writeBagField(
  ctx: EditorContext,
  ids: readonly string[],
  type: string,
  key: string,
  value: unknown,
  lane: string | undefined,
  mergeKey: string,
): boolean {
  const before = new Map<string, Record<string, unknown>>();
  const after = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const entity = ctx.world.get(id);
    if (!entity || readFlags(ctx, id).locked) continue;
    const current = entity.components[type];
    if (!isRecord(current)) continue;
    const nextValue = lane === undefined ? value : replaceLane(current[key], lane, value);
    if (sameValue(lane === undefined ? current[key] : laneValue(current[key], lane), value)) continue;
    before.set(id, entity.components);
    after.set(id, { ...entity.components, [type]: { ...current, [key]: nextValue } });
  }
  if (before.size === 0) return false;
  for (const [id, components] of after) ctx.world.update(id, { components });
  ctx.undo.push({
    label: `Edit ${key}`,
    mergeKey,
    undo() {
      for (const [id, components] of before) ctx.world.update(id, { components });
    },
    redo() {
      for (const [id, components] of after) ctx.world.update(id, { components });
    },
  });
  return true;
}

function replaceLane(current: unknown, lane: string, value: unknown): unknown {
  const labels = ['x', 'y', 'z', 'w'];
  const index = labels.indexOf(lane);
  if (Array.isArray(current) && index >= 0) {
    const next = [...current];
    while (next.length <= index) next.push(0);
    next[index] = value;
    return next;
  }
  if (isRecord(current)) return { ...current, [lane]: value };
  return current;
}

function addBagComponent(
  ctx: EditorContext,
  ids: readonly string[],
  type: string,
  defaults: Record<string, unknown>,
  title: string,
): boolean {
  const before = new Map<string, Record<string, unknown>>();
  const after = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const entity = ctx.world.get(id);
    if (!entity || readFlags(ctx, id).locked || entity.components[type] !== undefined) continue;
    before.set(id, entity.components);
    after.set(id, { ...entity.components, [type]: defaults });
  }
  if (before.size === 0) return false;
  for (const [id, components] of after) ctx.world.update(id, { components });
  ctx.undo.push({
    label: `Add ${title}`,
    undo() {
      for (const [id, components] of before) ctx.world.update(id, { components });
    },
    redo() {
      for (const [id, components] of after) ctx.world.update(id, { components });
    },
  });
  return true;
}

function removeBagComponent(ctx: EditorContext, ids: readonly string[], type: string, title: string): boolean {
  const before = new Map<string, Record<string, unknown>>();
  const after = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const entity = ctx.world.get(id);
    if (!entity || readFlags(ctx, id).locked || entity.components[type] === undefined) continue;
    const components = { ...entity.components };
    delete components[type];
    before.set(id, entity.components);
    after.set(id, components);
  }
  if (before.size === 0) return false;
  for (const [id, components] of after) ctx.world.update(id, { components });
  ctx.undo.push({
    label: `Remove ${title}`,
    undo() {
      for (const [id, components] of before) ctx.world.update(id, { components });
    },
    redo() {
      for (const [id, components] of after) ctx.world.update(id, { components });
    },
  });
  return true;
}
