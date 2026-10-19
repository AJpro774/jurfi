import { describe, expect, it } from 'vitest';
import { createEditorWorld, createScriptWorld } from './adapters';
import { Light, Light2D, Transform } from './components';
import {
  GENERATION_MASK,
  entityGeneration,
  entityIndex,
  nextGeneration,
  packEntity,
} from './entity';
import { EcsError } from './errors';
import { defineComponent, resolveStorage } from './schema';
import { createWorld, type World } from './world';

const Health = defineComponent('Health', {
  hp: { type: 'number', default: 0 },
  alive: { type: 'boolean', default: true },
});

describe('entity ids', () => {
  it('packs a 20-bit index and a 12-bit generation', () => {
    const id = packEntity(5, 7);
    expect(entityIndex(id)).toBe(5);
    expect(entityGeneration(id)).toBe(7);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThanOrEqual(0xffffffff);

    const high = packEntity((1 << 20) - 1, GENERATION_MASK);
    expect(entityIndex(high)).toBe((1 << 20) - 1);
    expect(entityGeneration(high)).toBe(GENERATION_MASK);
    expect(nextGeneration(GENERATION_MASK)).toBe(1);
    expect(nextGeneration(0)).toBe(1);
  });

  it('recycles an index and rejects the stale id', () => {
    const world = createWorld();
    const first = world.create();
    world.add(first, Health, { hp: 4 });
    world.setVariable(first, 'score', 9);
    world.destroy(first);

    expect(world.isAlive(first)).toBe(false);
    expect(world.get(first, Health)).toBeUndefined();
    expect(world.has(first, Health)).toBe(false);
    expect(world.getField(first, Health, 'hp')).toBeUndefined();
    expect(world.getVariable(first, 'score')).toBeUndefined();
    expect(() => world.add(first, Health)).toThrow(EcsError);
    expect(() => world.set(first, Health, { hp: 1 })).toThrow(EcsError);
    expect(() => world.remove(first, Health)).toThrow(EcsError);
    expect(() => world.setField(first, Health, 'hp', 1)).toThrow(EcsError);
    expect(() => world.setVariable(first, 'score', 1)).toThrow(EcsError);
    world.destroy(first);

    const second = world.create();
    expect(second).not.toBe(first);
    expect(entityIndex(second)).toBe(entityIndex(first));
    expect(entityGeneration(second)).toBe(nextGeneration(entityGeneration(first)));
    expect(world.isAlive(first)).toBe(false);
    expect(world.isAlive(second)).toBe(true);
    expect(world.has(second, Health)).toBe(false);
    expect(world.getVariable(second, 'score')).toBeUndefined();
  });

  it('wraps the generation without issuing generation 0', () => {
    const world = createWorld();
    let entity = world.create();
    const first = entity;
    world.destroy(entity);
    entity = world.create();
    expect(world.isAlive(first)).toBe(false);

    for (let i = 1; i < GENERATION_MASK; i += 1) {
      world.destroy(entity);
      entity = world.create();
      expect(entityGeneration(entity)).not.toBe(0);
    }
    expect(entityIndex(entity)).toBe(entityIndex(first));
    expect(entity).toBe(first);
    expect(world.isAlive(entity)).toBe(true);
  });
});

