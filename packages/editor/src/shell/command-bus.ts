/**
 * FLAG: Editor Shell engineer fc90dcbf has not published the undo/command
 * bus on main (checked this branch against main). This is a thin adapter.
 *
 * `execute` must call `command.do()` synchronously. When the shell bus
 * lands, pass it as `NodeGraphOptions.commandBus` or
 * `EditorContext.commandBus` — the `Command` / `CommandBus` shapes are the
 * contract the graph already codes against.
 */

export interface Command {
  label: string;
  do(): void;
  undo(): void;
}

export interface CommandBus {
  execute(command: Command): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  subscribe?(listener: () => void): () => void;
}

export function createLocalCommandBus(): CommandBus {
  const undoStack: Command[] = [];
  const redoStack: Command[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    execute(command) {
      command.do();
      undoStack.push(command);
      redoStack.length = 0;
      emit();
    },
    undo() {
      const command = undoStack.pop();
      if (!command) return;
      command.undo();
      redoStack.push(command);
      emit();
    },
    redo() {
      const command = redoStack.pop();
      if (!command) return;
      command.do();
      undoStack.push(command);
      emit();
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function resolveCommandBus(options: {
  commandBus?: CommandBus;
  editorContext?: { commandBus?: CommandBus };
}): CommandBus {
  return options.commandBus ?? options.editorContext?.commandBus ?? createLocalCommandBus();
}
