// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor } from './shell';
import { memoryStore } from './storage';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
});

describe('console panel', () => {
  it('shows logs, filters them, and clears them', () => {
    const root = document.createElement('div');
    document.body.append(root);
    cleanups.push(() => root.remove());
    const editor = createEditor({ root, storage: memoryStore(), restoreAutosave: false });
    cleanups.push(() => editor.dispose());
    editor.ctx.bus.emit('log', { level: 'error', message: 'boom', source: 'script' });
    editor.ctx.bus.emit('log', { level: 'warn', message: 'careful', source: 'physics' });
    editor.ctx.bus.emit('status', { level: 'info', message: 'Saved' });
    const log = root.querySelector('[aria-label="Console output"]');
    expect(log?.textContent).toContain('script: boom');
    expect(log?.textContent).toContain('careful');
    expect(log?.textContent).toContain('Saved');
    const filter = root.querySelector<HTMLInputElement>('[aria-label="Filter console"]');
    if (!filter) throw new Error('missing filter');
    filter.value = 'boom';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(log?.textContent).toContain('boom');
    expect(log?.textContent).not.toContain('careful');
    root.querySelector<HTMLButtonElement>('[aria-label="Clear console"]')?.click();
    expect(log?.textContent).toContain('No messages.');
  });
});
