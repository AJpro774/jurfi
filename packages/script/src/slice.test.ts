import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from './builtins';
import { compile } from './compile';
import { defineScript } from './scripts';
import { paletteGaps, paletteNodes } from './palette';
import { createNodeRegistry } from './registry';
import { createScriptRuntime } from './runtime';
import { e, g, n } from './test/graph';

const here = fileURLToPath(new URL('.', import.meta.url));
const hostEntry = join(here, 'host.ts');
const worldEntry = join(here, 'world.ts');
const runtimeEntry = join(here, 'runtime.ts');
const coreEntry = join(here, '../../core/src/index.ts');

const spin = defineScript({
  typeId: 'game/Spin',
  category: 'game',
  doc: 'Adds dt to angle, then continues.',
  run(ctx) {
    ctx.setVariable('angle', ctx.num(ctx.getVariable('angle')) + ctx.dt);
  },
});

const double = defineScript({
  typeId: 'game/Double',
  category: 'game',
  doc: 'Doubles a number.',
  pure: true,
  pins: [
    { name: 'value', kind: 'data', direction: 'in', dataType: 'number' },
    { name: 'result', kind: 'data', direction: 'out', dataType: 'number' },
  ],
  value(ctx, pin) {
    return pin === 'result' ? ctx.num(ctx.read('value')) * 2 : undefined;
  },
});

const boom = defineScript({
  typeId: 'game/Boom',
  category: 'game',
  doc: 'Throws.',
  run() {
    throw new Error('boom');
  },
});

const hidden = defineScript({
  typeId: 'game/HiddenSpin',
  category: 'game',
  doc: 'Not shown in the palette.',
  hidden: true,
});

function scriptRegistry() {
  const registry = createBuiltinRegistry();
  spin.register(registry);
  double.register(registry);
  boom.register(registry);
  hidden.register(registry);
  return registry;
}

describe('hot reload', () => {
  it('swaps the program and keeps variables without replaying OnStart', () => {
    const registry = createBuiltinRegistry();
    const rt = createScriptRuntime({ registry });
    const loaded = rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('score', 'core/SetVariable', { props: { name: 'score' }, pins: { value: 5 } }),
          n('upd', 'core/OnUpdate'),
          n('mode', 'core/SetVariable', { props: { name: 'mode' }, pins: { value: 'a' } }),
        ],
        [e('start', 'then', 'score', 'exec'), e('upd', 'then', 'mode', 'exec')],
      ),
    );
    expect(loaded.ok).toBe(true);
    rt.start();
    expect(rt.getVariable('score')).toBe(5);
    rt.setVariable('kept', 1);

    const next = rt.reload(
      g(
        [
          n('start', 'core/OnStart'),
          n('score', 'core/SetVariable', { props: { name: 'score' }, pins: { value: 0 } }),
          n('upd', 'core/OnUpdate'),
          n('mode', 'core/SetVariable', { props: { name: 'mode' }, pins: { value: 'b' } }),
        ],
        [e('start', 'then', 'score', 'exec'), e('upd', 'then', 'mode', 'exec')],
      ),
    );
    expect(next.ok).toBe(true);
    expect(rt.running).toBe(true);
    expect(rt.getVariable('score')).toBe(5);
    expect(rt.getVariable('kept')).toBe(1);
    rt.tick(0.016);
    expect(rt.getVariable('mode')).toBe('b');
    expect(rt.getVariable('score')).toBe(5);

    const failed = rt.reload({ version: 2, nodes: [], edges: [] });
    expect(failed.ok).toBe(false);
    expect(rt.getVariable('score')).toBe(5);
    expect(rt.getVariable('kept')).toBe(1);
    rt.tick(0.016);
    expect(rt.getVariable('mode')).toBe('b');
  });

  it('reloads a 500-node graph in under a second', () => {
    const nodes = [n('start', 'core/OnStart')];
    const edges = [];
    for (let i = 0; i < 500; i += 1) {
      nodes.push(n(`s${i}`, 'core/SetVariable', { props: { name: `k${i}` }, pins: { value: i } }));
      edges.push(e(i === 0 ? 'start' : `s${i - 1}`, 'then', `s${i}`, 'exec'));
    }
    const doc = g(nodes, edges);
    const rt = createScriptRuntime();
    expect(rt.load(doc).ok).toBe(true);
    rt.start();
    rt.setVariable('kept', 1);
    const started = performance.now();
    const result = rt.reload(doc);
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(1000);
    expect(rt.getVariable('kept')).toBe(1);
    expect(rt.running).toBe(true);
  });
});

