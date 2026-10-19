import type { EditorContext } from './context';

/**
 * TEMPORARY stand-in for the Editor Shell project-section hook.
 *
 * Shell will export this same signature and store each section under its id.
 * Delete this module when that lands, and point the import in `./index.ts` at
 * the shell implementation. Call sites already use the final signature.
 */
export interface ProjectSection {
  save(): unknown;
  load(data: unknown): void;
}

const sections = new Map<string, ProjectSection>();

/** Register JSON saved under `id` in the project file. Returns an unregister function. */
export function registerProjectSection(id: string, section: ProjectSection): () => void {
  sections.set(id, section);
  return () => {
    if (sections.get(id) === section) sections.delete(id);
  };
}

/** Snapshot registered sections. Used by the temporary project writer. */
export function collectProjectSections(): Record<string, unknown> {
  const saved: Record<string, unknown> = {};
  for (const [id, section] of sections) saved[id] = section.save();
  return saved;
}

/** Deliver a saved section map to the registered loaders. */
export function applyProjectSections(data: unknown): void {
  if (!isRecord(data)) return;
  for (const [id, value] of Object.entries(data)) sections.get(id)?.load(value);
}

const dirtyListeners = new WeakMap<EditorContext, Set<() => void>>();

export function bindProjectDirty(ctx: EditorContext, listeners: Set<() => void>): void {
  dirtyListeners.set(ctx, listeners);
}

export function subscribeProjectDirty(ctx: EditorContext, listener: () => void): () => void {
  const listeners = dirtyListeners.get(ctx);
  if (!listeners) return () => undefined;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
