import { describe, expect, it } from 'vitest';
import { POSE_DATA_TYPE, createMachine, evaluateBlendTree, stepMachine, validateBlendTree } from './blend';
import type { BlendTree, Pose, PoseSource } from './blend';

function pose(name: string, x: number): Pose {
  return { joints: { [name]: { position: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } } };
}

const source: PoseSource = (clipId) => {
  if (clipId === 'idle') return pose('hips', 0);
  if (clipId === 'walk') return pose('hips', 10);
  if (clipId === 'run') return pose('hips', 20);
  if (clipId === 'nod') return pose('head', 1);
  if (clipId === 'add') return { joints: { hips: { position: [0, 2, 0] } } };
  return undefined;
};

function tree(extra: Partial<BlendTree> = {}): BlendTree {
  return {
    version: 1,
    id: 'locomotion',
    name: 'Locomotion',
    root: 'move',
    params: [
      { id: 'speed', type: 'float', default: 0 },
      { id: 'x', type: 'float', default: 0 },
      { id: 'y', type: 'float', default: 0 },
      { id: 'weight', type: 'float', default: 1 },
      { id: 'grounded', type: 'bool', default: true },
      { id: 'jump', type: 'trigger' },
    ],
    nodes: [
      { id: 'idle', type: 'clip', clip: 'idle' },
      { id: 'walk', type: 'clip', clip: 'walk' },
      { id: 'run', type: 'clip', clip: 'run' },
      { id: 'nod', type: 'clip', clip: 'nod' },
      { id: 'add', type: 'clip', clip: 'add' },
      {
        id: 'move',
        type: 'blend1D',
        param: 'speed',
        children: [
          { node: 'idle', position: 0 },
          { node: 'walk', position: 1 },
          { node: 'run', position: 2 },
        ],
      },
      {
        id: 'strafe',
        type: 'blend2D',
        paramX: 'x',
        paramY: 'y',
        children: [
          { node: 'idle', x: 0, y: 0 },
          { node: 'walk', x: 1, y: 0 },
          { node: 'run', x: 0, y: 1 },
        ],
      },
      { id: 'bounce', type: 'additive', base: 'idle', add: 'add', weight: 'weight' },
      { id: 'upper', type: 'mask', source: 'nod', base: 'idle', joints: ['head'], weight: 1 },
    ],
    states: [
      { id: 'idle', node: 'idle' },
      { id: 'move', node: 'move', speed: 1 },
    ],
    entry: 'idle',
    transitions: [
      {
        id: 'to-move',
        from: 'idle',
        to: 'move',
        duration: 0.5,
        exitTime: 0.25,
        conditions: [
          { param: 'speed', op: '>', value: 0.2 },
          { param: 'grounded', op: '==', value: true },
          { param: 'jump', op: 'triggered' },
        ],
      },
    ],
    ...extra,
  };
}

describe('blend tree schema', () => {
  it('accepts a tree with every node kind and exports the pose port type', () => {
    expect(POSE_DATA_TYPE).toBe('pose');
    expect(validateBlendTree(tree())).toEqual([]);
    const roundTrip = JSON.parse(JSON.stringify(tree())) as unknown;
    expect(validateBlendTree(roundTrip)).toEqual([]);
  });

  it('reports broken refs, bad conditions, and cycles', () => {
    const broken = tree();
    broken.root = 'missing';
    broken.nodes.push({ id: 'loop', type: 'additive', base: 'loop', add: 'idle', weight: 1 });
    broken.transitions = [
      {
        id: 'bad',
        from: 'nope',
        to: 'idle',
        duration: -1,
        conditions: [{ param: 'speed', op: 'triggered' }],
      },
    ];
    const errors = validateBlendTree(broken);
    expect(errors.some((error) => error.includes('root'))).toBe(true);
    expect(errors.some((error) => error.includes('cycle'))).toBe(true);
    expect(errors.some((error) => error.includes('from'))).toBe(true);
    expect(errors.some((error) => error.includes('duration'))).toBe(true);
    expect(errors.some((error) => error.includes('trigger'))).toBe(true);
  });

  it('blends 1D, 2D, additive, and mask poses', () => {
    const doc = tree();
    const mid = evaluateBlendTree(doc, { speed: 0.25 }, 0, source);
    expect(mid.joints.hips?.position?.[0]).toBeCloseTo(2.5);

    doc.root = 'strafe';
    const exact = evaluateBlendTree(doc, { x: 1, y: 0 }, 0, source);
    expect(exact.joints.hips?.position?.[0]).toBeCloseTo(10);

    doc.root = 'bounce';
    const added = evaluateBlendTree(doc, { weight: 0.5 }, 0, source);
    expect(added.joints.hips?.position).toEqual([0, 1, 0]);

    doc.root = 'upper';
    const masked = evaluateBlendTree(doc, {}, 0, source);
    expect(masked.joints.head?.position?.[0]).toBeCloseTo(1);
    expect(masked.joints.hips?.position?.[0]).toBeCloseTo(0);
  });

  it('holds a transition until exit time and conditions, then crossfades', () => {
    const doc = tree();
    const start = createMachine(doc);
    const blocked = stepMachine(doc, start, { speed: 1, grounded: true, jump: true }, 0.1, source);
    expect(blocked.machine.state).toBe('idle');
    expect(blocked.consumed).toEqual([]);

    const armed = { ...blocked.machine, time: 0.25 };
    const fired = stepMachine(doc, armed, { speed: 1, grounded: true, jump: true }, 0, source);
    expect(fired.machine.state).toBe('move');
    expect(fired.machine.fromState).toBe('idle');
    expect(fired.consumed).toEqual(['jump']);
    expect(fired.pose.joints.hips?.position?.[0]).toBeCloseTo(0);

    const halfway = stepMachine(doc, fired.machine, { speed: 1 }, 0.25, source);
    expect(halfway.machine.state).toBe('move');
    expect(halfway.pose.joints.hips?.position?.[0]).toBeGreaterThan(0);
    expect(halfway.pose.joints.hips?.position?.[0]).toBeLessThan(10);
  });
});
