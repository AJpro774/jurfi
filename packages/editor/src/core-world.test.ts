import { createEditorWorld } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
import { createEditorContext } from './context';
import { createDefaultSnapshot, type EditorWorld } from './world';

describe('core editor world', () => {
  it('satisfies EditorWorld and restores the play-mode snapshot', () => {
    const world = createEditorWorld();
    const editor: EditorWorld = world;
    editor.deserialize(createDefaultSnapshot());
    expect(editor.get('player')?.components.health).toBe(-1);
    expect(editor.get('camera')?.parentId).toBe('scene');

    const ecs = world.ecs;
    const player = ecs.resolveAlias('player');
    expect(player).toBeDefined();
    ecs.setVariable(player ?? 0, 'score', 7);
    const beforeStop = ecs.toScene().generations;

    const ctx = createEditorContext({ world: editor });
    ctx.play();
    expect(ctx.getPlayState()).toBe('playing');
    editor.update('player', { name: 'Hero' });
    expect(editor.get('player')?.name).toBe('Hero');
    ecs.setVariable(player ?? 0, 'score', 99);
    editor.add({ id: 'bullet', name: 'Bullet', parentId: null, components: {} });
    ctx.stop();
    expect(ctx.getPlayState()).toBe('editing');
    expect(editor.get('player')?.name).toBe('Player');
    expect(editor.get('player')?.components).toEqual({ kind: 'node', health: -1 });
    expect(ecs.resolveAlias('player')).toBe(player);
    expect(ecs.getVariable(player ?? 0, 'score')).toBe(7);
    expect(editor.get('bullet')).toBeUndefined();
    expect(ecs.toScene().generations).toEqual(beforeStop);
  });
});
