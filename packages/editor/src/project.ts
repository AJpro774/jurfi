import type { EditorContext } from './context';
import { parseLayout, type LayoutState } from './layout';
import { collectProjectSections } from './project-sections';
import { isWorldSnapshot, type EditorWorld, type WorldSnapshot } from './world';

export const PROJECT_FORMAT = 'jurfi-project' as const;
export const PROJECT_VERSION = 1 as const;
export const AUTOSAVE_STORAGE_KEY = 'jurfi.editor.autosave';

/** Asks the shell to autosave. Sections call this when their data changes outside the world. */
export interface EditorProject {
  markDirty(): void;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  world: WorldSnapshot;
  layout: LayoutState;
  /** Values returned by registered `ProjectSection` saves, keyed by section id. */
  sections: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function writeProject(world: EditorWorld, layout: LayoutState): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    world: world.serialize(),
    layout,
    sections: collectProjectSections(),
  };
  return JSON.stringify(file, null, 2);
}

export function readProject(json: string): ProjectFile | null {
  try {
    const value = JSON.parse(json) as unknown;
    if (!isRecord(value)) return null;
    if (value.format !== PROJECT_FORMAT || value.version !== PROJECT_VERSION) return null;
    if (!isWorldSnapshot(value.world)) return null;
    const layout = parseLayout(value.layout);
    if (!layout) return null;
    if (value.sections !== undefined && !isRecord(value.sections)) return null;
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      world: value.world,
      layout,
      sections: isRecord(value.sections) ? value.sections : {},
    };
  } catch {
    return null;
  }
}

export { applyProjectSections } from './project-sections';

/** Replace the scene document and drop undo history. Selection ids that disappeared are removed. */
export function applyWorldSnapshot(ctx: EditorContext, snapshot: WorldSnapshot): void {
  ctx.world.deserialize(snapshot);
  const keep = ctx.selection.get().filter((id) => ctx.world.get(id) !== undefined);
  if (keep.length !== ctx.selection.get().length) ctx.selection.set(keep);
  ctx.undo.clear();
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
