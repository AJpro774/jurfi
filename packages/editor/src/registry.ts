import type { EditorContext } from './context';

/**
 * A dockable editor view.
 *
 * Registering the same `id` again replaces the previous definition so a panel
 * owner can take over a placeholder (or an older build of the same panel).
 * `mount` may return a dispose function; the shell calls it before unmounting.
 */
export interface PanelDefinition {
  id: string;
  title: string;
  mount(el: HTMLElement, ctx: EditorContext): void | (() => void);
}

export type PanelChange = 'register' | 'remove';

type PanelListener = (id: string, change: PanelChange) => void;

const panels = new Map<string, PanelDefinition>();
const listeners = new Set<PanelListener>();

function emit(id: string, change: PanelChange): void {
  for (const listener of [...listeners]) listener(id, change);
}

/** Register a panel. The returned function removes it if it is still current. */
export function registerPanel(definition: PanelDefinition): () => void {
  if (definition.id.trim() === '') throw new Error('Panel id must be a non-empty string');
  if (definition.title.trim() === '') throw new Error(`Panel "${definition.id}" is missing a title`);
  panels.set(definition.id, definition);
  emit(definition.id, 'register');
  return () => {
    if (panels.get(definition.id) !== definition) return;
    panels.delete(definition.id);
    emit(definition.id, 'remove');
  };
}

export function getPanel(id: string): PanelDefinition | undefined {
  return panels.get(id);
}

export function listPanels(): readonly PanelDefinition[] {
  return [...panels.values()];
}

/** Fires when a panel is registered, replaced, or removed. */
export function subscribePanels(listener: PanelListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