describe('components', () => {
  it('defaults Transform to soa and other components to sparse', () => {
    expect(Transform.storage).toBe('soa');
    expect(resolveStorage('Transform')).toBe('soa');
    expect(resolveStorage('Transform', 'sparse')).toBe('sparse');
    expect(Health.storage).toBe('sparse');
    expect(Light.storage).toBe('sparse');
    expect(Light2D.storage).toBe('sparse');
    expect(Light.id).not.toBe(Light2D.id);
    expect(() => defineComponent('Health', { hp: { type: 'number' } })).toThrow(EcsError);
    expect(() =>
      defineComponent('Named', { label: { type: 'string' } }, { storage: 'soa' }),
    ).toThrow(EcsError);
  });

  it('adds, reads, replaces, and removes sparse and soa data', () => {
    const world = createWorld();
    const entity = world.create();
    expect(world.has(entity, Health)).toBe(false);
    world.add(entity, Health);
    expect(world.get(entity, Health)).toEqual({ hp: 0, alive: true });
    expect(() => world.add(entity, Health)).toThrow(EcsError);

    world.set(entity, Health, { hp: 3 });
    expect(world.get(entity, Health)).toEqual({ hp: 3, alive: true });
    world.add(entity, Transform, { position: [1, 2, 3] });
    expect(world.get(entity, Transform)).toEqual({
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });

    const copy = world.get(entity, Health);
    if (copy) copy.hp = 100;
    expect(world.get(entity, Health)?.hp).toBe(3);

    world.remove(entity, Health);
    expect(world.has(entity, Health)).toBe(false);
    world.remove(entity, Health);
    expect(world.has(entity, Transform)).toBe(true);
  });

  it('keeps soa rows intact when a middle entity is removed', () => {
    const world = createWorld();
    const a = world.create();
    const b = world.create();
    const c = world.create();
    world.add(a, Transform, { position: [1, 0, 0] });
    world.add(b, Transform, { position: [2, 0, 0] });
    world.add(c, Transform, { position: [3, 0, 0] });
    world.remove(b, Transform);
    expect(world.getField(a, Transform, 'position.x')).toBe(1);
    expect(world.getField(c, Transform, 'position.x')).toBe(3);
    expect(world.has(b, Transform)).toBe(false);
  });

  it('reads and writes one field with schema checks', () => {
    const world = createWorld();
    const entity = world.create();
    world.setField(entity, Transform, 'position.x', 4);
    expect(world.getField(entity, Transform, 'position.x')).toBe(4);
    expect(world.getField(entity, Transform, 'position.y')).toBe(0);
    expect(world.getField(entity, Transform, 'position')).toEqual([4, 0, 0]);

    world.setField(entity, Transform, 'position', { x: 8, y: 1, z: 2 });
    expect(world.getField(entity, 'Transform', 'position')).toEqual([8, 1, 2]);
    world.setField(entity, Light, 'color.r', 0.5);
    expect(world.get(entity, Light)).toMatchObject({ color: [0.5, 1, 1, 1], kind: 'point' });

    expect(() => world.setField(entity, Health, 'hp', Number.NaN)).toThrow(EcsError);
    expect(() => world.setField(entity, Transform, 'nope', 1)).toThrow(EcsError);
    expect(() => world.setField(entity, Light, 'radius', 2)).toThrow(EcsError);
    expect(() => world.set(entity, Transform, { position: [1, 2, 3], extra: true } as never)).toThrow(EcsError);

    world.add(entity, Light2D, { radius: 6 });
    expect(world.get(entity, Light2D)).toMatchObject({ radius: 6 });
    expect(world.get(entity, Light)).not.toHaveProperty('radius');
  });

  it('queries entities that have every requested component', () => {
    const world = createWorld();
    const lit = world.create();
    const plain = world.create();
    world.add(lit, Transform);
    world.add(lit, Light);
    world.add(plain, Transform);
    expect(world.query(Transform, Light).entities()).toEqual([lit]);
    expect(world.query().size()).toBe(2);
    const seen: number[] = [];
    for (const entity of world.query(Transform)) seen.push(entity);
    expect(seen).toEqual([lit, plain]);
  });
});

describe('variables', () => {
  it('stores named JSON values per entity', () => {
    const world = createWorld();
    const entity = world.create();
    const payload = { n: 1 };
    world.setVariable(entity, 'payload', payload);
    payload.n = 5;
    expect(world.getVariable(entity, 'payload')).toEqual({ n: 1 });
    expect(world.hasVariable(entity, 'payload')).toBe(true);
    world.setVariable(entity, 'payload', undefined);
    expect(world.hasVariable(entity, 'payload')).toBe(false);
    expect(() => world.setVariable(entity, 'fn', () => 1)).toThrow(EcsError);
  });
});

