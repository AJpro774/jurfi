import type { EditorContext } from '../context';
import { assetLibrary, folderDescendants, importAssets, type AssetFolder, type AssetItem, type AssetKind } from './assets';

type ViewMode = 'grid' | 'list';

function filesFrom(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files = [...transfer.files];
  if (files.length > 0) return files;
  const types = [...transfer.types];
  if (types.includes('Files') || types.includes('application/x-moz-file')) return files;
  return [];
}

function acceptsFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  if (transfer.files.length > 0) return true;
  const types = [...transfer.types];
  return types.includes('Files') || types.includes('application/x-moz-file');
}

export function mountAssetBrowser(el: HTMLElement, ctx: EditorContext): () => void {
  el.classList.add('jp-host');
  const library = assetLibrary(ctx);
  const panel = document.createElement('div');
  panel.className = 'jp-panel';
  el.append(panel);

  let query = '';
  let folderId = 'root';
  let mode: ViewMode = 'grid';
  let selectedId: string | null = null;
  let focusAfterRender: string | null = null;
  let rendering = false;

  const offLibrary = library.subscribe(() => render());
  render();

  return () => {
    offLibrary();
    panel.remove();
  };

  function visibleAssets(): AssetItem[] {
    const trimmed = query.trim().toLowerCase();
    const assets = library.assets();
    if (trimmed !== '') return assets.filter((asset) => asset.name.toLowerCase().includes(trimmed));
    const folders = folderDescendants(library.folders(), folderId);
    return assets.filter((asset) => folders.has(asset.folderId));
  }

  function render(): void {
    if (rendering) return;
    rendering = true;
    const previous = document.activeElement;
    const focusKey = previous instanceof HTMLElement && panel.contains(previous) ? previous.dataset.focus ?? null : null;
    const caret = previous instanceof HTMLInputElement ? previous.selectionStart : null;
    const caretEnd = previous instanceof HTMLInputElement ? previous.selectionEnd : null;
    const forced = focusAfterRender;
    focusAfterRender = null;

    panel.replaceChildren();
    const toolbar = document.createElement('div');
    toolbar.className = 'jp-toolbar';
    const search = document.createElement('input');
    search.className = 'je-field';
    search.type = 'search';
    search.placeholder = 'Search';
    search.setAttribute('aria-label', 'Search assets');
    search.dataset.focus = 'search';
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      render();
    });
    const gridButton = viewButton('Grid view', mode === 'grid', () => {
      mode = 'grid';
      render();
    });
    const listButton = viewButton('List view', mode === 'list', () => {
      mode = 'list';
      render();
    });
    const file = document.createElement('input');
    file.className = 'jp-file';
    file.type = 'file';
    file.multiple = true;
    file.tabIndex = -1;
    file.setAttribute('aria-label', 'Import files');
    file.addEventListener('change', () => {
      const chosen = file.files ? [...file.files] : [];
      if (chosen.length > 0) importAssets(ctx, chosen, folderId);
      file.value = '';
    });
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'jp-text-btn';
    importButton.textContent = 'Import';
    importButton.addEventListener('click', () => file.click());
    toolbar.append(search, gridButton, listButton, importButton, file);

    const body = document.createElement('div');
    body.className = 'jp-browser';
    body.append(folderTree(), assetView());
    panel.append(toolbar, body);

    const nextKey = forced ?? focusKey;
    if (nextKey) {
      const next = panel.querySelector<HTMLElement>(`[data-focus="${escapeAttr(nextKey)}"]`);
      if (next) {
        next.focus();
        if (next instanceof HTMLInputElement && caret !== null && caretEnd !== null && nextKey === focusKey) {
          next.setSelectionRange(caret, caretEnd);
        }
      }
    }
    rendering = false;
  }

  function folderTree(): HTMLElement {
    const tree = document.createElement('div');
    tree.className = 'jp-folders';
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', 'Folders');
    const folders = library.folders();
    const children = new Map<string | null, AssetFolder[]>();
    for (const folder of folders) {
      const list = children.get(folder.parentId) ?? [];
      list.push(folder);
      children.set(folder.parentId, list);
    }
    const visit = (parent: string | null, depth: number): void => {
      for (const folder of children.get(parent) ?? []) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'je-row';
        row.setAttribute('role', 'treeitem');
        row.dataset.folder = folder.id;
        row.dataset.focus = `folder:${folder.id}`;
        row.style.setProperty('--je-depth', String(depth));
        row.ariaSelected = folder.id === folderId ? 'true' : 'false';
        row.textContent = folder.name;
        row.addEventListener('click', () => {
          folderId = folder.id;
          render();
        });
        tree.append(row);
        visit(folder.id, depth + 1);
      }
    };
    visit(null, 0);
    return tree;
  }

  function assetView(): HTMLElement {
    const view = document.createElement('div');
    view.className = 'jp-assets';
    const assets = visibleAssets();
    if (!selectedId || !assets.some((asset) => asset.id === selectedId)) selectedId = assets[0]?.id ?? null;
    const list = document.createElement('div');
    list.className = mode === 'grid' ? 'jp-grid' : 'jp-list';
    list.dataset.drop = 'assets';
    if (mode === 'grid') {
      list.setAttribute('role', 'grid');
      list.setAttribute('aria-label', 'Assets');
    } else {
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Assets');
    }
    if (assets.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'je-muted jp-empty';
      empty.textContent = query.trim() === '' ? 'No assets' : 'No matches';
      list.append(empty);
    }
    const row = mode === 'grid' ? document.createElement('div') : null;
    if (row) {
      row.setAttribute('role', 'row');
      list.append(row);
    }
    for (const asset of assets) {
      const cell = assetCell(asset);
      (row ?? list).append(cell);
    }
    list.addEventListener('keydown', onAssetKey);
    list.addEventListener('dragover', (event) => {
      if (!acceptsFiles(event.dataTransfer)) return;
      event.preventDefault();
      view.classList.add('is-drop');
    });
    list.addEventListener('dragleave', () => view.classList.remove('is-drop'));
    list.addEventListener('drop', (event) => {
      if (!acceptsFiles(event.dataTransfer)) return;
      event.preventDefault();
      view.classList.remove('is-drop');
      const files = filesFrom(event.dataTransfer);
      if (files.length > 0) importAssets(ctx, files, folderId);
    });
    view.append(list);
    return view;
  }

  function assetCell(asset: AssetItem): HTMLElement {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = mode === 'grid' ? 'jp-cell' : 'je-row jp-asset-row';
    cell.dataset.asset = asset.id;
    cell.dataset.focus = `asset:${asset.id}`;
    cell.tabIndex = asset.id === selectedId ? 0 : -1;
    cell.ariaSelected = asset.id === selectedId ? 'true' : 'false';
    if (mode === 'grid') cell.setAttribute('role', 'gridcell');
    else cell.setAttribute('role', 'option');
    cell.append(thumbnail(asset));
    const name = document.createElement('span');
    name.className = 'jp-asset-name';
    name.textContent = asset.name;
    cell.append(name);
    cell.addEventListener('click', () => {
      selectedId = asset.id;
      focusAfterRender = `asset:${asset.id}`;
      render();
    });
    return cell;
  }

  function onAssetKey(event: KeyboardEvent): void {
    const assets = visibleAssets();
    const index = assets.findIndex((asset) => asset.id === selectedId);
    const columns = mode === 'list' ? 1 : 4;
    let next = index;
    if (event.key === 'ArrowRight') next = index + 1;
    else if (event.key === 'ArrowLeft') next = index - 1;
    else if (event.key === 'ArrowDown') next = index + columns;
    else if (event.key === 'ArrowUp') next = index - columns;
    else return;
    event.preventDefault();
    const asset = assets[Math.max(0, Math.min(assets.length - 1, next))];
    if (!asset) return;
    selectedId = asset.id;
    focusAfterRender = `asset:${asset.id}`;
    render();
  }
}

function viewButton(label: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jp-text-btn';
  button.textContent = label === 'Grid view' ? 'Grid' : 'List';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  button.addEventListener('click', onClick);
  return button;
}

function thumbnail(asset: AssetItem): HTMLElement {
  const thumb = document.createElement('span');
  thumb.className = 'jp-thumb';
  if (asset.kind === 'texture' && asset.url) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = asset.url;
    thumb.append(image);
    return thumb;
  }
  thumb.textContent = kindLabel(asset.kind);
  return thumb;
}

function kindLabel(kind: AssetKind): string {
  if (kind === 'texture') return 'Image';
  if (kind === 'mesh') return 'Mesh';
  if (kind === 'audio') return 'Audio';
  return 'File';
}

function escapeAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
