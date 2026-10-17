/** A palette / menu action. Distinct from an {@link UndoCommand}. */
export interface EditorCommand {
  id: string;
  title: string;
  /** Canonical chord such as `Mod+K` or `Mod+Shift+Z`. `Mod` is Ctrl on Windows/Linux and Cmd on Apple platforms. */
  shortcut?: string;
  group?: string;
  /** When this returns false the command stays listed but `execute` refuses it. */
  when?: () => boolean;
  run(): void;
}

export interface CommandRegistry {
  register(command: EditorCommand): () => void;
  execute(id: string): boolean;
  get(id: string): EditorCommand | undefined;
  list(): readonly EditorCommand[];
  subscribe(listener: () => void): () => void;
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, EditorCommand>();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    register(command) {
      if (command.id.trim() === '') throw new Error('Command id must be a non-empty string');
      commands.set(command.id, command);
      emit();
      return () => {
        if (commands.get(command.id) !== command) return;
        commands.delete(command.id);
        emit();
      };
    },
    execute(id) {
      const command = commands.get(id);
      if (!command) return false;
      if (command.when && !command.when()) return false;
      command.run();
      return true;
    },
    get: (id) => commands.get(id),
    list: () => [...commands.values()],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
