import type { EditorContext } from '../context';
import { registerProjectSection } from '../project-sections';
import { exportLibrary, importLibrary } from './assets';
import { exportFlags, importFlags } from './flags';

/**
 * Points the temporary project-section shim at the editor that is loading or saving.
 * `registerContentPanels` callers do not need to invoke this; the shell does,
 * before it reads autosave.
 */
let current: EditorContext | null = null;

registerProjectSection('hierarchy.flags', {
  save: () => (current ? exportFlags(current) : {}),
  load: (data) => {
    if (current) importFlags(current, data);
  },
});

registerProjectSection('assets.library', {
  save: () => (current ? exportLibrary(current) : { folders: [], assets: [] }),
  load: (data) => {
    if (current) importLibrary(current, data);
  },
});

export function bindProjectSections(ctx: EditorContext): void {
  current = ctx;
}
