import type { EditorContext } from '../context';
import type { WorldSnapshot } from '../world';
import { assetLibrary } from './assets';

const CHECKER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function createDemoSnapshot(): WorldSnapshot {
  return {
    entities: [
      { id: 'scene', name: 'Scene', parentId: null, components: {} },
      {
        id: 'camera',
        name: 'Camera',
        parentId: 'scene',
        components: {
          kind: 'camera',
          'jurfi.camera': { projection: 'perspective', fov: 50, sensor: [36, 24], viewport: [0, 0, 1, 1] },
          'jurfi.transform': { position: [0, 2, 6], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      },
      {
        id: 'light',
        name: 'Directional Light',
        parentId: 'scene',
        components: {
          'jurfi.light': { color: '#fff4e0', intensity: 2, mode: 'directional', castShadows: true },
          'jurfi.transform': { position: [2, 4, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      },
      {
        id: 'player',
        name: 'Player',
        parentId: 'scene',
        components: {
          kind: 'node',
          health: -1,
          'jurfi.transform': { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          'jurfi.health': { current: 100, max: 100 },
          'jurfi.mesh': { mesh: 'cube', tint: '#6ea8fe', shown: true, tag: 'hero' },
        },
      },
      {
        id: 'weapon',
        name: 'Weapon',
        parentId: 'player',
        components: {
          'jurfi.transform': { position: [0.3, 0.2, 0.4], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      },
      {
        id: 'ground',
        name: 'Ground',
        parentId: 'scene',
        components: {
          'jurfi.transform': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [8, 1, 8] },
          'jurfi.mesh': { mesh: 'cube', tint: '#8d9a86', shown: true, tag: 'floor' },
        },
      },
    ],
  };
}

export function seedDemoLibrary(ctx: EditorContext): void {
  const library = assetLibrary(ctx);
  if (library.assets().length > 0) return;
  library.insertRecord({ id: 'checker', name: 'checker.png', folderId: 'textures', kind: 'texture', url: CHECKER });
  library.insertRecord({ id: 'cube', name: 'cube.gltf', folderId: 'meshes', kind: 'mesh', url: null });
  library.insertRecord({ id: 'click', name: 'click.wav', folderId: 'audio', kind: 'audio', url: null });
}
