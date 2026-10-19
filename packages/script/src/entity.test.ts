import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScriptWorld, createWorld, defineComponent } from '@jurfi/core';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { createBuiltinRegistry } from './builtins';
import { createScriptRuntime } from './runtime';
import { e, g, n } from './test/graph';
import type { EntityRef } from './world';

const Badge = defineComponent('Badge', {
  n: { type: 'number', default: 1 },
});

const registry = createBuiltinRegistry();
const here = fileURLToPath(new URL('.', import.meta.url));

function refId(value: unknown): number {
  if (value && typeof value === 'object' && 'id' in value && typeof (value as EntityRef).id === 'number') {
    return (value as EntityRef).id as number;
  }
  throw new Error('expected an entity ref');
}

function markerGraph() {
  return g(
    [
      n('start', 'core/OnStart'),
      n('spawn', 'core/SpawnEntity'),
      n('add', 'core/AddComponent', { props: { component: 'Marker' }, pins: { value: true } }),
      n('save', 'core/SetVariable', { props: { name: 'spawned' } }),
      n('has', 'core/HasComponent', { props: { component: 'Marker' } }),
      n('seen', 'core/SetVariable', { props: { name: 'seen' } }),
      n('query', 'core/Query', { props: { components: ['Marker'] } }),
      n('each', 'core/ForEach'),
      n('get', 'core/GetVariable', { props: { name: 'hits' } }),
      n('addn', 'core/Add', { pins: { b: 1 } }),
      n('set', 'core/SetVariable', { props: { name: 'hits' } }),
      n('destroy', 'core/DestroyEntity'),
      n('has2', 'core/HasComponent', { props: { component: 'Marker' } }),
      n('gone', 'core/SetVariable', { props: { name: 'gone' } }),
    ],
    [
      e('start', 'then', 'spawn', 'exec'),
      e('spawn', 'then', 'add', 'exec'),
      e('spawn', 'entity', 'add', 'entity'),
      e('add', 'then', 'save', 'exec'),
      e('spawn', 'entity', 'save', 'value'),
      e('save', 'then', 'seen', 'exec'),
      e('has', 'result', 'seen', 'value'),
      e('spawn', 'entity', 'has', 'entity'),
      e('seen', 'then', 'each', 'exec'),
      e('query', 'entities', 'each', 'entities'),
      e('each', 'body', 'set', 'exec'),
      e('get', 'value', 'addn', 'a'),
      e('addn', 'result', 'set', 'value'),
      e('each', 'completed', 'destroy', 'exec'),
      e('spawn', 'entity', 'destroy', 'entity'),
      e('destroy', 'then', 'gone', 'exec'),
      e('has2', 'result', 'gone', 'value'),
      e('spawn', 'entity', 'has2', 'entity'),
    ],
  );
}

