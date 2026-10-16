import '@jurfi/ui';
import { editorTitle } from '@jurfi/editor';

document.querySelector('#app')!.innerHTML = `<div class="jurfi-panel">${editorTitle()}</div>`;
