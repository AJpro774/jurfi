import type { LayoutState } from './layout';
import type { WorldSnapshot } from './world';

export type PlayState = 'editing' | 'playing' | 'paused';
export type GizmoMode = 'translate' | 'rotate' | 'scale';

/** Events the shell and the built-in commands emit. Panel owners may emit their own string names. */
export interface EditorEventMap {
  'selection:changed': { ids: readonly string[] };
  'world:changed': { snapshot: WorldSnapshot };
  'play:changed': { state: PlayState };
  'play:step': { state: PlayState };
  'gizmo:changed': { mode: GizmoMode };
  'layout:changed': { layout: LayoutState };
  'layout:reset': { layout: LayoutState };
  'project:saved': { name: string };
  'project:loaded': { name: string };
  'status': { message: string; level: 'info' | 'warn' | 'error' };
  /** Runtime logs. Play mode emits script errors here. The console panel renders them. */
  'log': { level: 'info' | 'warn' | 'error'; message: string; source?: string };
  'command:executed': { id: string };
}

type Listener = (payload: unknown) => void;

export interface EditorBus {
  on<K extends keyof EditorEventMap>(type: K, listener: (payload: EditorEventMap[K]) => void): () => void;
  on(type: string, listener: (payload: unknown) => void): () => void;
  emit<K extends keyof EditorEventMap>(type: K, payload: EditorEventMap[K]): void;
  emit(type: string, payload?: unknown): void;
}

export function createEditorBus(): EditorBus {
  const listeners = new Map<string, Set<Listener>>();

  return {
    on(type: string, listener: Listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(type);
      };
    },
    emit(type: string, payload?: unknown) {
      const set = listeners.get(type);
      if (!set) return;
      for (const listener of [...set]) listener(payload);
    },
  };
}
