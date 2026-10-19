import { cloneTransform, transformsClose } from '../math/vec';
import type { Transform } from '../math/vec';
import type { UndoCommand } from '../undo';
import type { EditorWorld } from '../world';
import { writeTransform } from './components';

function copyMap(map: ReadonlyMap<string, Transform>): Map<string, Transform> {
  const next = new Map<string, Transform>();
  for (const [id, transform] of map) next.set(id, cloneTransform(transform));
  return next;
}

/**
 * One undo step for a finished gizmo drag.
 * The edit is already applied. `push` must not redo it.
 * Returns null when nothing moved.
 */
export function transformUndo(
  world: EditorWorld,
  before: ReadonlyMap<string, Transform>,
  after: ReadonlyMap<string, Transform>,
  label = 'Transform',
  absent: ReadonlySet<string> = new Set(),
): UndoCommand | null {
  let changed = false;
  for (const [id, next] of after) {
    const prev = before.get(id);
    if (!prev || !transformsClose(prev, next)) {
      changed = true;
      break;
    }
  }
  if (!changed) return null;

  const beforeCopy = copyMap(before);
  const afterCopy = copyMap(after);
  const missing = new Set(absent);
  const apply = (map: ReadonlyMap<string, Transform>): void => {
    for (const [id, transform] of map) writeTransform(world, id, transform);
  };
  return {
    label,
    undo() {
      for (const [id, transform] of beforeCopy) writeTransform(world, id, missing.has(id) ? null : transform);
    },
    redo() {
      apply(afterCopy);
    },
  };
}