describe('node faults', () => {
  it('reports the throwing node and keeps Play mode running', () => {
    const registry = scriptRegistry();
    const seen: string[] = [];
    const rt = createScriptRuntime({
      registry,
      onNodeError(fault) {
        seen.push(fault.nodeId);
      },
    });
    const loaded = rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('seq', 'core/Sequence'),
          n('boom', 'game/Boom'),
          n('ok', 'core/SetVariable', { props: { name: 'ok' }, pins: { value: true } }),
          n('upd', 'core/OnUpdate'),
          n('ticks', 'core/SetVariable', { props: { name: 'ticks' }, pins: { value: 1 } }),
        ],
        [
          e('start', 'then', 'seq', 'exec'),
          e('seq', 'then0', 'boom', 'exec'),
          e('seq', 'then1', 'ok', 'exec'),
          e('upd', 'then', 'ticks', 'exec'),
        ],
      ),
    );
    expect(loaded.ok).toBe(true);
    expect(loaded.diagnostics.some((diag) => diag.code === 'unimplemented-node')).toBe(false);
    expect(() => rt.start()).not.toThrow();
    expect(rt.running).toBe(true);
    expect(rt.getVariable('ok')).toBe(true);
    expect(rt.nodeErrors.map((fault) => fault.nodeId)).toContain('boom');
    expect(rt.nodeErrors.find((fault) => fault.nodeId === 'boom')?.message).toContain('boom');
    expect(seen).toContain('boom');
    rt.tick(0.016);
    expect(rt.getVariable('ticks')).toBe(1);
    expect(rt.running).toBe(true);
  });
});

describe('defineScript and palette', () => {
  it('runs plain scripts and custom nodes and lists them in the palette', () => {
    const registry = scriptRegistry();
    const rt = createScriptRuntime({ registry });
    const loaded = rt.load(
      g(
        [
          n('start', 'core/OnStart'),
          n('spin', 'game/Spin'),
          n('mark', 'core/SetVariable', { props: { name: 'started' }, pins: { value: true } }),
          n('double', 'game/Double', { pins: { value: 4 } }),
          n('out', 'core/SetVariable', { props: { name: 'doubled' } }),
          n('upd', 'core/OnUpdate'),
        ],
        [
          e('start', 'then', 'spin', 'exec'),
          e('spin', 'then', 'mark', 'exec'),
          e('double', 'result', 'out', 'value'),
          e('mark', 'then', 'out', 'exec'),
          e('upd', 'then', 'spin', 'exec'),
        ],
      ),
    );
    expect(loaded.ok).toBe(true);
    rt.start();
    expect(rt.getVariable('started')).toBe(true);
    expect(rt.getVariable('doubled')).toBe(8);
    expect(rt.getVariable('angle')).toBe(0);
    rt.tick(0.5);
    expect(rt.getVariable('angle')).toBe(0.5);

    const ids = paletteNodes(registry).map((def) => def.typeId);
    expect(ids).toContain('game/Spin');
    expect(ids).toContain('game/Double');
    expect(ids).not.toContain('game/HiddenSpin');
    expect(paletteGaps(createBuiltinRegistry())).toEqual([]);
    expect(paletteGaps(registry)).toEqual([]);
  });

  it('flags a visible node with no handler and ignores hidden ones', () => {
    const registry = createNodeRegistry();
    registry.register({
      typeId: 'test/Visible',
      category: 'test',
      doc: 'No handler.',
      pins: [
        { name: 'exec', kind: 'exec', direction: 'in' },
        { name: 'then', kind: 'exec', direction: 'out' },
      ],
    });
    defineScript({
      typeId: 'test/Shelf',
      hidden: true,
      doc: 'Unfinished.',
    }).register(registry);
    expect(paletteNodes(registry).map((def) => def.typeId)).toEqual(['test/Visible']);
    expect(paletteGaps(registry)).toEqual([{ typeId: 'test/Visible', reason: 'missing-handler' }]);
    expect(() => defineScript({ typeId: 'test/NeedsABody' })).toThrow(/hidden/);
  });
});

