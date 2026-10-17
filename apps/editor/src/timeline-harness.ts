import '@jurfi/ui';
import '@jurfi/editor/shell.css';
import '@jurfi/editor/timeline.css';
import { createEditor, registerTimelinePanel, type Editor } from '@jurfi/editor';

registerTimelinePanel();

const root = document.querySelector('#app');
if (!(root instanceof HTMLElement)) throw new Error('Jurfi editor is missing #app');
const app: HTMLElement = root;

const editor: Editor = createEditor({
  root: app,
  layoutKey: 'jurfi.editor.timeline-harness',
  autosaveKey: 'jurfi.editor.timeline-harness.autosave',
});
editor.ctx.commands.execute('view.focus.timeline');

if (import.meta.hot) {
  import.meta.hot.dispose(() => editor.dispose());
}
