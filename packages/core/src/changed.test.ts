import { describe, expect, it } from 'vitest';
import { Transform } from './components';
import { defineComponent } from './schema';
import { EcsError } from './errors';
import { createWorld } from './world';
import type { ComponentChange } from './world';

const Health = defineComponent('Health', {
  hp: { type: 'number', default: 0 },
  alive: { type: 'boolean', default: true },
});

describe('onChanged', () => {
  it('reports add, set, setField, remove, and setParent to the matching listener', () => {
    const world = createWorld();
    const entity = world.create();
    const parent = world.create();
    const seen: ComponentChange[] = [];
    const stopField = world.onChanged(entity, Health, 'hp', (change) => seen.push(change));
    const parents: Array<EntityParent> = [];
    world.onChanged(entity, (change) => {
      if (change.kind === 'setParent') parents.push(change.parent ?? null);
    });
    let transformHits = 0;
    world.onChanged(entity, Transform, () => {
      transformHits += 1;
    });

    world.add(entity, Health, { hp: 1 });
    world.set(entity, Health, { hp: 2, alive: false });
    world.setField(entity, Health, 'hp', 3);
    world.setField(entity, Health, 'alive', false);
    world.remove(entity, Health);
    world.setParent(entity, parent);
    world.add(entity, Transform);

    expect(seen.map((change) => change.kind)).toEqual(['add', 'set', 'setField', 'remove']);
    expect(seen[2]).toMatchObject({ entity, component: 'Health', field: 'hp', kind: 'setField' });
    expect(parents).toEqual([parent]);
    expect(transformHits).toBe(1);

    stopField();
    world.add(entity, Health, { hp: 4 });
    expect(seen).toHaveLength(4);
    expect(() => world.onChanged(parent, Health, '', () => undefined)).toThrow(EcsError);
    world.destroy(entity);
    expect(() => world.onChanged(entity, () => undefined)).toThrow(EcsError);
  });

  it('stays quiet for a different entity or field', () => {
    const world = createWorld();
    const entity = world.create();
    const other = world.create();
    const hits: string[] = [];
    world.onChanged(entity, Health, 'hp', () => hits.push('hp'));
    world.onChanged(other, Health, 'hp', () => hits.push('other'));
    world.setField(entity, Health, 'alive', false);
    world.setField(other, Health, 'hp', 1);
    expect(hits).toEqual(['other']);
  });

  it('delivers one coalesced call after the outermost batch', () => {
    const world = createWorld();
    const entity = world.create();
    world.add(entity, Health, { hp: 0 });
    const reads: number[] = [];
    world.onChanged(entity, Health, 'hp', () => {
      reads.push(world.getField(entity, Health, 'hp') as number);
    });

    world.batch(() => {
      world.batch(() => {
        world.setField(entity, Health, 'hp', 1);
        expect(reads).toEqual([]);
      });
      expect(reads).toEqual([]);
      world.setField(entity, Health, 'hp', 2);
      world.setField(entity, Health, 'alive', false);
    });
    expect(reads).toEqual([2]);
  });

  it('waits for a transaction and still reports a rolled-back value', () => {
    const world = createWorld();
    const entity = world.create();
    world.add(entity, Health, { hp: 1 });
    const reads: number[] = [];
    world.onChanged(entity, Health, 'hp', () => {
      reads.push(world.getField(entity, Health, 'hp') as number);
    });

    world.transaction(() => {
      world.setField(entity, Health, 'hp', 4);
      world.setField(entity, Health, 'hp', 5);
      expect(reads).toEqual([]);
    });
    expect(reads).toEqual([5]);

    expect(() => {
      world.transaction(() => {
        world.setField(entity, Health, 'hp', 9);
        expect(reads).toEqual([5]);
        throw new Error('nope');
      });
    }).toThrow('nope');
    expect(world.getField(entity, Health, 'hp')).toBe(5);
    expect(reads.at(-1)).toBe(5);
    expect(reads.length).toBeGreaterThan(1);
  });

  it('notifies once when undo restores a field inside its batch', () => {
    const world = createWorld();
    const entity = world.create();
    world.add(entity, Health, { hp: 1 });
    world.setField(entity, Health, 'hp', 2);
    const reads: number[] = [];
    world.onChanged(entity, Health, 'hp', () => {
      reads.push(world.getField(entity, Health, 'hp') as number);
    });
    expect(world.undo()).toBe(true);
    expect(reads).toEqual([1]);
    expect(world.getField(entity, Health, 'hp')).toBe(1);
  });
});

type EntityParent = number | null;
