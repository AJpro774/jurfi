import type { Entity, World, WorldChange } from '@jurfi/core';
import { cloneTransform, transformsClose } from '../math/vec';
import type { Transform } from '../math/vec';
import type { UndoCommand } from '../undo';
import { applyBaseline, hasTransform, readTransform, writeTransform, type DragBaseline } from './components';

/** Tracks the single ECS history step owned by the gizmo drag in progress. */
export interface DragSession {
  active: boolean;
}

/**
 * Keep the drag as one ECS transaction.
 * Each move undoes the previous preview, then writes every selected transform inside a new transaction.
 * `batch` publishes one flush, so the inspector sees the latest pose without a per-pixel undo step.
 */
export function previewTransformDrag(
  ecs: World,
  label: string,
  before: ReadonlyMap<Entity, DragBaseline>,
  after: ReadonlyMap<Entity, Transform>,
  session: DragSession,
): void {
  ecs.batch(() => {
    if (session.active) {
      ecs.undo();
      session.active = false;
    }
    let wrote = false;
    ecs.transaction(label, () => {
      for (const [entity, start] of before) {
        const next = after.get(entity);
        if (!next || !ecs.isAlive(entity)) continue;
        if (!start.present && transformsClose(start.transform, next)) continue;
        if (hasTransform(ecs, entity) && transformsClose(readTransform(ecs, entity), next)) continue;
        writeTransform(ecs, entity, next);
        wrote = true;
      }
    });
    session.active = wrote;
  });
}

export function cancelTransformDrag(ecs: World, session: DragSession): void {
  if (!session.active) return;
  ecs.undo();
  session.active = false;
}

/**
 * Hand the open transaction to the editor undo stack.
 * The step is already committed. Undo pops that step when it is still on top,
 * and otherwise writes the captured pose so a later edit cannot steal the pop.
 */
export function finishTransformDrag(
  ecs: World,
  label: string,
  before: ReadonlyMap<Entity, DragBaseline>,
  session: DragSession,
): UndoCommand | null {
  if (!session.active) return null;
  session.active = false;
  const start = copyPoses(before);
  const end = new Map<Entity, DragBaseline>();
  for (const entity of before.keys()) {
    if (!ecs.isAlive(entity)) continue;
    end.set(entity, { present: hasTransform(ecs, entity), transform: readTransform(ecs, entity) });
  }
  return {
    label,
    undo() {
      stepOrApply(ecs, label, 'undo', start);
    },
    redo() {
      stepOrApply(ecs, label, 'redo', end);
    },
  };
}

function copyPoses(source: ReadonlyMap<Entity, DragBaseline>): Map<Entity, DragBaseline> {
  const copy = new Map<Entity, DragBaseline>();
  for (const [entity, pose] of source) {
    copy.set(entity, { present: pose.present, transform: cloneTransform(pose.transform) });
  }
  return copy;
}

function stepOrApply(
  ecs: World,
  label: string,
  kind: 'undo' | 'redo',
  fallback: ReadonlyMap<Entity, DragBaseline>,
): void {
  let matched = false;
  const off = ecs.onChange((change: WorldChange) => {
    if (change.kind === kind && change.label === label) matched = true;
  });
  const moved = kind === 'undo' ? ecs.undo() : ecs.redo();
  off();
  if (moved && matched) return;
  if (moved) {
    if (kind === 'undo') ecs.redo();
    else ecs.undo();
  }
  ecs.transaction(label, () => {
    for (const [entity, pose] of fallback) applyBaseline(ecs, entity, pose);
  });
}
