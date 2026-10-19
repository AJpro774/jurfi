// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../shell';
import { memoryStore } from '../storage';
import { STANDARD_PANELS } from '../layout';
import { ensurePlaceholderPanels } from '../panels';
import { getPanel, registerPanel } from '../registry';
import { createEditorContext, type EditorContext } from '../context';
import { createWorld } from '../world';
import { mountAssetBrowser } from './asset-browser';
import { createDemoSnapshot } from './demo';
import { setFlag } from './edits';
import { readFlags } from './flags';
import { mountHierarchy } from './hierarchy';
import { mountInspector } from './inspector';
import { registerContentPanels } from './register';

const cleanups: (() => void)[] = [];
let panels: (() => void) | undefined;
let editor: Editor | undefined;

afterEach(() => {
  editor?.dispose();
  editor = undefined;
  for (const cleanup of cleanups.splice(0)) cleanup();
  panels?.();
  panels = undefined;
  for (const id of STANDARD_PANELS) {
    if (getPanel(id)) registerPanel({ id, title: 'Temp', mount() {} })();
  }
});

function demoContext(): EditorContext {
  return createEditorContext({ world: createWorld(createDemoSnapshot()) });
}

function mount(render: (el: HTMLElement, ctx: EditorContext) => () => void, ctx = demoContext()): { host: HTMLElement; ctx: EditorContext } {
  const host = document.createElement('div');
  document.body.append(host);
  const unmount = render(host, ctx);
  cleanups.push(() => {
    unmount();
    host.remove();
  });
  return { host, ctx };
}

function dragEvent(type: string, transfer: DataTransfer): Event {
  const event = typeof DragEvent === 'function'
    ? new DragEvent(type, { bubbles: true, cancelable: true })
    : new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { configurable: true, value: transfer });
  return event;
}

function transferWith(files: File[] = []): DataTransfer {
  const transfer = new DataTransfer();
  for (const file of files) {
    try {
      transfer.items.add(file);
    } catch {
      // Some DOM shims reject DataTransferItemList.add.
    }
  }
  if (files.length > 0 && transfer.files.length === 0) {
    Object.defineProperty(transfer, 'files', { configurable: true, value: files });
  }
  const types = new Set([...transfer.types, ...files.map((file) => file.type)]);
  if (files.length > 0) types.add('Files');
  Object.defineProperty(transfer, 'types', { configurable: true, value: [...types] });
  return transfer;
}

function dropFiles(target: HTMLElement, files: File[]): void {
  const transfer = transferWith(files);
  target.dispatchEvent(dragEvent('dragover', transfer));
  target.dispatchEvent(dragEvent('drop', transfer));
}

