import '@jurfi/ui';
import '@jurfi/editor/shell.css';
import '@jurfi/editor/timeline.css';
import { createEditor, registerTimelinePanel, type Editor } from '@jurfi/editor';

registerTimelinePanel();

const root = document.querySelector('#app');
if (!(root instanceof HTMLElement)) throw new Error('Jurfi editor is missing #app');
const app: HTMLElement = root;

let active: Editor | undefined;

function boot(): void {
  active?.dispose();
  active = createEditor({ root: app });
}

boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => active?.dispose());
}
