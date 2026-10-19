import { createEditorWorld } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
import { renameEntity } from './content/edits';
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

  it('undoes a world edit through the core transaction log and keeps that step after stop', () => {
    const world = createEditorWorld();
    const editor: EditorWorld = world;
    editor.deserialize(createDefaultSnapshot());
    const ctx = createEditorContext({ world: editor });
    expect(renameEntity(ctx, 'player', 'Hero')).toBe(true);
    expect(ctx.undo.undoLabel()).toBe('Rename');
    expect(ctx.undo.undo()).toBe(true);
    expect(editor.get('player')?.name).toBe('Player');
    expect(ctx.undo.redo()).toBe(true);
    expect(editor.get('player')?.name).toBe('Hero');
    ctx.play();
    editor.update('player', { name: 'Ghost' });
    ctx.stop();
    expect(editor.get('player')?.name).toBe('Hero');
    expect(ctx.undo.canUndo()).toBe(true);
    expect(ctx.undo.undo()).toBe(true);
    expect(editor.get('player')?.name).toBe('Player');
  });
});
