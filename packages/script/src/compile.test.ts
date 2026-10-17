import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { createBuiltinRegistry, registerBuiltinNodes } from './builtins';
import type { CompileResult } from './ir';
import { createNodeRegistry, type NodeRegistry } from './registry';
import { e, g, n } from './test/graph';

const registry = createBuiltinRegistry();

function errorCodes(result: CompileResult): string[] {
  return result.diagnostics.filter((diag) => diag.severity === 'error').map((diag) => diag.code);
}

function programJson(source: string): unknown {
  const header = 'export const program = ';
  const start = source.indexOf(header);
  const end = source.indexOf('\n\nexport function createRuntime');
  if (start < 0 || end < 0) throw new Error('emitted source has no program');
  return JSON.parse(source.slice(start + header.length, end).replace(/;\s*$/, ''));
}

describe('compile', () => {
  it('compiles OnStart → Branch → SetComponent and ignores editor data', () => {
    const doc = g(
      [
        n('start', 'core/OnStart', { pos: { x: 0, y: 0 } }),
        n('branch', 'core/Branch', { pins: { condition: true }, pos: { x: 160, y: 0 } }),
        n('set', 'core/SetComponent', {
          props: { component: 'Health' },
          pins: { value: { value: 10 } },
          pos: { x: 320, y: 0 },
        }),
      ],
      [e('start', 'then', 'branch', 'exec'), e('branch', 'true', 'set', 'exec')],
      { groups: [{ id: 'g', title: 'EDITOR_ONLY_NOTE' }], comments: [{ id: 'c', text: 'EDITOR_ONLY_NOTE' }] },
    );

    const result = compile(doc, registry);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.program?.entries.start).toEqual(['start']);
    expect(result.program?.nodes.branch?.dataIn.condition).toEqual({ kind: 'literal', value: true });
    expect(result.program?.nodes.set?.execOut).toEqual({});
    expect(JSON.stringify(result.program)).not.toContain('EDITOR_ONLY_NOTE');
    expect(result.source).not.toContain('from "@jurfi/editor"');
    expect(result.source).toContain('from "@jurfi/script"');
    expect(result.source).not.toContain('@jurfi/core');
    expect(programJson(result.source)).toEqual(result.program);
    expect(doc.nodes[0]?.pos).toEqual({ x: 0, y: 0 });
  });

  it('reports type mismatches, missing links, and data cycles by node id', () => {
    const mismatch = compile(
      g(
        [n('cmp', 'core/Greater', { pins: { a: 3, b: 1 } }), n('add', 'core/Add')],
        [e('cmp', 'result', 'add', 'a')],
      ),
      registry,
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatch.program).toBeNull();
    expect(mismatch.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'type-mismatch', nodeId: 'add', pin: 'a', severity: 'error' }),
    );

    const missing = compile(g([n('branch', 'core/Branch')], []), registry);
    expect(errorCodes(missing)).toContain('missing-link');
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-link', nodeId: 'branch', pin: 'condition' }),
    );

    const cycle = compile(
      g(
        [n('a', 'core/Add'), n('b', 'core/Add')],
        [e('a', 'result', 'b', 'a'), e('b', 'result', 'a', 'a')],
      ),
      registry,
    );
    expect(cycle.ok).toBe(false);
    const cycleIds = cycle.diagnostics
      .filter((diag) => diag.code === 'data-cycle')
      .map((diag) => diag.nodeId)
      .sort();
    expect(cycleIds).toEqual(['a', 'b']);
  });

  it('rejects exec cycles, kind mismatches, unknown types, and bad versions', () => {
    const execCycle = compile(
      g([n('branch', 'core/Branch', { pins: { condition: true } })], [e('branch', 'true', 'branch', 'exec')]),
      registry,
    );
    expect(execCycle.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'exec-cycle', nodeId: 'branch' }),
    );

    const kinds = compile(
      g(
        [n('add', 'core/Add'), n('branch', 'core/Branch', { pins: { condition: true } })],
        [e('add', 'result', 'branch', 'exec')],
      ),
      registry,
    );
    expect(kinds.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'pin-kind-mismatch', nodeId: 'branch', pin: 'exec' }),
    );

    const direction = compile(
      g(
        [n('branch', 'core/Branch', { pins: { condition: true } }), n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 1 } })],
        [e('branch', 'exec', 'set', 'exec')],
      ),
      registry,
    );
    expect(direction.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-direction', nodeId: 'branch' }),
    );

    const unknown = compile(g([n('x', 'core/Nope')], []), registry);
    expect(unknown.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unknown-node-type', nodeId: 'x' }),
    );

    const duplicate = compile(
      g([n('a', 'core/OnStart'), n('a', 'core/OnStart')], []),
      registry,
    );
    expect(duplicate.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'duplicate-node-id', nodeId: 'a' }),
    );

    const version = compile({ version: 2, nodes: [], edges: [] }, registry);
    expect(version.ok).toBe(false);
    expect(version.diagnostics[0]?.code).toBe('unsupported-version');

    const missingNode = compile(
      g([n('start', 'core/OnStart')], [e('start', 'then', 'gone', 'exec')]),
      registry,
    );
    expect(missingNode.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-node', nodeId: 'start' }),
    );
  });

  it('warns for registered nodes that have no runtime handler and still returns a program', () => {
    const custom = registerBuiltinNodes(createNodeRegistry());
    custom.register({
      typeId: 'test/Pass',
      category: 'test',
      doc: 'Passes execution through.',
      pins: [
        { name: 'exec', kind: 'exec', direction: 'in' },
        { name: 'then', kind: 'exec', direction: 'out' },
      ],
    });
    const result = compile(
      g(
        [
          n('start', 'core/OnStart'),
          n('pass', 'test/Pass'),
          n('set', 'core/SetComponent', { props: { component: 'Health' }, pins: { value: 1 } }),
        ],
        [e('start', 'then', 'pass', 'exec'), e('pass', 'then', 'set', 'exec')],
      ),
      custom,
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unimplemented-node', severity: 'warning', nodeId: 'pass' }),
    );
  });

  it('imports @jurfi/core only when the graph uses Clamp', () => {
    const result = compile(
      g(
        [
          n('start', 'core/OnStart'),
          n('clamp', 'core/Clamp', { pins: { value: 5, min: 0, max: 1 } }),
          n('set', 'core/SetVariable', { props: { name: 'out' } }),
        ],
        [e('start', 'then', 'set', 'exec'), e('clamp', 'result', 'set', 'value')],
      ),
      registry,
    );
    expect(result.ok).toBe(true);
    expect(result.source).toContain('from "@jurfi/core"');
    expect(result.source).toContain('export { clamp }');
    expect(result.source).not.toContain('from "@jurfi/editor"');
  });

  it('typechecks nested subgraph references', () => {
    const missing = compile(
      g([n('sub', 'core/Subgraph', { props: { graph: 'nope' } })], []),
      registry,
    );
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unknown-subgraph', nodeId: 'sub' }),
    );

    const ok = compile(
      g(
        [n('start', 'core/OnStart'), n('sub', 'core/Subgraph', { props: { graph: 'inner' } })],
        [e('start', 'then', 'sub', 'exec')],
        {
          subgraphs: {
            inner: g([n('start', 'core/OnStart')], []),
          },
        },
      ),
      registry,
    );
    expect(ok.ok).toBe(true);
    expect(ok.program?.subgraphs.inner?.entries.start).toEqual(['start']);
  });
});

describe('registry passed to compile', () => {
  it('does not require a second copy of the builtin catalog', () => {
    const local: NodeRegistry = createBuiltinRegistry();
    expect(compile(g([], []), local).ok).toBe(true);
  });
});
