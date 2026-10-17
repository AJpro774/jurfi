import { createEditorBus, type EditorBus, type GizmoMode, type PlayState } from './bus';
import { createCommandRegistry, type CommandRegistry } from './commands';
import { createSelection, type Selection } from './selection';
import { createUndoStack, type UndoStack } from './undo';
import { createWorld, type EditorWorld, type WorldSnapshot } from './world';

/**
 * Handle passed to every panel `mount` and to editor commands.
 *
 * `commands` are named palette actions (`register` / `execute`).
 * `undo` is the reversible edit stack (`push` / `undo` / `redo`).
 */
export interface EditorContext {
  /** Serializable scene document. `@jurfi/core` does not export an ECS world yet; this is the document panels read and write. */
  readonly world: EditorWorld;
  readonly selection: Selection;
  readonly undo: UndoStack;
  readonly commands: CommandRegistry;
  readonly bus: EditorBus;
  getPlayState(): PlayState;
  /** Snapshot the world on the way in from editing. Further calls while paused resume without a new snapshot. */
  play(): void;
  pause(): void;
  /** Restore the snapshot taken when play began and return to editing. */
  stop(): void;
  /** Enter paused play (snapshotting if needed) and emit `play:step`. No runtime is ticked yet. */
  step(): void;
  getGizmoMode(): GizmoMode;
  setGizmoMode(mode: GizmoMode): void;
}

export interface EditorContextOptions {
  world?: EditorWorld;
}

export function createEditorContext(options: EditorContextOptions = {}): EditorContext {
  const world = options.world ?? createWorld();
  const bus = createEditorBus();
  const selection = createSelection();
  const undo = createUndoStack();
  const registry = createCommandRegistry();
  let playState: PlayState = 'editing';
  let gizmo: GizmoMode = 'translate';
  let playSnapshot: WorldSnapshot | null = null;

  selection.subscribe((ids) => {
    bus.emit('selection:changed', { ids });
  });
  world.subscribe(() => {
    bus.emit('world:changed', { snapshot: world.serialize() });
  });

  const commands: CommandRegistry = {
    register: (command) => registry.register(command),
    get: (id) => registry.get(id),
    list: () => registry.list(),
    subscribe: (listener) => registry.subscribe(listener),
    execute(id) {
      const ok = registry.execute(id);
      if (ok) bus.emit('command:executed', { id });
      return ok;
    },
  };

  const setPlayState = (state: PlayState): void => {
    if (playState === state) return;
    playState = state;
    bus.emit('play:changed', { state });
  };

  const captureSnapshot = (): void => {
    if (playState === 'editing') playSnapshot = world.serialize();
  };

  return {
    world,
    selection,
    undo,
    commands,
    bus,
    getPlayState: () => playState,
    play() {
      captureSnapshot();
      if (playState === 'playing') return;
      setPlayState('playing');
      bus.emit('status', { message: 'Playing', level: 'info' });
    },
    pause() {
      if (playState !== 'playing') return;
      setPlayState('paused');
      bus.emit('status', { message: 'Paused', level: 'info' });
    },
    stop() {
      if (playState === 'editing') return;
      if (playSnapshot) world.deserialize(playSnapshot);
      playSnapshot = null;
      undo.clear();
      setPlayState('editing');
      bus.emit('status', { message: 'Stopped', level: 'info' });
    },
    step() {
      captureSnapshot();
      if (playState === 'playing') setPlayState('paused');
      else if (playState === 'editing') setPlayState('paused');
      bus.emit('play:step', { state: playState });
      bus.emit('status', { message: 'Stepped', level: 'info' });
    },
    getGizmoMode: () => gizmo,
    setGizmoMode(mode) {
      if (gizmo === mode) return;
      gizmo = mode;
      bus.emit('gizmo:changed', { mode });
    },
  };
}