function componentBag(ctx: EditorContext, id: string, type: string): Record<string, unknown> {
  const value = ctx.world.get(id)?.components[type];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

describe('content panels', () => {
  it('replaces the hierarchy, inspector, and asset placeholders', () => {
    panels = registerContentPanels();
    ensurePlaceholderPanels();
    const ctx = demoContext();
    const hierarchy = document.createElement('div');
    const viewport = document.createElement('div');
    getPanel('hierarchy')?.mount(hierarchy, ctx);
    getPanel('viewport')?.mount(viewport, ctx);
    expect(hierarchy.querySelector('[aria-label="Filter hierarchy"]')).not.toBeNull();
    expect(hierarchy.querySelector('.je-placeholder-flag')).toBeNull();
    expect(viewport.dataset.placeholder).toBe('viewport');
    expect(getPanel('inspector')?.title).toBe('Inspector');
    expect(getPanel('assets')?.title).toBe('Asset Browser');
  });

  it('mounts the three panels in the editor shell', () => {
    panels = registerContentPanels();
    const root = document.createElement('div');
    document.body.append(root);
    cleanups.push(() => root.remove());
    editor = createEditor({
      root,
      world: createWorld(createDemoSnapshot()),
      storage: memoryStore(),
      restoreAutosave: false,
    });
    editor.ctx.selection.set(['player']);
    expect(root.querySelector('[data-placeholder="hierarchy"]')).toBeNull();
    expect(root.querySelector('[data-placeholder="inspector"]')).toBeNull();
    expect(root.querySelector('[data-placeholder="assets"]')).toBeNull();
    expect(root.querySelector('[data-placeholder="viewport"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Filter hierarchy"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Search assets"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Position X"]')).not.toBeNull();
  });

  it('filters the hierarchy and keeps ancestors', () => {
    const { host } = mount(mountHierarchy);
    const search = host.querySelector<HTMLInputElement>('[aria-label="Filter hierarchy"]');
    if (!search) throw new Error('missing filter');
    search.value = 'weapon';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const ids = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => row.dataset.id);
    expect(ids).toEqual(['scene', 'player', 'weapon']);
  });

  it('renames from the keyboard and undoes the edit', () => {
    const { host, ctx } = mount(mountHierarchy);
    host.querySelector<HTMLElement>('[data-id="player"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    host.querySelector<HTMLElement>('[data-id="player"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    const input = host.querySelector<HTMLInputElement>('[aria-label="Rename Player"]');
    if (!input) throw new Error('missing rename field');
    input.value = 'Hero';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ctx.world.get('player')?.name).toBe('Hero');
    ctx.undo.undo();
    expect(ctx.world.get('player')?.name).toBe('Player');
  });

  it('toggles visibility through the undo stack', () => {
    const { host, ctx } = mount(mountHierarchy);
    host.querySelector<HTMLButtonElement>('[aria-label="Hide Player"]')?.click();
    expect(readFlags(ctx.world.get('player')?.components ?? {}).visible).toBe(false);
    ctx.undo.undo();
    expect(readFlags(ctx.world.get('player')?.components ?? {}).visible).toBe(true);
  });

  it('reorders a sibling with Alt+ArrowDown', () => {
    const { host, ctx } = mount(mountHierarchy);
    host.querySelector<HTMLElement>('[data-id="camera"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    host.querySelector<HTMLElement>('[data-id="camera"]')?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
    }));
    const children = ctx.world.entities().filter((entity) => entity.parentId === 'scene').map((entity) => entity.id);
    expect(children).toEqual(['light', 'camera', 'player', 'ground']);
  });

  it('reparents by dropping and refuses a cycle', () => {
    const { host, ctx } = mount(mountHierarchy);
    const player = host.querySelector<HTMLElement>('[data-id="player"]');
    const weapon = host.querySelector<HTMLElement>('[data-id="weapon"]');
    if (!player || !weapon) throw new Error('missing rows');
    const cycle = transferWith();
    player.dispatchEvent(dragEvent('dragstart', cycle));
    weapon.dispatchEvent(dragEvent('drop', cycle));
    expect(ctx.world.get('player')?.parentId).toBe('scene');

    const moved = transferWith();
    const weaponRow = host.querySelector<HTMLElement>('[data-id="weapon"]');
    const ground = host.querySelector<HTMLElement>('[data-id="ground"]');
    if (!weaponRow || !ground) throw new Error('missing drop rows');
    weaponRow.dispatchEvent(dragEvent('dragstart', moved));
    ground.dispatchEvent(dragEvent('drop', moved));
    expect(ctx.world.get('weapon')?.parentId).toBe('ground');
  });

  it('edits a component field, rejects invalid numbers, and coalesces undo', () => {
    const ctx = demoContext();
    ctx.selection.set(['light']);
    const { host } = mount(mountInspector, ctx);
    const input = host.querySelector<HTMLInputElement>('[aria-label="Intensity"]');
    if (!input) throw new Error('missing intensity field');
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(componentBag(ctx, 'light', 'Light').intensity).toBe(2);

    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '6';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(componentBag(ctx, 'light', 'Light').intensity).toBe(6);
    ctx.undo.undo();
    expect(componentBag(ctx, 'light', 'Light').intensity).toBe(2);
    expect(ctx.undo.canUndo()).toBe(false);
    ctx.undo.redo();
    expect(componentBag(ctx, 'light', 'Light').intensity).toBe(6);
  });

  it('applies one axis to a mixed multi-selection', () => {
    const ctx = demoContext();
    ctx.selection.set(['player', 'light']);
    const { host } = mount(mountInspector, ctx);
    const input = host.querySelector<HTMLInputElement>('[aria-label="Position X"]');
    if (!input) throw new Error('missing position field');
    expect(input.placeholder).toBe('Mixed');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    input.value = '5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(componentBag(ctx, 'player', 'Transform').position).toEqual([5, 3, 0]);
    expect(componentBag(ctx, 'light', 'Transform').position).toEqual([5, 4, 1]);
    expect(componentBag(ctx, 'player', 'transform').position).toEqual({ x: 5, y: 3, z: 0 });
  });

  it('adds a component and undoes it', () => {
    const ctx = demoContext();
    ctx.selection.set(['camera']);
    const { host } = mount(mountInspector, ctx);
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Component type"]');
    if (!select) throw new Error('missing component picker');
    select.value = 'Light';
    host.querySelector<HTMLButtonElement>('[aria-label="Add component"]')?.click();
    expect(componentBag(ctx, 'camera', 'Light').intensity).toBe(1);
    ctx.undo.undo();
    expect(ctx.world.get('camera')?.components.Light).toBeUndefined();
  });

  it('disables fields on a locked entity', () => {
    const ctx = demoContext();
    ctx.selection.set(['player']);
    const { host } = mount(mountInspector, ctx);
    setFlag(ctx, 'player', 'locked', true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Position X"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#jp-entity-name')?.disabled).toBe(true);
  });

  it('imports into the selected folder, switches views, and undoes the import', () => {
    const { host, ctx } = mount(mountAssetBrowser);
    host.querySelector<HTMLElement>('[data-folder="textures"]')?.click();
    const file = new File(['png'], 'hero.png', { type: 'image/png' });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('missing file input');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(host.querySelector('[data-asset] .jp-asset-name')?.textContent).toBe('hero.png');
    expect(host.querySelector('.jp-thumb img')).not.toBeNull();

    host.querySelector<HTMLElement>('[data-folder="meshes"]')?.click();
    expect(host.querySelector('[data-asset]')).toBeNull();
    const search = host.querySelector<HTMLInputElement>('[aria-label="Search assets"]');
    if (!search) throw new Error('missing asset search');
    search.value = 'hero';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(host.querySelector('[data-asset] .jp-asset-name')?.textContent).toBe('hero.png');

    host.querySelector<HTMLButtonElement>('[aria-label="List view"]')?.click();
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('[aria-label="Grid view"]')?.click();
    expect(host.querySelector('[role="grid"]')).not.toBeNull();

    ctx.undo.undo();
    expect(host.querySelector('[data-asset]')).toBeNull();
  });

  it('imports a dropped file', () => {
    const { host } = mount(mountAssetBrowser);
    const zone = host.querySelector<HTMLElement>('[data-drop="assets"]');
    if (!zone) throw new Error('missing drop zone');
    dropFiles(zone, [new File(['{}'], 'crate.gltf', { type: 'model/gltf+json' })]);
    const name = host.querySelector('[data-asset] .jp-asset-name');
    expect(name?.textContent).toBe('crate.gltf');
    expect(host.querySelector('.jp-thumb')?.textContent).toBe('Mesh');
  });
});