describe('scene, time, plugins, and render scene', () => {
  it('round-trips scene JSON and preserves dead-slot generations', () => {
    const world = createWorld();
    const parent = world.create();
    world.setName(parent, 'Parent');
    world.add(parent, Transform, { position: [1, 2, 3] });
    world.setVariable(parent, 'score', { n: 4 });
    const child = world.create();
    world.setName(child, 'Child');
    world.setParent(child, parent);
    world.destroy(child);

    const scene = world.toScene();
    const restored = createWorld();
    restored.loadScene(scene);
    expect(restored.isAlive(parent)).toBe(true);
    expect(restored.isAlive(child)).toBe(false);
    expect(restored.getName(parent)).toBe('Parent');
    expect(restored.getField(parent, Transform, 'position')).toEqual([1, 2, 3]);
    expect(restored.getVariable(parent, 'score')).toEqual({ n: 4 });

    const reused = restored.create();
    expect(entityIndex(reused)).toBe(entityIndex(child));
    expect(entityGeneration(reused)).toBe(nextGeneration(entityGeneration(child)));
    expect(restored.isAlive(child)).toBe(false);
    expect(restored.getName(reused)).toBe('');
  });

  it('ticks scaled time and runs a plugin once', () => {
    const world = createWorld();
    world.time.scale = 2;
    world.time.tick(0.25);
    expect(world.time.delta).toBe(0.5);
    expect(world.time.elapsed).toBe(0.5);
    expect(world.time.frame).toBe(1);

    let runs = 0;
    const plugin = { id: 'once', setup(): void { runs += 1; } };
    world.use(plugin).use(plugin);
    expect(runs).toBe(1);
  });

  it('emits create, component, and destroy events', () => {
    const world = createWorld();
    const seen: string[] = [];
    world.on('created', () => seen.push('created'));
    world.on('added', () => seen.push('added'));
    world.on('changed', () => seen.push('changed'));
    world.on('destroyed', () => seen.push('destroyed'));
    const entity = world.create();
    world.add(entity, Health, { hp: 1 });
    world.setField(entity, Health, 'hp', 2);
    world.destroy(entity);
    expect(seen).toEqual(['created', 'added', 'changed', 'destroyed']);
  });

  it('withoutHistory writes the world and leaves undo empty', () => {
    const world = createWorld();
    const entity = world.create();
    world.add(entity, Transform);
    world.clearHistory();
    world.withoutHistory(() => {
      world.setField(entity, Transform, 'position.x', 3);
    });
    expect(world.getField(entity, Transform, 'position.x')).toBe(3);
    expect(world.canUndo()).toBe(false);
    world.setField(entity, Transform, 'position.y', 4);
    expect(world.canUndo()).toBe(true);
    expect(world.undo()).toBe(true);
    expect(world.getField(entity, Transform, 'position.y')).toBe(0);
    expect(world.getField(entity, Transform, 'position.x')).toBe(3);
  });

  it('builds parallel render buffers from Transform and keeps Light2D separate', () => {
    const world = createWorld();
    const root = world.create();
    const child = world.create();
    const logic = world.create();
    world.add(root, Transform, { position: [10, 0, 0] });
    world.add(child, Transform, { position: [5, 0, 0] });
    world.add(child, Light2D, { radius: 2 });
    world.add(child, Light);
    world.setParent(child, root);

    const scene = world.renderScene();
    expect(scene.entities).toBeInstanceOf(Uint32Array);
    expect(scene.worldMatrices).toBeInstanceOf(Float32Array);
    expect(scene.dirty).toBeInstanceOf(Uint32Array);
    expect(scene.worldMatrices.length).toBe(scene.entities.length * 16);
    expect(scene.dirty.length).toBe(scene.entities.length);

    const rootIndex = indexOf(scene.entities, root);
    const childIndex = indexOf(scene.entities, child);
    const logicIndex = indexOf(scene.entities, logic);
    expect(scene.worldMatrices[rootIndex * 16 + 12]).toBeCloseTo(10);
    expect(scene.worldMatrices[childIndex * 16 + 12]).toBeCloseTo(15);
    expect(scene.dirty[childIndex]).toBe(1);
    expect(scene.worldMatrices[logicIndex * 16]).toBe(1);
    expect(scene.worldMatrices[logicIndex * 16 + 15]).toBe(1);

    const lights = scene.view(Light);
    const lights2d = scene.view('Light2D');
    expect(lights).toHaveLength(scene.entities.length);
    expect(lights[childIndex]).toMatchObject({ kind: 'point', intensity: 1 });
    expect(lights[childIndex]).not.toHaveProperty('radius');
    expect(lights2d[childIndex]).toMatchObject({ radius: 2 });
    expect(lights[rootIndex]).toBeUndefined();

    world.setField(child, Transform, 'position.y', 3);
    const changed = world.renderScene();
    expect(changed.dirty[childIndex]).toBe(1);
    expect(changed.dirty[rootIndex]).toBe(0);
    expect(changed.worldMatrices[childIndex * 16 + 13]).toBeCloseTo(3);

    world.setField(root, Transform, 'position.x', 1);
    const moved = world.renderScene();
    expect(moved.dirty[rootIndex]).toBe(1);
    expect(moved.dirty[childIndex]).toBe(1);
    expect(moved.worldMatrices[childIndex * 16 + 12]).toBeCloseTo(6);
    const clean = world.renderScene();
    expect(clean.dirty[childIndex]).toBe(0);
    expect(clean.dirty[rootIndex]).toBe(0);
  });

  it('rotates the X axis 90 degrees about Y', () => {
    const world = createWorld();
    const entity = world.create();
    const half = Math.SQRT1_2;
    world.add(entity, Transform, { rotation: [0, half, 0, half] });
    const scene = world.renderScene();
    const index = indexOf(scene.entities, entity);
    expect(scene.worldMatrices[index * 16]).toBeCloseTo(0);
    expect(scene.worldMatrices[index * 16 + 2]).toBeCloseTo(-1);
  });
});

