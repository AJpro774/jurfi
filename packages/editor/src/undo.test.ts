import { describe, expect, it } from 'vitest';
import { createEditorContext, createUndoStack, type UndoCommand } from './index';

function assign(value: { current: number }, next: number, prev: number, mergeKey?: string): UndoCommand {
  return {
    label: `Set ${next}`,
    mergeKey,
    undo: () => {
      value.current = prev;
    },
    redo: () => {
      value.current = next;
    },
  };
}

describe('undo stack', () => {
  it('undoes and redoes in order', () => {
    const stack = createUndoStack();
    const value = { current: 0 };
    value.current = 1;
    stack.push(assign(value, 1, 0));
    value.current = 2;
    stack.push(assign(value, 2, 1));
    expect(stack.canUndo()).toBe(true);
    expect(stack.undo()).toBe(true);
    expect(value.current).toBe(1);
    expect(stack.undo()).toBe(true);
    expect(value.current).toBe(0);
    expect(stack.undo()).toBe(false);
    expect(stack.redo()).toBe(true);
    expect(value.current).toBe(1);
    expect(stack.canRedo()).toBe(true);
  });

  it('merges consecutive edits that share a mergeKey into one step', () => {
    const stack = createUndoStack();
    const value = { current: 0 };
    value.current = 1;
    stack.push(assign(value, 1, 0, 'n'));
    value.current = 2;
    stack.push(assign(value, 2, 1, 'n'));
    value.current = 3;
    stack.push(assign(value, 3, 2, 'n'));
    expect(stack.undoLabel()).toBe('Set 3');
    expect(stack.undo()).toBe(true);
    expect(value.current).toBe(0);
    expect(stack.canUndo()).toBe(false);
    expect(stack.redo()).toBe(true);
    expect(value.current).toBe(3);
  });

  it('does not merge different keys and drops redo history on a new push', () => {
    const stack = createUndoStack();
    const value = { current: 0 };
    value.current = 1;
    stack.push(assign(value, 1, 0, 'a'));
    value.current = 2;
    stack.push(assign(value, 2, 1, 'b'));
    stack.undo();
    expect(value.current).toBe(1);
    value.current = 4;
    stack.push(assign(value, 4, 1, 'a'));
    expect(stack.canRedo()).toBe(false);
    expect(stack.undo()).toBe(true);
    expect(value.current).toBe(1);
    expect(stack.undo()).toBe(true);
    expect(value.current).toBe(0);
  });

  it('lets a command refuse a merge', () => {
    const stack = createUndoStack();
    const value = { current: 0 };
    value.current = 1;
    stack.push(assign(value, 1, 0, 'n'));
    value.current = 2;
    const second = assign(value, 2, 1, 'n');
    second.merge = () => false;
    stack.push(second);
    stack.undo();
    expect(value.current).toBe(1);
    stack.undo();
    expect(value.current).toBe(0);
  });

  it('notifies subscribers and clears', () => {
    const stack = createUndoStack();
    const events: string[] = [];
    const off = stack.subscribe((event) => events.push(event));
    const value = { current: 0 };
    stack.push(assign(value, 1, 0));
    stack.undo();
    stack.redo();
    stack.clear();
    off();
    stack.push(assign(value, 2, 1));
    expect(events).toEqual(['push', 'undo', 'redo', 'clear']);
    expect(stack.canUndo()).toBe(true);
  });
});

describe('play mode', () => {
  it('restores the world snapshot on stop and clears undo', () => {
    const ctx = createEditorContext();
    ctx.selection.set(['player']);
    ctx.play();
    expect(ctx.getPlayState()).toBe('playing');
    const before = ctx.world.get('player')?.name;
    ctx.world.update('player', { name: 'Ghost' });
    ctx.undo.push({
      label: 'Rename',
      undo: () => ctx.world.update('player', { name: before ?? 'Player' }),
      redo: () => ctx.world.update('player', { name: 'Ghost' }),
    });
    ctx.pause();
    expect(ctx.getPlayState()).toBe('paused');
    ctx.play();
    expect(ctx.getPlayState()).toBe('playing');
    ctx.stop();
    expect(ctx.getPlayState()).toBe('editing');
    expect(ctx.world.get('player')?.name).toBe('Player');
    expect(ctx.undo.canUndo()).toBe(false);
    expect(ctx.selection.get()).toEqual(['player']);
  });

  it('steps into a paused session and emits play:step', () => {
    const ctx = createEditorContext();
    const steps: string[] = [];
    ctx.bus.on('play:step', (event) => steps.push(event.state));
    ctx.step();
    expect(ctx.getPlayState()).toBe('paused');
    expect(steps).toEqual(['paused']);
    ctx.world.update('player', { name: 'Ghost' });
    ctx.stop();
    expect(ctx.world.get('player')?.name).toBe('Player');
  });
});
