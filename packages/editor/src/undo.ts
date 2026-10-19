/**
 * An already-applied editor edit.
 *
 * `push` does not call `redo`. The caller applies the change, then records the
 * command. `undo` / `redo` call the matching method.
 *
 * An uninterrupted run of commands that share a `mergeKey` collapses into one
 * history step. `undo` or `redo` breaks the run.
 * The default merge keeps the earlier `undo` (original baseline) and the later
 * `redo` (latest value). Provide `merge` to take over; return false to refuse.
 */
export interface UndoCommand {
  label: string;
  mergeKey?: string;
  merge?(previous: UndoCommand): boolean;
  undo(): void;
  redo(): void;
}

export type UndoEvent = 'push' | 'undo' | 'redo' | 'clear';

/**
 * Core world history the shared stack mirrors.
 * An `edit` change becomes one undo step. `undo` / `redo` on this object apply ECS transactions.
 */
export interface EcsUndoSource {
  undo(): boolean;
  redo(): boolean;
  clearHistory(): void;
  clearRedo(): void;
  onChange(listener: (change: { kind: string; label: string }) => void): () => void;
}

export interface UndoStack {
  push(command: UndoCommand): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Label of the command that `undo()` would revert, if any. */
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
  clear(): void;
  /** Depth of the undo stack. Play mode restores this depth on stop instead of clearing. */
  checkpoint(): number;
  /** Drop entries pushed after `depth` without running them. */
  revertTo(depth: number): void;
  subscribe(listener: (event: UndoEvent) => void): () => void;
}

type UndoEntry =
  | { kind: 'command'; command: UndoCommand }
  | { kind: 'ecs'; label: string };

function entryLabel(entry: UndoEntry): string {
  return entry.kind === 'ecs' ? entry.label : entry.command.label;
}

const HISTORY_LIMIT = 200;

function stitch(next: UndoCommand, previous: UndoCommand): void {
  const undo = previous.undo.bind(previous);
  const redo = next.redo.bind(next);
  next.undo = undo;
  next.redo = redo;
}

export function createUndoStack(ecs?: EcsUndoSource): UndoStack {
  const undoStack: UndoEntry[] = [];
  const redoStack: UndoEntry[] = [];
  const listeners = new Set<(event: UndoEvent) => void>();
  /** Merge only across an uninterrupted run of pushes. Undo or redo breaks the run. */
  let coalesce = false;
  /** True while this stack is applying a command or an ECS step, so echoed edits are ignored. */
  let applying = false;

  const emit = (event: UndoEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };

  const pushEcs = (label: string): void => {
    redoStack.length = 0;
    undoStack.push({ kind: 'ecs', label });
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    coalesce = false;
    emit('push');
  };

  const applyEntry = (entry: UndoEntry, direction: 'undo' | 'redo'): boolean => {
    applying = true;
    try {
      if (entry.kind === 'ecs') return direction === 'undo' ? ecs?.undo() ?? false : ecs?.redo() ?? false;
      if (direction === 'undo') entry.command.undo();
      else entry.command.redo();
      return true;
    } finally {
      applying = false;
    }
  };

  if (ecs) {
    ecs.onChange((change) => {
      if (applying || change.kind !== 'edit') return;
      pushEcs(change.label);
    });
  }

  return {
    push(command) {
      redoStack.length = 0;
      ecs?.clearRedo();
      const top = undoStack.at(-1);
      if (
        coalesce
        && top?.kind === 'command'
        && command.mergeKey !== undefined
        && command.mergeKey === top.command.mergeKey
      ) {
        const accepted = command.merge ? command.merge(top.command) : true;
        if (accepted) {
          if (!command.merge) stitch(command, top.command);
          undoStack[undoStack.length - 1] = { kind: 'command', command };
          coalesce = true;
          emit('push');
          return;
        }
      }
      undoStack.push({ kind: 'command', command });
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      coalesce = true;
      emit('push');
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      if (!applyEntry(entry, 'undo')) {
        undoStack.push(entry);
        return false;
      }
      redoStack.push(entry);
      coalesce = false;
      emit('undo');
      return true;
    },
    redo() {
      const entry = redoStack.pop();
      if (!entry) return false;
      if (!applyEntry(entry, 'redo')) {
        redoStack.push(entry);
        return false;
      }
      undoStack.push(entry);
      coalesce = false;
      emit('redo');
      return true;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => {
      const entry = undoStack.at(-1);
      return entry ? entryLabel(entry) : undefined;
    },
    redoLabel: () => {
      const entry = redoStack.at(-1);
      return entry ? entryLabel(entry) : undefined;
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      coalesce = false;
      applying = true;
      try {
        ecs?.clearHistory();
      } finally {
        applying = false;
      }
      emit('clear');
    },
    checkpoint: () => undoStack.length,
    revertTo(depth) {
      if (!Number.isInteger(depth) || depth < 0 || depth > undoStack.length) return;
      if (undoStack.length === depth) return;
      undoStack.length = depth;
      coalesce = false;
      emit('undo');
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
