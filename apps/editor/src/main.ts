import '@jurfi/ui';
import '@jurfi/editor/shell.css';
import '@jurfi/editor/timeline.css';
import { createEditor, registerNodeGraphPanel, registerTimelinePanel, registerViewportPanel, type Editor } from '@jurfi/editor';

const root = document.querySelector('#app');
if (!(root instanceof HTMLElement)) throw new Error('Jurfi editor is missing #app');
const app: HTMLElement = root;

registerViewportPanel();
registerNodeGraphPanel();
registerTimelinePanel();

let active: Editor | undefined;

function boot(): void {
  active?.dispose();
  active = createEditor({ root: app });
}

boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => active?.dispose());
}
