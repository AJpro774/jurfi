import '@jurfi/ui';
import '@jurfi/editor/shell.css';
import '@jurfi/editor/panels.css';
import { createEditorWorld } from '@jurfi/core';
import {
  createDemoSnapshot,
  createEditor,
  registerContentPanels,
  registerNodeGraphPanel,
  registerViewportPanel,
  seedDemoLibrary,
  type Editor,
} from '@jurfi/editor';

const root = document.querySelector('#app');
if (!(root instanceof HTMLElement)) throw new Error('Jurfi editor is missing #app');
const app: HTMLElement = root;

registerViewportPanel();
registerNodeGraphPanel();
registerContentPanels();

let active: Editor | undefined;

function boot(): void {
  active?.dispose();
  const world = createEditorWorld();
  world.deserialize(createDemoSnapshot());
  active = createEditor({ root: app, world });
  seedDemoLibrary(active.ctx);
  if (active.ctx.selection.get().length === 0 && active.ctx.world.get('player')) {
    active.ctx.selection.set(['player']);
  }
}

boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => active?.dispose());
}
