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
  subscribe(listener: (event: UndoEvent) => void): () => void;
}

const HISTORY_LIMIT = 200;

function stitch(next: UndoCommand, previous: UndoCommand): void {
  const undo = previous.undo.bind(previous);
  const redo = next.redo.bind(next);
  next.undo = undo;
  next.redo = redo;
}

export function createUndoStack(): UndoStack {
  const undoStack: UndoCommand[] = [];
  const redoStack: UndoCommand[] = [];
  const listeners = new Set<(event: UndoEvent) => void>();
  /** Merge only across an uninterrupted run of pushes. Undo or redo breaks the run. */
  let coalesce = false;

  const emit = (event: UndoEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };

  return {
    push(command) {
      redoStack.length = 0;
      const top = undoStack.at(-1);
      if (coalesce && top && command.mergeKey !== undefined && command.mergeKey === top.mergeKey) {
        const accepted = command.merge ? command.merge(top) : true;
        if (accepted) {
          if (!command.merge) stitch(command, top);
          undoStack[undoStack.length - 1] = command;
          coalesce = true;
          emit('push');
          return;
        }
      }
      undoStack.push(command);
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      coalesce = true;
      emit('push');
    },
    undo() {
      const command = undoStack.pop();
      if (!command) return false;
      command.undo();
      redoStack.push(command);
      coalesce = false;
      emit('undo');
      return true;
    },
    redo() {
      const command = redoStack.pop();
      if (!command) return false;
      command.redo();
      undoStack.push(command);
      coalesce = false;
      emit('redo');
      return true;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack.at(-1)?.label,
    redoLabel: () => redoStack.at(-1)?.label,
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      coalesce = false;
      emit('clear');
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
