import type { Clip } from '@jurfi/anim';
import { eulerDegreesToQuat } from './euler';

/**
 * A small clip that exercises scalar channels, one whole color, and one whole quaternion.
 * Targets the demo scene: `player` (box) and `light`.
 */
export function createSampleClip(): Clip {
  return {
    version: 1,
    id: 'player-intro',
    name: 'Player Intro',
    duration: 2,
    fps: 30,
    loop: true,
    loopMode: 'loop',
    tracks: [
      {
        id: 'pos-x',
        target: { entity: 'player', component: 'Transform', prop: 'position', channel: 0 },
        type: 'number',
        keys: [
          { t: 0, v: -1, interp: 'bezier', outTan: { dt: 0.25, dv: 0.8 } },
          { t: 1, v: 1.5, interp: 'bezier', inTan: { dt: -0.2, dv: 0 }, outTan: { dt: 0.25, dv: -0.4 } },
          { t: 2, v: 0, interp: 'linear', inTan: { dt: -0.3, dv: 0.2 } },
        ],
      },
      {
        id: 'pos-y',
        target: { entity: 'player', component: 'Transform', prop: 'position', channel: 1 },
        type: 'number',
        keys: [
          { t: 0, v: 0, interp: 'linear' },
          { t: 0.5, v: 1.4, interp: 'linear' },
          { t: 1, v: 0, interp: 'linear' },
          { t: 2, v: 0, interp: 'linear' },
        ],
      },
      {
        id: 'pos-z',
        target: { entity: 'player', component: 'Transform', prop: 'position', channel: 2 },
        type: 'number',
        keys: [
          { t: 0, v: 0, interp: 'linear' },
          { t: 2, v: -0.5, interp: 'linear' },
        ],
      },
      {
        id: 'rot',
        target: { entity: 'player', component: 'Transform', prop: 'rotation' },
        type: 'quat',
        keys: [
          { t: 0, v: [0, 0, 0, 1], interp: 'linear' },
          { t: 2, v: eulerDegreesToQuat([10, 25, 70]), interp: 'linear' },
        ],
      },
      {
        id: 'tint',
        target: { entity: 'light', component: 'Light', prop: 'color' },
        type: 'color',
        keys: [
          { t: 0, v: [1, 1, 1, 1], interp: 'bezier', outTan: { dt: 0.4, dv: 0 } },
          { t: 2, v: [1, 0.35, 0.25, 1], interp: 'linear', inTan: { dt: -0.4, dv: 0 } },
        ],
      },
    ],
    events: [
      { t: 0.5, name: 'jump' },
      { t: 1, name: 'land', data: { surface: 'stone' } },
    ],
  };
}