describe('entity nodes on the core world', () => {
  it('spawns, queries, iterates, and destroys', () => {
    const ecs = createWorld();
    const world = createScriptWorld(ecs);
    const runtime = createScriptRuntime({ world });
    const loaded = runtime.load(markerGraph());
    expect(loaded.ok).toBe(true);
    runtime.start();
    const id = refId(runtime.getVariable('spawned'));
    expect(runtime.getVariable('seen')).toBe(true);
    expect(runtime.getVariable('hits')).toBe(1);
    expect(runtime.getVariable('gone')).toBe(false);
    expect(ecs.isAlive(id)).toBe(false);
    expect(ecs.has(id, 'Marker')).toBe(false);
    expect(world.ecs).toBe(ecs);
  });

  it('queries a component set and removes a component', () => {
    const ecs = createWorld();
    const runtime = createScriptRuntime({ world: createScriptWorld(ecs) });
    runtime.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('seq', 'core/Sequence', { props: { count: 2 } }),
          n('spawnA', 'core/SpawnEntity'),
          n('markA', 'core/AddComponent', { props: { component: 'Marker' }, pins: { value: true } }),
          n('spawnB', 'core/SpawnEntity'),
          n('markB', 'core/AddComponent', { props: { component: 'Marker' }, pins: { value: true } }),
          n('extra', 'core/AddComponent', { props: { component: 'Extra' }, pins: { value: 1 } }),
          n('query', 'core/Query', { props: { components: 'Marker, Extra' } }),
          n('each', 'core/ForEach'),
          n('get', 'core/GetVariable', { props: { name: 'hits' } }),
          n('addn', 'core/Add', { pins: { b: 1 } }),
          n('set', 'core/SetVariable', { props: { name: 'hits' } }),
          n('save', 'core/SetVariable', { props: { name: 'found' } }),
        ],
        [
          e('start', 'then', 'seq', 'exec'),
          e('seq', 'then0', 'spawnA', 'exec'),
          e('spawnA', 'then', 'markA', 'exec'),
          e('spawnA', 'entity', 'markA', 'entity'),
          e('seq', 'then1', 'spawnB', 'exec'),
          e('spawnB', 'then', 'markB', 'exec'),
          e('spawnB', 'entity', 'markB', 'entity'),
          e('markB', 'then', 'extra', 'exec'),
          e('spawnB', 'entity', 'extra', 'entity'),
          e('extra', 'then', 'each', 'exec'),
          e('query', 'entities', 'each', 'entities'),
          e('each', 'body', 'set', 'exec'),
          e('get', 'value', 'addn', 'a'),
          e('addn', 'result', 'set', 'value'),
          e('each', 'entity', 'save', 'value'),
          e('set', 'then', 'save', 'exec'),
        ],
      ),
    );
    runtime.start();
    expect(runtime.getVariable('hits')).toBe(1);
    const found = refId(runtime.getVariable('found'));
    expect(ecs.has(found, 'Marker')).toBe(true);
    expect(ecs.has(found, 'Extra')).toBe(true);
    expect(ecs.query('Marker').size()).toBe(2);

    const removed = createScriptRuntime({ world: createScriptWorld(ecs) });
    removed.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('spawn', 'core/SpawnEntity'),
          n('add', 'core/AddComponent', { props: { component: 'Marker' }, pins: { value: true } }),
          n('drop', 'core/RemoveComponent', { props: { component: 'Marker' } }),
          n('has', 'core/HasComponent', { props: { component: 'Marker' } }),
          n('save', 'core/SetVariable', { props: { name: 'still' } }),
          n('id', 'core/SetVariable', { props: { name: 'id' } }),
        ],
        [
          e('start', 'then', 'spawn', 'exec'),
          e('spawn', 'then', 'add', 'exec'),
          e('spawn', 'entity', 'add', 'entity'),
          e('add', 'then', 'drop', 'exec'),
          e('spawn', 'entity', 'drop', 'entity'),
          e('drop', 'then', 'save', 'exec'),
          e('has', 'result', 'save', 'value'),
          e('spawn', 'entity', 'has', 'entity'),
          e('spawn', 'entity', 'id', 'value'),
          e('save', 'then', 'id', 'exec'),
        ],
      ),
    );
    removed.start();
    const id = refId(removed.getVariable('id'));
    expect(removed.getVariable('still')).toBe(false);
    expect(ecs.isAlive(id)).toBe(true);
    expect(ecs.has(id, 'Marker')).toBe(false);
  });

  it('adds a schema component from its default and reports a duplicate add', () => {
    const ecs = createWorld();
    const runtime = createScriptRuntime({ world: createScriptWorld(ecs) });
    runtime.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('spawn', 'core/SpawnEntity'),
          n('add', 'core/AddComponent', { props: { component: 'Badge' } }),
          n('save', 'core/SetVariable', { props: { name: 'id' } }),
        ],
        [
          e('start', 'then', 'spawn', 'exec'),
          e('spawn', 'then', 'add', 'exec'),
          e('spawn', 'entity', 'add', 'entity'),
          e('add', 'then', 'save', 'exec'),
          e('spawn', 'entity', 'save', 'value'),
        ],
      ),
    );
    runtime.start();
    expect(ecs.get(refId(runtime.getVariable('id')), Badge)).toEqual({ n: 1 });

    const again = createScriptRuntime({ world: createScriptWorld(ecs) });
    again.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('spawn', 'core/SpawnEntity'),
          n('add', 'core/AddComponent', { props: { component: 'Marker' }, pins: { value: true } }),
          n('add2', 'core/AddComponent', { props: { component: 'Marker' }, pins: { value: false } }),
        ],
        [
          e('start', 'then', 'spawn', 'exec'),
          e('spawn', 'then', 'add', 'exec'),
          e('spawn', 'entity', 'add', 'entity'),
          e('add', 'then', 'add2', 'exec'),
          e('spawn', 'entity', 'add2', 'entity'),
        ],
      ),
    );
    expect(() => again.start()).not.toThrow();
    expect(again.running).toBe(true);
    expect(again.nodeErrors.some((fault) => fault.nodeId === 'add2')).toBe(true);
  });

  it('rejects a query with no component set', () => {
    const empty = compile(g([n('query', 'core/Query')], []), registry);
    expect(empty.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-prop', nodeId: 'query' }),
    );
    const blank = compile(g([n('query', 'core/Query', { props: { components: [] } })], []), registry);
    expect(blank.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-prop', nodeId: 'query' }),
    );
  });

  it('runs the compiled host against the same core world', async () => {
    const compiled = compile(markerGraph(), registry);
    expect(compiled.ok).toBe(true);
    const removed = compile(
      g(
        [
          n('start', 'core/OnStart'),
          n('spawn', 'core/SpawnEntity'),
          n('add', 'core/AddComponent', { props: { component: 'Marker' }, pins: { value: true } }),
          n('drop', 'core/RemoveComponent', { props: { component: 'Marker' } }),
          n('has', 'core/HasComponent', { props: { component: 'Marker' } }),
          n('save', 'core/SetVariable', { props: { name: 'still' } }),
          n('id', 'core/SetVariable', { props: { name: 'id' } }),
        ],
        [
          e('start', 'then', 'spawn', 'exec'),
          e('spawn', 'then', 'add', 'exec'),
          e('spawn', 'entity', 'add', 'entity'),
          e('add', 'then', 'drop', 'exec'),
          e('spawn', 'entity', 'drop', 'entity'),
          e('drop', 'then', 'save', 'exec'),
          e('has', 'result', 'save', 'value'),
          e('spawn', 'entity', 'has', 'entity'),
          e('spawn', 'entity', 'id', 'value'),
          e('save', 'then', 'id', 'exec'),
        ],
      ),
      registry,
    );
    expect(removed.ok).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'jurfi-entity-'));
    writeFileSync(join(dir, 'marker.js'), compiled.source);
    writeFileSync(join(dir, 'removed.js'), removed.source);
    const coreEntry = join(here, '../../core/src/index.ts');
    writeFileSync(
      join(dir, 'entry.js'),
      [
        `import { createScriptWorld, createWorld } from ${JSON.stringify(coreEntry)};`,
        `import { createRuntime as markerRuntime } from './marker.js';`,
        `import { createRuntime as removedRuntime } from './removed.js';`,
        'const ecs = createWorld();',
        'const marker = markerRuntime({ world: createScriptWorld(ecs) });',
        'marker.start();',
        'const spawned = marker.getVariable("spawned");',
        'const removed = removedRuntime({ world: createScriptWorld(ecs) });',
        'removed.start();',
        'const id = removed.getVariable("id");',
        'process.stdout.write(JSON.stringify({',
        '  hits: marker.getVariable("hits"),',
        '  seen: marker.getVariable("seen"),',
        '  gone: marker.getVariable("gone"),',
        '  alive: ecs.isAlive(spawned.id),',
        '  still: removed.getVariable("still"),',
        '  removedAlive: ecs.isAlive(id.id),',
        '  removedHas: ecs.has(id.id, "Marker"),',
        '}));',
        '',
      ].join('\n'),
    );
    const outfile = join(dir, 'bundle.mjs');
    await esbuild.build({
      entryPoints: [join(dir, 'entry.js')],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'node',
      outfile,
      alias: { '@jurfi/script/host': join(here, 'host.ts'), '@jurfi/core': coreEntry },
      logLevel: 'silent',
    });
    const text = readFileSync(outfile, 'utf8');
    expect(text).not.toContain('JURFI_INTERPRETER_RUNTIME');
    const run = spawnSync(process.execPath, [outfile], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      hits: 1,
      seen: true,
      gone: false,
      alive: false,
      still: false,
      removedAlive: true,
      removedHas: false,
    });
  });
});
