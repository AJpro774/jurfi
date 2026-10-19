import { validateBlendTree } from '@jurfi/anim';
import { describe, expect, it } from 'vitest';
import { createUndoStack } from '../../undo';
import { createGraphController } from '../controller';
import { createDefaultRegistry } from '../registry';
import { evaluateConnection } from '../validate';
import { blendTreeFromGraph, blendTreeToGraph } from './document';
import { createDemoBlendTree } from './demo';
import { addBlendCondition, addBlendState, addBlendTransition, allocateBlendId } from './edit';
import { createBlendRegistry } from './registry';

describe('blend tree canvas', () => {
  it('round-trips the demo tree and accepts pose connections', () => {
    const demo = createDemoBlendTree();
    const graph = blendTreeToGraph(demo);
    const restored = blendTreeFromGraph(graph);
    expect(restored).toEqual(demo);
    expect(validateBlendTree(restored)).toEqual([]);
    expect(JSON.stringify(restored)).not.toContain('"pos"');

    const registry = createBlendRegistry();
    const undo = createUndoStack();
    const controller = createGraphController({ document: graph, registry, undo });
    registry.register({
      typeId: 'anim/Speed',
      category: 'blend',
      doc: 'A number.',
      pins: [{ name: 'value', kind: 'data', direction: 'out', dataType: 'number' }],
    });
    const speed = controller.addNode('anim/Speed', { x: 0, y: 240 }) ?? '';
    const doc = controller.getDocument();
    expect(evaluateConnection(doc, registry, { node: 'idle', pin: 'pose' }, { node: 'move', pin: 'in0' }).ok).toBe(false);
    const mismatch = evaluateConnection(doc, registry, { node: speed, pin: 'value' }, { node: 'move', pin: 'in0' });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.message).toBe('Type mismatch: number → pose');
    const open = evaluateConnection(doc, registry, { node: 'idle', pin: 'pose' }, { node: 'strafe', pin: 'in0' });
    expect(open.ok).toBe(false);
    if (!open.ok) expect(open.message).toBe('Already connected');
    const fresh = controller.addNode('anim/Clip', { x: 40, y: 400 }) ?? '';
    controller.setProp(fresh, 'clip', 'Jump');
    expect(controller.connect({ node: fresh, pin: 'pose' }, { node: 'move', pin: 'in0' })).toBe('Input already connected');
    const extra = controller.addNode('anim/Blend1D', { x: 360, y: 400 }) ?? '';
    controller.setProp(extra, 'param', 'speed');
    controller.setProp(extra, 'count', 1);
    expect(controller.connect({ node: fresh, pin: 'pose' }, { node: extra, pin: 'in0' })).toBeNull();
    expect(createDefaultRegistry().get('core/Add')?.pins.some((pin) => pin.name === 'result')).toBe(true);
  });

  it('undoes parameter thresholds, states, and conditions through the controller', () => {
    const undo = createUndoStack();
    const controller = createGraphController({
      document: blendTreeToGraph(createDemoBlendTree()),
      registry: createBlendRegistry(),
      undo,
    });
    controller.setProp('move', 'pos1', 0.25);
    expect(blendTreeFromGraph(controller.getDocument()).nodes.find((node) => node.id === 'move')).toMatchObject({
      type: 'blend1D',
      children: [
        { node: 'idle', position: 0 },
        { node: 'walk', position: 0.25 },
        { node: 'run', position: 1 },
      ],
    });
    expect(undo.undo()).toBe(true);
    expect(blendTreeFromGraph(controller.getDocument()).nodes.find((node) => node.id === 'move')).toMatchObject({
      children: [{ position: 0 }, { position: 0.5 }, { position: 1 }],
    });

    controller.edit('Add state', (draft) => {
      const id = allocateBlendId(draft, 'state');
      addBlendState(draft, { id, name: 'Fall', node: 'idle' });
    });
    controller.edit('Add transition', (draft) => {
      const id = allocateBlendId(draft, 'transition');
      addBlendTransition(draft, { id, from: 'air', to: 'state_1', duration: 0.15, conditions: [] });
      addBlendCondition(draft, id, { param: 'jump', op: 'triggered' });
    });
    const edited = blendTreeFromGraph(controller.getDocument());
    expect(edited.states?.map((state) => state.id)).toContain('state_1');
    expect(edited.transitions?.some((transition) => transition.conditions.some((condition) => condition.op === 'triggered'))).toBe(true);
    expect(validateBlendTree(edited)).toEqual([]);
    expect(undo.undo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(blendTreeFromGraph(controller.getDocument()).states).toHaveLength(2);
    expect(undo.redo()).toBe(true);
    expect(blendTreeFromGraph(controller.getDocument()).states).toHaveLength(3);
  });
});
