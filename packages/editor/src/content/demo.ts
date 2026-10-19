import type { EditorContext } from '../context';
import type { WorldSnapshot } from '../world';
import { assetLibrary } from './assets';

const CHECKER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const IDENTITY_ROTATION = [0, 0, 0, 1] as const;
const UNIT_SCALE = [1, 1, 1] as const;

function transform(position: readonly [number, number, number]): Record<string, unknown> {
  return {
    position: [...position],
    rotation: [...IDENTITY_ROTATION],
    scale: [...UNIT_SCALE],
  };
}

function viewportTransform(position: readonly [number, number, number], scale: readonly [number, number, number] = UNIT_SCALE): Record<string, unknown> {
  return {
    position: { x: position[0], y: position[1], z: position[2] },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: scale[0], y: scale[1], z: scale[2] },
  };
}

export function createDemoSnapshot(): WorldSnapshot {
  return {
    entities: [
      { id: 'scene', name: 'Scene', parentId: null, components: { kind: 'scene' } },
      {
        id: 'camera',
        name: 'Camera',
        parentId: 'scene',
        components: { kind: 'camera' },
      },
      {
        id: 'light',
        name: 'Directional Light',
        parentId: 'scene',
        components: {
          kind: 'node',
          Light: { kind: 'directional', color: [1, 0.956, 0.878, 1], intensity: 2, range: 20 },
          Transform: transform([2, 4, 1]),
          transform: viewportTransform([2, 4, 1]),
          mesh: { shape: 'sphere' },
        },
      },
      {
        id: 'player',
        name: 'Player',
        parentId: 'scene',
        components: {
          kind: 'node',
          health: -1,
          Transform: transform([0, 1, 0]),
          transform: viewportTransform([0, 1, 0]),
          mesh: { shape: 'box' },
        },
      },
      {
        id: 'weapon',
        name: 'Weapon',
        parentId: 'player',
        components: {
          kind: 'node',
          Transform: transform([0.3, 0.2, 0.4]),
          transform: viewportTransform([0.3, 0.2, 0.4]),
          mesh: { shape: 'box' },
        },
      },
      {
        id: 'ground',
        name: 'Ground',
        parentId: 'scene',
        components: {
          kind: 'node',
          Transform: transform([0, 0, 0]),
          transform: viewportTransform([0, 0, 0], [8, 1, 8]),
          mesh: { shape: 'plane' },
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
