import { createEditorWorld } from '@jurfi/core';
import { createEditorBus, type EditorBus, type GizmoMode, type PlayState } from './bus';
import { createCommandRegistry, type CommandRegistry } from './commands';
import { playbackClip, playbackGraph } from './playback';
import { createPlaySession } from './play-runtime';
import { createSelection, type Selection } from './selection';
import { createUndoStack, type UndoStack } from './undo';
import { createDefaultSnapshot, type EditorWorld, type WorldSnapshot } from './world';

/**
 * Handle passed to every panel `mount` and to editor commands.
 *
 * `commands` are named palette actions (`register` / `execute`).
 * `undo` is the reversible edit stack (`push` / `undo` / `redo`).
 */
export interface EditorContext {
  /** Scene world. The default is the core ECS (`createEditorWorld`); string ids are stable aliases. */
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

function createDefaultEditorWorld(): EditorWorld {
  const world = createEditorWorld();
  world.deserialize(createDefaultSnapshot());
  world.ecs.clearHistory();
  return world;
}

export function createEditorContext(options: EditorContextOptions = {}): EditorContext {
  const world = options.world ?? createDefaultEditorWorld();
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

  const playSession = createPlaySession({
    world,
    graph: playbackGraph,
    clip: playbackClip,
    onLog(entry) {
      bus.emit('log', entry);
      bus.emit('status', { message: entry.message, level: entry.level });
    },
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
      playSession.play();
      bus.emit('status', { message: 'Playing', level: 'info' });
    },
    pause() {
      if (playState !== 'playing') return;
      playSession.pause();
      setPlayState('paused');
      bus.emit('status', { message: 'Paused', level: 'info' });
    },
    stop() {
      if (playState === 'editing') return;
      playSession.stop();
      if (playSnapshot) world.deserialize(playSnapshot);
      playSnapshot = null;
      undo.clear();
      const keep = selection.get().filter((id) => world.get(id) !== undefined);
      if (keep.length !== selection.get().length) selection.set(keep);
      setPlayState('editing');
      bus.emit('status', { message: 'Stopped', level: 'info' });
    },
    step() {
      captureSnapshot();
      playSession.step();
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
