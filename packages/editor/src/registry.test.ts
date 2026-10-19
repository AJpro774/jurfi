import { afterEach, describe, expect, it } from 'vitest';
import { createEditorContext, getPanel, listPanels, registerPanel } from './index';

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('panel registry', () => {
  it('registers a panel and lists it', () => {
    disposers.push(registerPanel({ id: 'hierarchy', title: 'Hierarchy', mount() {} }));
    expect(listPanels().map((panel) => panel.id)).toEqual(['hierarchy']);
    expect(getPanel('hierarchy')?.title).toBe('Hierarchy');
  });

  it('replaces a panel with the same id and keeps a single entry', () => {
    const removeFirst = registerPanel({ id: 'viewport', title: 'Old', mount() {} });
    disposers.push(registerPanel({ id: 'inspector', title: 'Inspector', mount() {} }));
    disposers.push(registerPanel({ id: 'viewport', title: 'Viewport', mount() {} }));
    removeFirst();
    expect(getPanel('viewport')?.title).toBe('Viewport');
    expect(listPanels().map((panel) => panel.id)).toEqual(['viewport', 'inspector']);
  });

  it('removes a panel only when the current definition unregisters', () => {
    const remove = registerPanel({ id: 'console', title: 'Console', mount() {} });
    remove();
    expect(getPanel('console')).toBeUndefined();
  });

  it('calls mount with the host element and context and returns its dispose function', () => {
    const ctx = createEditorContext();
    let seen = false;
    let disposed = false;
    disposers.push(registerPanel({
      id: 'timeline',
      title: 'Timeline',
      mount(el, mountedCtx) {
        seen = el.dataset.host === 'zone' && mountedCtx === ctx;
        return () => {
          disposed = true;
        };
      },
    }));
    const host = { dataset: { host: 'zone' } } as unknown as HTMLElement;
    const dispose = getPanel('timeline')?.mount(host, ctx);
    expect(seen).toBe(true);
    expect(typeof dispose).toBe('function');
    if (typeof dispose === 'function') dispose();
    expect(disposed).toBe(true);
    expect(ctx.world.get('player')?.name).toBe('Player');
    expect(typeof ctx.selection.set).toBe('function');
    expect(typeof ctx.undo.push).toBe('function');
    expect(typeof ctx.commands.execute).toBe('function');
    expect(typeof ctx.bus.emit).toBe('function');
  });

  it('rejects an empty panel id', () => {
    expect(() => registerPanel({ id: ' ', title: 'Nope', mount() {} })).toThrow(/id/);
  });
});
