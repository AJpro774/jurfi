import { describe, expect, it } from 'vitest';
import { createUndoStack } from '../undo';
import { createWorld } from '../world';
import { entityTransform, writeTransform } from './components';
import { transformUndo } from './history';

describe('transform undo', () => {
  it('restores the previous transform and redoes the drag', () => {
    const world = createWorld();
    const undo = createUndoStack();
    const before = new Map([['player', entityTransform(world.get('player')!)]]);
    const moved = {
      position: { x: 4, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    };
    writeTransform(world, 'player', moved);
    const after = new Map([['player', entityTransform(world.get('player')!)]]);
    const command = transformUndo(world, before, after, 'Translate', new Set(['player']));
    expect(command?.label).toBe('Translate');
    if (!command) throw new Error('expected a command');
    undo.push(command);
    expect(entityTransform(world.get('player')!).position.x).toBe(4);
    expect(world.get('player')?.components.health).toBe(-1);
    expect(undo.undo()).toBe(true);
    expect(world.get('player')?.components.transform).toBeUndefined();
    expect(world.get('player')?.components.health).toBe(-1);
    expect(undo.redo()).toBe(true);
    expect(entityTransform(world.get('player')!).position.x).toBe(4);
  });

  it('skips a history step when the transform did not change', () => {
    const world = createWorld();
    const current = entityTransform(world.get('player')!);
    expect(transformUndo(world, new Map([['player', current]]), new Map([['player', current]]))).toBeNull();
  });
});
