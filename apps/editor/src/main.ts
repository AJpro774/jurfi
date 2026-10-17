import '@jurfi/ui';
import '@jurfi/editor/shell.css';
import { createEditor, type Editor } from '@jurfi/editor';

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
