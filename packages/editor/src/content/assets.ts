import type { EditorContext } from '../context';

export type AssetKind = 'texture' | 'mesh' | 'audio' | 'file';

export interface AssetFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface AssetItem {
  id: string;
  name: string;
  folderId: string;
  kind: AssetKind;
  url: string | null;
}

export interface AssetLibrary {
  folders(): readonly AssetFolder[];
  assets(): readonly AssetItem[];
  insert(file: File, folderId: string): AssetItem;
  insertRecord(asset: AssetItem): void;
  remove(id: string): void;
  restore(asset: AssetItem): void;
  subscribe(listener: () => void): () => void;
}

const libraries = new WeakMap<EditorContext, AssetLibrary>();

function kindFor(file: File): AssetKind {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return 'texture';
  if (file.type.startsWith('audio/') || /\.(wav|mp3|ogg)$/.test(name)) return 'audio';
  if (/\.(gltf|glb|obj|fbx)$/.test(name)) return 'mesh';
  return 'file';
}

function createAssetLibrary(): AssetLibrary {
  const folders: AssetFolder[] = [
    { id: 'root', name: 'Assets', parentId: null },
    { id: 'textures', name: 'Textures', parentId: 'root' },
    { id: 'meshes', name: 'Meshes', parentId: 'root' },
    { id: 'audio', name: 'Audio', parentId: 'root' },
  ];
  const assets: AssetItem[] = [];
  const listeners = new Set<() => void>();
  let sequence = 0;

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const knownFolder = (folderId: string): string => (folders.some((folder) => folder.id === folderId) ? folderId : 'root');

  return {
    folders: () => folders.map((folder) => ({ ...folder })),
    assets: () => assets.map((asset) => ({ ...asset })),
    insert(file, folderId) {
      sequence += 1;
      const kind = kindFor(file);
      const asset: AssetItem = {
        id: `asset-${sequence}`,
        name: file.name,
        folderId: knownFolder(folderId),
        kind,
        url: kind === 'texture' ? URL.createObjectURL(file) : null,
      };
      assets.push(asset);
      emit();
      return { ...asset };
    },
    insertRecord(asset) {
      if (assets.some((item) => item.id === asset.id)) return;
      assets.push({ ...asset });
      emit();
    },
    remove(id) {
      const index = assets.findIndex((asset) => asset.id === id);
      if (index < 0) return;
      assets.splice(index, 1);
      emit();
    },
    restore(asset) {
      if (assets.some((item) => item.id === asset.id)) return;
      assets.push({ ...asset });
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function assetLibrary(ctx: EditorContext): AssetLibrary {
  const existing = libraries.get(ctx);
  if (existing) return existing;
  const created = createAssetLibrary();
  libraries.set(ctx, created);
  return created;
}

export function importAssets(ctx: EditorContext, files: readonly File[], folderId: string): AssetItem[] {
  const library = assetLibrary(ctx);
  const added = files.filter((file) => file.name.trim() !== '').map((file) => library.insert(file, folderId));
  if (added.length === 0) return [];
  const label = added.length === 1 ? `Import ${added[0]?.name ?? 'asset'}` : `Import ${added.length} assets`;
  ctx.undo.push({
    label,
    undo() {
      for (const asset of added) library.remove(asset.id);
    },
    redo() {
      for (const asset of added) library.restore(asset);
    },
  });
  return added;
}

export function folderDescendants(folders: readonly AssetFolder[], rootId: string): Set<string> {
  const children = new Map<string | null, AssetFolder[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  const found = new Set<string>();
  const walk = (id: string): void => {
    if (found.has(id)) return;
    found.add(id);
    for (const child of children.get(id) ?? []) walk(child.id);
  };
  walk(rootId);
  return found;
}