describe('editor and script adapters', () => {
  it('matches the editor document: copies, reparent, one notification per edit', () => {
    const view = createEditorWorld();
    let notices = 0;
    view.subscribe(() => {
      notices += 1;
    });
    view.deserialize({
      entities: [
        { id: 'scene', name: 'Scene', parentId: null, components: {} },
        { id: 'camera', name: 'Camera', parentId: 'scene', components: { kind: 'camera' } },
        { id: 'player', name: 'Player', parentId: 'scene', components: { kind: 'node', health: -1 } },
      ],
    });
    expect(notices).toBe(1);
    expect(view.get('player')?.components).toEqual({ kind: 'node', health: -1 });
    expect(view.get('camera')?.parentId).toBe('scene');

    const leaked = view.get('player');
    if (leaked) leaked.name = 'Nope';
    expect(view.get('player')?.name).toBe('Player');

    view.update('player', { name: 'Hero', components: { kind: 'node', health: 2, Transform: { position: [1, 0, 0] } } });
    expect(view.ecs.getField(view.ecs.resolveAlias('player') ?? 0, Transform, 'position.x')).toBe(1);
    expect(view.get('player')?.components.health).toBe(2);

    view.remove('scene');
    expect(view.get('scene')).toBeUndefined();
    expect(view.get('player')?.parentId).toBeNull();
    expect(view.get('camera')?.parentId).toBeNull();
    view.remove('missing');
    view.update('missing', { name: 'x' });
    expect(() => view.add({ id: 'player', name: 'P', parentId: null, components: {} })).toThrow(/already exists/);
    expect(() => view.deserialize({ entities: [] } as never)).not.toThrow();
    expect(() => view.deserialize({ entities: [{ id: '', name: '', parentId: null, components: {} }] })).toThrow(
      /Invalid world snapshot/,
    );
  });

  it('serves visual-script component fields and entity variables', () => {
    const ecs = createWorld();
    const player = ecs.create();
    ecs.setAlias(player, 'player');
    const scripts = createScriptWorld(ecs, { id: 'player' });
    scripts.setComponent(scripts.self, 'Health', { hp: 3, alive: false });
    expect(scripts.getField(scripts.self, 'Health', 'hp')).toBe(3);
    expect(scripts.hasComponent(scripts.self, 'Health')).toBe(true);
    scripts.setVariable(scripts.self, 'hp', 3);
    expect(scripts.getVariable({ id: player }, 'hp')).toBe(3);

    scripts.setField({ id: 'player' }, 'Note', 'text', 'hi');
    expect(scripts.getComponent(scripts.self, 'Note')).toEqual({ text: 'hi' });

    ecs.destroy(player);
    expect(scripts.getComponent(scripts.self, 'Health')).toBeUndefined();
    expect(scripts.getVariable(scripts.self, 'hp')).toBeUndefined();
    expect(() => scripts.setField(scripts.self, 'Health', 'hp', 1)).toThrow(EcsError);

    const fresh = createScriptWorld(createWorld());
    fresh.setVariable(fresh.self, 'n', 1);
    expect(typeof fresh.self.id).toBe('number');
    expect((fresh.ecs as World).getVariable(fresh.self.id as number, 'n')).toBe(1);
  });
});

function indexOf(entities: Uint32Array, entity: number): number {
  return [...entities].indexOf(entity);
}
