import type { BlendTree } from '@jurfi/anim';

/** A locomotion tree the blend workspace can open immediately. */
export function createDemoBlendTree(): BlendTree {
  return {
    version: 1,
    id: 'locomotion',
    name: 'Locomotion',
    root: 'move',
    params: [
      { id: 'speed', name: 'Speed', type: 'float', default: 0 },
      { id: 'direction', name: 'Direction', type: 'float', default: 0 },
      { id: 'jump', name: 'Jump', type: 'trigger' },
    ],
    nodes: [
      { id: 'idle', type: 'clip', clip: 'Idle' },
      { id: 'walk', type: 'clip', clip: 'Walk' },
      { id: 'run', type: 'clip', clip: 'Run' },
      {
        id: 'move',
        type: 'blend1D',
        param: 'speed',
        children: [
          { node: 'idle', position: 0 },
          { node: 'walk', position: 0.5 },
          { node: 'run', position: 1 },
        ],
      },
      {
        id: 'strafe',
        type: 'blend2D',
        paramX: 'direction',
        paramY: 'speed',
        children: [
          { node: 'idle', x: 0, y: 0 },
          { node: 'walk', x: 1, y: 0.5 },
          { node: 'run', x: 0, y: 1 },
        ],
      },
    ],
    states: [
      { id: 'ground', name: 'Ground', node: 'move', speed: 1 },
      { id: 'air', name: 'Air', node: 'idle' },
    ],
    transitions: [
      {
        id: 'to-air',
        from: 'ground',
        to: 'air',
        duration: 0.12,
        conditions: [{ param: 'jump', op: 'triggered' }],
      },
      {
        id: 'to-ground',
        from: 'air',
        to: 'ground',
        duration: 0.2,
        exitTime: 0.1,
        conditions: [{ param: 'speed', op: '<', value: 0.2 }],
      },
    ],
    entry: 'ground',
  };
}
