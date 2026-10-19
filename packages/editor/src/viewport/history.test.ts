import { createEditorWorld } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
import { createUndoStack } from '../undo';
import { createDefaultSnapshot } from '../world';
import { baseline, hasTransform, readTransform } from './components';
import { finishTransformDrag, previewTransformDrag, type DragSession } from './history';

function scene() {
  const world = createEditorWorld();
  world.deserialize(createDefaultSnapshot());
  world.add({
    id: 'weapon',
    name: 'Weapon',
    parentId: 'player',
    components: { health: 3, mesh: { shape: 'box' } },
  });
  world.ecs.clearHistory();
  const player = world.ecs.resolveAlias('player');
  const weapon = world.ecs.resolveAlias('weapon');
  if (player === undefined || weapon === undefined) throw new Error('missing entity');
  return { world, ecs: world.ecs, player, weapon };
}

describe('transform undo', () => {
  it('keeps one ECS transaction for the whole drag and restores every entity', () => {
    const { ecs, player, weapon } = scene();
    const undo = createUndoStack();
    const before = new Map([
      [player, baseline(ecs, player)],
      [weapon, baseline(ecs, weapon)],
    ]);
    const session: DragSession = { active: false };
    const pose = (x: number, y: number) => ({
      position: { x, y, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    previewTransformDrag(ecs, 'Translate', before, new Map([[player, pose(1, 0)], [weapon, pose(0, 2)]]), session);
    previewTransformDrag(ecs, 'Translate', before, new Map([[player, pose(4, 1)], [weapon, pose(0.3, 2)]]), session);
    expect(session.active).toBe(true);
    expect(ecs.canUndo()).toBe(true);
    expect(readTransform(ecs, player).position).toEqual({ x: 4, y: 1, z: 0 });
    expect(readTransform(ecs, weapon).position.y).toBe(2);
    expect(ecs.get(player, 'health')).toBe(-1);
    expect(ecs.get(weapon, 'health')).toBe(3);

    const command = finishTransformDrag(ecs, 'Translate', before, session);
    expect(command?.label).toBe('Translate');
    if (!command) throw new Error('expected a command');
    undo.push(command);
    expect(undo.undo()).toBe(true);
    expect(hasTransform(ecs, player)).toBe(false);
    expect(hasTransform(ecs, weapon)).toBe(false);
    expect(ecs.get(player, 'health')).toBe(-1);
    expect(ecs.get(weapon, 'health')).toBe(3);
    expect(ecs.canUndo()).toBe(false);
    expect(undo.redo()).toBe(true);
    expect(readTransform(ecs, player).position.x).toBe(4);
    expect(readTransform(ecs, weapon).position.y).toBe(2);
    expect(undo.undo()).toBe(true);
    expect(undo.undo()).toBe(false);
  });

  it('skips a history step when the transform did not change', () => {
    const { ecs, player } = scene();
    const current = readTransform(ecs, player);
    const session: DragSession = { active: false };
    previewTransformDrag(ecs, 'Translate', new Map([[player, baseline(ecs, player)]]), new Map([[player, current]]), session);
    expect(session.active).toBe(false);
    expect(ecs.canUndo()).toBe(false);
    expect(finishTransformDrag(ecs, 'Translate', new Map(), session)).toBeNull();
  });
});
