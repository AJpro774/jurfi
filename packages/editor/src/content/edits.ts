import type { EditorContext } from '../context';
import type { EntityRecord, WorldSnapshot } from '../world';
import { componentSchema } from './components';
import { FLAGS_KEY, isRecord, readFlags } from './flags';

export interface Placement {
  parentId: string | null;
  /** Insert before this entity. Null appends after the last sibling. */
  beforeId: string | null;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function descendantIds(root: string, entities: readonly EntityRecord[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const entity of entities) {
    if (entity.parentId === null) continue;
    const list = children.get(entity.parentId) ?? [];
    list.push(entity.id);
    children.set(entity.parentId, list);
  }
  const found = new Set<string>();
  const walk = (id: string): void => {
    for (const child of children.get(id) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

function sameStructure(before: readonly EntityRecord[], after: readonly EntityRecord[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((entity, index) => {
    const next = after[index];
    return next !== undefined && entity.id === next.id && entity.parentId === next.parentId;
  });
}

export function renameEntity(ctx: EditorContext, id: string, name: string): boolean {
  const entity = ctx.world.get(id);
  if (!entity || readFlags(entity.components).locked || entity.name === name) return false;
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

export function setFlag(ctx: EditorContext, id: string, key: 'visible' | 'locked', value: boolean): boolean {
  const entity = ctx.world.get(id);
  if (!entity) return false;
  const flags = readFlags(entity.components);
  if (flags[key] === value) return false;
  const before = entity.components;
  const components = { ...entity.components, [FLAGS_KEY]: { ...flags, [key]: value } };
  ctx.world.update(id, { components });
  ctx.undo.push({
    label: key === 'visible' ? 'Toggle visibility' : 'Toggle lock',
    undo: () => ctx.world.update(id, { components: before }),
    redo: () => ctx.world.update(id, { components }),
  });
  return true;
}

export function moveEntity(ctx: EditorContext, id: string, placement: Placement): boolean {
  const snapshot: WorldSnapshot = ctx.world.serialize();
  const entities = snapshot.entities.map((entity) => ({ ...entity, components: { ...entity.components } }));
  const index = entities.findIndex((entity) => entity.id === id);
  const moving = entities[index];
  if (!moving || readFlags(moving.components).locked) return false;
  if (placement.parentId === id || placement.beforeId === id) return false;
  if (placement.parentId !== null && descendantIds(id, entities).has(placement.parentId)) return false;
  if (placement.parentId !== null) {
    const parent = entities.find((entity) => entity.id === placement.parentId);
    if (!parent || readFlags(parent.components).locked) return false;
  }

  entities.splice(index, 1);
  moving.parentId = placement.parentId;

  let insertAt = entities.length;
  if (placement.beforeId !== null) {
    const before = entities.findIndex((entity) => entity.id === placement.beforeId);
    if (before >= 0) insertAt = before;
  } else {
    let lastSibling = -1;
    for (let cursor = 0; cursor < entities.length; cursor += 1) {
      if (entities[cursor]?.parentId === placement.parentId) lastSibling = cursor;
    }
    insertAt = lastSibling === -1 ? entities.length : lastSibling + 1;
  }
  entities.splice(insertAt, 0, moving);
  if (sameStructure(snapshot.entities, entities)) return false;

  const next: WorldSnapshot = { entities };
  ctx.world.deserialize(next);
  const after = ctx.world.serialize();
  ctx.undo.push({
    label: 'Move entity',
    undo: () => ctx.world.deserialize(snapshot),
    redo: () => ctx.world.deserialize(after),
  });
  return true;
}

function replaceAxis(current: unknown, axis: number, value: unknown): unknown[] {
  const next = Array.isArray(current) ? [...current] : [];
  while (next.length <= axis) next.push(0);
  next[axis] = value;
  return next;
}

export function writeComponentField(
  ctx: EditorContext,
  ids: readonly string[],
  type: string,
  key: string,
  value: unknown,
  axis: number | undefined,
  mergeKey: string,
): boolean {
  const before = new Map<string, Record<string, unknown>>();
  const after = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const entity = ctx.world.get(id);
    if (!entity || readFlags(entity.components).locked) continue;
    const current = entity.components[type];
    if (!isRecord(current)) continue;
    const nextValue = axis === undefined ? value : replaceAxis(current[key], axis, value);
    if (sameValue(current[key], nextValue)) continue;
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

export function writeLooseField(
  ctx: EditorContext,
  id: string,
  key: string,
  value: unknown,
  mergeKey: string,
): boolean {
  const entity = ctx.world.get(id);
  if (!entity || readFlags(entity.components).locked || sameValue(entity.components[key], value)) return false;
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

export function addComponentType(ctx: EditorContext, ids: readonly string[], type: string): boolean {
  const schema = componentSchema(type);
  if (!schema) return false;
  const before = new Map<string, Record<string, unknown>>();
  const after = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const entity = ctx.world.get(id);
    if (!entity || readFlags(entity.components).locked || entity.components[type] !== undefined) continue;
    before.set(id, entity.components);
    after.set(id, { ...entity.components, [type]: schema.defaults() });
  }
  if (before.size === 0) return false;
  for (const [id, components] of after) ctx.world.update(id, { components });
  ctx.undo.push({
    label: `Add ${schema.title}`,
    undo() {
      for (const [id, components] of before) ctx.world.update(id, { components });
    },
    redo() {
      for (const [id, components] of after) ctx.world.update(id, { components });
    },
  });
  return true;
}

export function removeComponentType(ctx: EditorContext, ids: readonly string[], type: string): boolean {
  const schema = componentSchema(type);
  const before = new Map<string, Record<string, unknown>>();
  const after = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const entity = ctx.world.get(id);
    if (!entity || readFlags(entity.components).locked || entity.components[type] === undefined) continue;
    const components = { ...entity.components };
    delete components[type];
    before.set(id, entity.components);
    after.set(id, components);
  }
  if (before.size === 0) return false;
  for (const [id, components] of after) ctx.world.update(id, { components });
  ctx.undo.push({
    label: `Remove ${schema?.title ?? type}`,
    undo() {
      for (const [id, components] of before) ctx.world.update(id, { components });
    },
    redo() {
      for (const [id, components] of after) ctx.world.update(id, { components });
    },
  });
  return true;
}

export function looseKeys(components: Record<string, unknown>): string[] {
  return Object.keys(components).filter((key) => {
    if (key === FLAGS_KEY || componentSchema(key)) return false;
    const value = components[key];
    return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
  });
}
