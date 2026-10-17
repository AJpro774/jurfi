import { createEditorWorld } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
import { createEditorContext } from './context';
import { createDefaultSnapshot, type EditorWorld } from './world';

describe('core editor world', () => {
  it('satisfies EditorWorld and restores the play-mode snapshot', () => {
    const world: EditorWorld = createEditorWorld();
    world.deserialize(createDefaultSnapshot());
    expect(world.get('player')?.components.health).toBe(-1);
    expect(world.get('camera')?.parentId).toBe('scene');

    const ctx = createEditorContext({ world });
    ctx.play();
    expect(ctx.getPlayState()).toBe('playing');
    world.update('player', { name: 'Hero' });
    expect(world.get('player')?.name).toBe('Hero');
    ctx.stop();
    expect(ctx.getPlayState()).toBe('editing');
    expect(world.get('player')?.name).toBe('Player');
    expect(world.get('player')?.components).toEqual({ kind: 'node', health: -1 });
  });
});
