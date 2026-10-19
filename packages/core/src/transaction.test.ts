import { describe, expect, it } from 'vitest';
import { Transform } from './components';
import { entityGeneration, entityIndex, nextGeneration } from './entity';
import { EcsError } from './errors';
import { defineComponent } from './schema';
import { createWorld, type SceneJson, type World } from './world';

const TxHealth = defineComponent('TxHealth', {
  hp: { type: 'number', default: 0 },
  alive: { type: 'boolean', default: true },
});

function scene(world: World): SceneJson {
  return world.toScene();
}

describe('transactions', () => {
  it('undoes and redoes a single edit, and a new edit drops redo', () => {
    const world = createWorld();
    const entity = world.create();
    world.setName(entity, 'A');
    world.setName(entity, 'B');
    expect(world.canUndo()).toBe(true);
    expect(world.undo()).toBe(true);
    expect(world.getName(entity)).toBe('A');
    expect(world.canRedo()).toBe(true);
    world.setName(entity, 'C');
    expect(world.canRedo()).toBe(false);
    expect(world.getName(entity)).toBe('C');
    expect(world.undo()).toBe(true);
    expect(world.getName(entity)).toBe('A');
    expect(world.redo()).toBe(true);
    expect(world.getName(entity)).toBe('C');
    expect(world.undo()).toBe(true);
    expect(world.undo()).toBe(true);
    expect(world.getName(entity)).toBe('');
    expect(world.undo()).toBe(true);
    expect(world.isAlive(entity)).toBe(false);
    expect(world.undo()).toBe(false);
  });

  it('groups several edits into one step and rolls back on throw', () => {
    const world = createWorld();
    const entity = world.create();
    const seen: string[] = [];
    world.onChange((change) => seen.push(`${change.kind}:${change.label}:${change.patches.map((patch) => patch.op).join(',')}`));

    world.transaction('rename', () => {
      world.setName(entity, 'A');
      world.setName(entity, 'B');
      world.add(entity, TxHealth, { hp: 2 });
      world.setField(entity, TxHealth, 'hp', 5);
      world.setVariable(entity, 'score', { n: 1 });
    });
    expect(seen).toEqual(['edit:rename:setName,setName,add,setField,setVariable']);
    expect(world.undo()).toBe(true);
    expect(world.getName(entity)).toBe('');
    expect(world.has(entity, TxHealth)).toBe(false);
    expect(world.hasVariable(entity, 'score')).toBe(false);
    expect(seen.at(-1)).toBe('undo:rename:deleteVariable,setField,remove,setName,setName');
    expect(world.redo()).toBe(true);
    expect(world.getName(entity)).toBe('B');
    expect(world.get(entity, TxHealth)).toEqual({ hp: 5, alive: true });
    expect(world.getVariable(entity, 'score')).toEqual({ n: 1 });

    const nested = createWorld();
    const id = nested.create();
    nested.transaction('outer', () => {
      nested.setName(id, 'outer');
      nested.transaction('inner', () => {
        nested.setVariable(id, 'k', 1);
      });
    });
    expect(nested.undo()).toBe(true);
    expect(nested.getName(id)).toBe('');
    expect(nested.hasVariable(id, 'k')).toBe(false);
    expect(nested.canUndo()).toBe(true);

    expect(() =>
      world.transaction(() => {
        world.setName(entity, 'nope');
        world.setField(entity, TxHealth, 'hp', 9);
        throw new Error('fail');
      }),
    ).toThrow('fail');
    expect(world.getName(entity)).toBe('B');
    expect(world.getField(entity, TxHealth, 'hp')).toBe(5);
    expect(() => world.transaction(() => world.undo())).toThrow(EcsError);
    expect(world.getName(entity)).toBe('B');
  });

  it('round-trips destroy and generation reuse exactly', () => {
    const world = createWorld();
    const parent = world.create();
    world.setName(parent, 'Parent');
    world.setAlias(parent, 'parent');
    const child = world.create();
    world.setName(child, 'Child');
    world.setParent(child, parent);
    world.add(child, Transform, { position: [3, 0, 0], scale: [2, 2, 2] });
    world.add(child, 'Note', { text: 'hi' });
    world.setField(child, 'Note', 'text', 'yo');
    world.setVariable(child, 'score', { n: 4 });
    world.setField(child, Transform, 'position.y', 8);

    const beforeDestroy = scene(world);
    world.destroy(child);
    expect(world.isAlive(child)).toBe(false);
    expect(world.getParent(child)).toBeNull();
    expect(world.get(child, Transform)).toBeUndefined();

    const reused = world.create();
    expect(entityIndex(reused)).toBe(entityIndex(child));
    expect(reused).not.toBe(child);
    expect(entityGeneration(reused)).toBe(nextGeneration(entityGeneration(child)));
    world.setName(reused, 'Reused');
    world.add(reused, TxHealth, { hp: 1 });
    const afterReuse = scene(world);

    expect(world.undo()).toBe(true);
    expect(world.undo()).toBe(true);
    expect(world.undo()).toBe(true);
    expect(world.undo()).toBe(true);
    expect(world.isAlive(reused)).toBe(false);
    expect(world.isAlive(child)).toBe(true);
    expect(scene(world)).toEqual(beforeDestroy);
    expect(world.getName(child)).toBe('Child');
    expect(world.getParent(child)).toBe(parent);
    expect(world.getField(child, Transform, 'position')).toEqual([3, 8, 0]);
    expect(world.get(child, 'Note')).toEqual({ text: 'yo' });
    expect(world.getVariable(child, 'score')).toEqual({ n: 4 });
    expect(world.alias(parent)).toBe('parent');

    expect(world.redo()).toBe(true);
    expect(world.redo()).toBe(true);
    expect(world.redo()).toBe(true);
    expect(world.redo()).toBe(true);
    expect(world.isAlive(child)).toBe(false);
    expect(world.isAlive(reused)).toBe(true);
    expect(entityGeneration(reused)).toBe(nextGeneration(entityGeneration(child)));
    expect(scene(world)).toEqual(afterReuse);
    expect(world.get(reused, TxHealth)).toEqual({ hp: 1, alive: true });
    expect(world.has(reused, Transform)).toBe(false);

    expect(world.undo()).toBe(true);
    expect(world.undo()).toBe(true);
    expect(world.undo()).toBe(true);
    expect(world.undo()).toBe(true);
    world.destroy(parent);
    expect(world.getParent(child)).toBeNull();
    expect(world.isAlive(parent)).toBe(false);
    world.undo();
    expect(world.isAlive(parent)).toBe(true);
    expect(world.getParent(child)).toBe(parent);
    expect(world.alias(parent)).toBe('parent');
    expect(world.getName(parent)).toBe('Parent');
  });

  it('keeps one parent step and restores children after a grouped replace', () => {
    const world = createWorld();
    const root = world.create();
    const parent = world.create();
    const child = world.create();
    world.setParent(parent, root);
    world.setParent(child, parent);
    world.setVariable(parent, 'tag', 'keep');
    const before = scene(world);

    let bounced = 0;
    world.transaction('replace', () => {
      world.destroy(parent);
      bounced = world.create();
      world.setName(bounced, 'temp');
      world.setParent(child, bounced);
    });
    expect(world.isAlive(parent)).toBe(false);
    expect(world.getParent(child)).toBe(bounced);
    expect(entityIndex(bounced)).toBe(entityIndex(parent));
    expect(bounced).not.toBe(parent);

    expect(world.undo()).toBe(true);
    expect(world.isAlive(parent)).toBe(true);
    expect(world.isAlive(bounced)).toBe(false);
    expect(world.getParent(child)).toBe(parent);
    expect(world.getParent(parent)).toBe(root);
    expect(world.getVariable(parent, 'tag')).toBe('keep');
    expect(scene(world)).toEqual(before);
    expect(world.redo()).toBe(true);
    expect(world.isAlive(bounced)).toBe(true);
    expect(world.getName(bounced)).toBe('temp');
    expect(world.getParent(child)).toBe(bounced);
    expect(world.isAlive(parent)).toBe(false);

    world.undo();
    expect(() =>
      world.transaction(() => {
        world.destroy(parent);
        const created = world.create();
        world.setName(created, 'nope');
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(scene(world)).toEqual(before);
    expect(world.isAlive(parent)).toBe(true);
    const next = world.create();
    expect(entityIndex(next)).not.toBe(entityIndex(parent));
    expect(world.isAlive(parent)).toBe(true);
  });

  it('emits one change per step and clears history on load', () => {
    const world = createWorld();
    const events: string[] = [];
    const stop = world.onChange((change) => events.push(change.kind));
    const entity = world.create();
    world.batch(() => {
      world.setName(entity, 'A');
      world.setName(entity, 'B');
    });
    expect(events).toEqual(['edit', 'edit', 'edit']);
    world.undo();
    expect(world.getName(entity)).toBe('A');
    stop();
    world.setName(entity, 'C');
    expect(events).toEqual(['edit', 'edit', 'edit', 'undo']);

    world.setVariable(entity, 'n', 1);
    world.deleteVariable(entity, 'n');
    world.remove(entity, TxHealth);
    world.loadScene(scene(world));
    expect(world.canUndo()).toBe(false);
    expect(world.canRedo()).toBe(false);
    expect(world.getName(entity)).toBe('C');
    world.clearHistory();
    expect(world.undo()).toBe(false);
  });

  it('undoes a field write without clobbering the rest of the component', () => {
    const world = createWorld();
    const entity = world.create();
    world.add(entity, Transform, { position: [1, 2, 3], scale: [4, 5, 6] });
    world.setField(entity, Transform, 'position.x', 9);
    world.setField(entity, TxHealth, 'alive', false);
    world.undo();
    expect(world.has(entity, TxHealth)).toBe(false);
    world.undo();
    expect(world.getField(entity, Transform, 'position')).toEqual([1, 2, 3]);
    expect(world.getField(entity, Transform, 'scale')).toEqual([4, 5, 6]);
    world.redo();
    expect(world.getField(entity, Transform, 'position.x')).toBe(9);
    expect(world.getField(entity, Transform, 'scale.y')).toBe(5);
  });
});