describe('compiled bundle', () => {
  it('runs the compiled host, omits the interpreter, and records bundle sizes', async () => {
    const registry = createBuiltinRegistry();
    const health = compile(
      g(
        [
          n('start', 'core/OnStart'),
          n('branch', 'core/Branch', { pins: { condition: true } }),
          n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 10 } }),
        ],
        [e('start', 'then', 'branch', 'exec'), e('branch', 'true', 'set', 'exec')],
      ),
      registry,
    );
    expect(health.ok).toBe(true);

    const events = compile(
      g(
        [
          n('start', 'core/OnStart'),
          n('fire', 'core/FireEvent', { props: { event: 'ping' }, pins: { payload: 5 } }),
          n('get', 'core/GetVariable', { props: { name: 'seen' } }),
          n('after', 'core/SetVariable', { props: { name: 'after' } }),
          n('on', 'core/OnEvent', { props: { event: 'ping' } }),
          n('mark', 'core/SetVariable', { props: { name: 'seen' } }),
          n('zero', 'core/SetVariable', { props: { name: 'sum' }, pins: { value: 0 } }),
          n('loop', 'core/ForLoop', { pins: { first: 1, last: 3 } }),
          n('sumGet', 'core/GetVariable', { props: { name: 'sum' } }),
          n('add', 'core/Add'),
          n('acc', 'core/SetVariable', { props: { name: 'sum' } }),
        ],
        [
          e('start', 'then', 'fire', 'exec'),
          e('fire', 'then', 'after', 'exec'),
          e('get', 'value', 'after', 'value'),
          e('on', 'then', 'mark', 'exec'),
          e('on', 'payload', 'mark', 'value'),
          e('after', 'then', 'zero', 'exec'),
          e('zero', 'then', 'loop', 'exec'),
          e('loop', 'body', 'acc', 'exec'),
          e('sumGet', 'value', 'add', 'a'),
          e('loop', 'index', 'add', 'b'),
          e('add', 'result', 'acc', 'value'),
        ],
      ),
      registry,
    );
    expect(events.ok).toBe(true);

    const nested = compile(
      g(
        [n('start', 'core/OnStart'), n('sub', 'core/Subgraph', { props: { graph: 'addHp' } })],
        [e('start', 'then', 'sub', 'exec')],
        {
          subgraphs: {
            addHp: g(
              [
                n('start', 'core/OnStart'),
                n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 1 } }),
              ],
              [e('start', 'then', 'set', 'exec')],
            ),
          },
        },
      ),
      registry,
    );
    expect(nested.ok).toBe(true);

    const delayed = compile(
      g(
        [
          n('start', 'core/OnStart'),
          n('wait', 'core/Delay', { pins: { seconds: 2 } }),
          n('set', 'core/SetComponent', { props: { component: 'Ready' }, pins: { value: true } }),
        ],
        [e('start', 'then', 'wait', 'exec'), e('wait', 'then', 'set', 'exec')],
      ),
      registry,
    );
    expect(delayed.ok).toBe(true);

    const spun = compile(
      g(
        [
          n('start', 'core/OnStart'),
          n('spin', 'game/Spin'),
          n('mark', 'core/SetVariable', { props: { name: 'flag' }, pins: { value: true } }),
        ],
        [e('start', 'then', 'spin', 'exec'), e('spin', 'then', 'mark', 'exec')],
      ),
      scriptRegistry(),
    );
    expect(spun.ok).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'jurfi-script-'));
    writeFileSync(join(dir, 'health.js'), health.source);
    writeFileSync(join(dir, 'events.js'), events.source);
    writeFileSync(join(dir, 'nested.js'), nested.source);
    writeFileSync(join(dir, 'delay.js'), delayed.source);
    writeFileSync(join(dir, 'spin.js'), spun.source);
    writeFileSync(
      join(dir, 'health-entry.js'),
      [
        `import { createRuntime } from './health.js';`,
        `import { createMemoryWorld } from ${JSON.stringify(worldEntry)};`,
        'const world = createMemoryWorld();',
        'const runtime = createRuntime({ world });',
        'runtime.start();',
        'process.stdout.write(JSON.stringify({ health: world.getComponent(world.self, "Health") }));',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'behavior-entry.js'),
      [
        `import { defineScript } from ${JSON.stringify(hostEntry)};`,
        `import { createRuntime as eventsRuntime } from './events.js';`,
        `import { createRuntime as nestedRuntime } from './nested.js';`,
        `import { createRuntime as delayRuntime } from './delay.js';`,
        `import { createRuntime as spinRuntime } from './spin.js';`,
        `import { createMemoryWorld } from ${JSON.stringify(worldEntry)};`,
        'defineScript({',
        "  typeId: 'game/Spin',",
        '  run(ctx) { ctx.setVariable("angle", ctx.num(ctx.getVariable("angle")) + 1); },',
        '});',
        'const events = eventsRuntime({});',
        'events.start();',
        'const seen = events.getVariable("seen");',
        'const after = events.getVariable("after");',
        'events.emit("ping", 7);',
        'const world = createMemoryWorld();',
        'const nested = nestedRuntime({ world });',
        'nested.start();',
        'const delayWorld = createMemoryWorld();',
        'const delayed = delayRuntime({ world: delayWorld });',
        'delayed.start();',
        'const before = delayWorld.getComponent(delayWorld.self, "Ready") === true;',
        'delayed.tick(1);',
        'const mid = delayWorld.getComponent(delayWorld.self, "Ready") === true;',
        'delayed.tick(1);',
        'const done = delayWorld.getComponent(delayWorld.self, "Ready") === true;',
        'const spun = spinRuntime({});',
        'spun.start();',
        'process.stdout.write(JSON.stringify({',
        '  seen, after, seenAfter: events.getVariable("seen"), sum: events.getVariable("sum"),',
        '  nested: world.getComponent(world.self, "Health"),',
        '  before, mid, done,',
        '  angle: spun.getVariable("angle"), flag: spun.getVariable("flag"),',
        '}));',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'interp-entry.js'),
      [
        `import { createScriptRuntime, interpreterBuild } from ${JSON.stringify(runtimeEntry)};`,
        'globalThis.__jurfiInterpreter = interpreterBuild();',
        'globalThis.__jurfiRuntime = createScriptRuntime();',
        '',
      ].join('\n'),
    );

    const alias = {
      '@jurfi/script/host': hostEntry,
      '@jurfi/core': coreEntry,
    };
    const healthOut = join(dir, 'health.mjs');
    const behaviorOut = join(dir, 'behavior.mjs');
    const interpOut = join(dir, 'interp.mjs');
    await esbuild.build({
      entryPoints: [join(dir, 'health-entry.js')],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'node',
      outfile: healthOut,
      alias,
      logLevel: 'silent',
    });
    await esbuild.build({
      entryPoints: [join(dir, 'behavior-entry.js')],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'node',
      outfile: behaviorOut,
      alias,
      logLevel: 'silent',
    });
    await esbuild.build({
      entryPoints: [join(dir, 'interp-entry.js')],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'node',
      outfile: interpOut,
      alias,
      logLevel: 'silent',
    });

    const healthText = readFileSync(healthOut);
    const interpText = readFileSync(interpOut);
    const compiledBytes = healthText.byteLength;
    const interpreterBytes = interpText.byteLength;
    console.info(`compiled+host ${compiledBytes} interpreter ${interpreterBytes}`);
    expect(healthText.toString()).not.toContain('JURFI_INTERPRETER_RUNTIME');
    expect(interpText.toString()).toContain('JURFI_INTERPRETER_RUNTIME');
    expect(compiledBytes).toBeLessThan(interpreterBytes);

    const healthRun = spawnSync(process.execPath, [healthOut], { encoding: 'utf8' });
    expect(healthRun.stderr).toBe('');
    expect(healthRun.status).toBe(0);
    expect(JSON.parse(healthRun.stdout)).toEqual({ health: 10 });

    const behaviorRun = spawnSync(process.execPath, [behaviorOut], { encoding: 'utf8' });
    expect(behaviorRun.stderr).toBe('');
    expect(behaviorRun.status).toBe(0);
    expect(JSON.parse(behaviorRun.stdout)).toEqual({
      seen: 5,
      after: 5,
      seenAfter: 7,
      sum: 6,
      nested: 1,
      before: false,
      mid: false,
      done: true,
      angle: 1,
      flag: true,
    });
  });
});
