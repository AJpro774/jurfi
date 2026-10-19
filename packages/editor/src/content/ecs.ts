import type { Entity, World } from '@jurfi/core';
import type { EditorContext } from '../context';
import type { EditorWorld, EntityRecord } from '../world';

interface EcsEditorWorld extends EditorWorld {
  ecs: World;
}

const mergeKeyOf = new WeakMap<EditorContext, string | null>();

export function ecsOf(world: EditorWorld): World | null {
  const candidate = world as Partial<EcsEditorWorld>;
  if (!candidate.ecs || typeof candidate.ecs.transaction !== 'function') return null;
  return candidate.ecs;
}

export function resolveEntity(ecs: World, id: string): Entity | undefined {
  return ecs.resolveAlias(id);
}

/** Run `fn` as one core transaction and mirror that step onto the editor undo stack. */
export function commitEcs(
  ctx: EditorContext,
  label: string,
  mergeKey: string | undefined,
  run: (ecs: World) => void,
): boolean {
  const ecs = ecsOf(ctx.world);
  if (!ecs) return false;
  const merging = mergeKey !== undefined && mergeKeyOf.get(ctx) === mergeKey;
  if (merging) ecs.undo();
  let recorded = false;
  const stop = ecs.onChange((change) => {
    if (change.kind === 'edit') recorded = true;
  });
  try {
    ecs.transaction(label, () => run(ecs));
  } catch (error) {
    stop();
    if (merging) ecs.redo();
    throw error;
  }
  stop();
  if (!recorded) {
    if (merging) ecs.redo();
    return false;
  }
  ctx.undo.push({
    label,
    mergeKey,
    undo() {
      mergeKeyOf.set(ctx, null);
      ecs.undo();
    },
    redo() {
      mergeKeyOf.set(ctx, null);
      ecs.redo();
    },
  });
  mergeKeyOf.set(ctx, mergeKey ?? null);
  return true;
}

/** Ordered siblings. Core child order when the world is an ECS, otherwise document order. */
export function siblingRecords(ctx: EditorContext, parentId: string | null): EntityRecord[] {
  const entities = ctx.world.entities();
  const ecs = ecsOf(ctx.world);
  if (!ecs) return entities.filter((entity) => entity.parentId === parentId);
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  let parent: Entity | null;
  if (parentId === null) parent = null;
  else {
    const resolved = ecs.resolveAlias(parentId);
    if (resolved === undefined) return [];
    parent = resolved;
  }
  const rows: EntityRecord[] = [];
  for (const child of ecs.childrenOf(parent)) {
    const id = ecs.alias(child);
    if (!id) continue;
    const record = byId.get(id);
    if (record) rows.push(record);
  }
  return rows;
}

/** Rerender when the ECS reports a committed component or parent edit, and when the document changes. */
export function watchWorld(ctx: EditorContext, onChange: () => void): () => void {
  const ecs = ecsOf(ctx.world);
  const stops = new Set<() => void>();
  const bind = (): void => {
    for (const stop of stops) stop();
    stops.clear();
    if (!ecs) return;
    for (const entity of ecs.entities()) stops.add(ecs.onChanged(entity, () => onChange()));
  };
  bind();
  const off = ctx.world.subscribe(() => {
    bind();
    onChange();
  });
  return () => {
    off();
    for (const stop of stops) stop();
  };
}

export function freshEntityId(ctx: EditorContext): string {
  let index = 1;
  while (ctx.world.get(`entity-${index}`)) index += 1;
  return `entity-${index}`;
}
