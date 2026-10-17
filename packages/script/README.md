# @jurfi/script

Visual scripting compiler and runtime for Jurfi. The Node Graph UI imports these types from `@jurfi/script`. There was no graph schema elsewhere in the repo; this package is that contract.

Compiled programs and the runtime depend on `@jurfi/script` and `@jurfi/core` only. They do not import `@jurfi/editor`, so an exported game can run a graph without the editor.

## Graph document

```ts
interface GraphDoc {
  version: 1;
  nodes: { id: string; type: string; pins?: NodePins; props?: Record<string, unknown>; pos?: { x: number; y: number } }[];
  edges: { id?: string; from: { node: string; pin: string }; to: { node: string; pin: string } }[];
  subgraphs?: Record<string, GraphDoc>;
  groups?: GraphGroup[];   // editor-only
  comments?: GraphComment[]; // editor-only
}
```

- Node type ids are stable strings such as `core/Add`.
- Exec pins and data pins are separate. Data pin types are `bool`, `number`, `string`, `entity`, and `any`.
- Pin literals may be bare JSON (`pins: { condition: true }`) or `{ value, dataType? }`.
- `pos`, `groups`, and `comments` are ignored by `compile` and removed by `stripEditorData(doc)`.

## Registry

`NodeRegistry` is domain-agnostic: `register(def)`, `get(typeId)`, `list()`. A definition carries `typeId`, `pins`, `category`, and `doc`. `createBuiltinRegistry()` registers the script nodes below. Animation blend trees (and anything else) should keep their own registry.

`resolvePins(def, props)` expands variadic exec outputs such as Sequence’s `then0..thenN`.

## Compile

`compile(doc, registry)` returns `{ ok, diagnostics, program, source }`.

- `program` is the interpretable form the runtime executes. It is `null` when any diagnostic is an error.
- `source` is plain JavaScript. It imports `createScriptHost` from `@jurfi/script/host`, plus `clamp` from `@jurfi/core` when the graph uses `core/Clamp`. It does not import the graph interpreter.
- Diagnostics include `nodeId` (and `pin` / `edgeIndex` / `subgraph` when they apply). Errors cover unknown types, pin kind and direction, type mismatches, missing required links, duplicate data links, data cycles, and exec cycles. A disconnected exec input is a warning so the rest of the graph can still run.

## Play mode

```ts
const runtime = createScriptRuntime({ world, onNodeError });
const result = runtime.load(doc);
if (result.ok) {
  runtime.start();       // core/OnStart
  runtime.tick(dt);      // resumed delays, then core/OnUpdate
  runtime.emit('ping', payload);
  runtime.reload(next);  // swap the program, keep variables, do not replay OnStart
  runtime.stop();
}
```

`world` implements `ScriptWorld`. `tick` uses simulated time and does nothing while paused or stopped. `start()` clears graph-scoped variables and the runtime’s fallback entity-variable table.

`reload(doc)` recompiles and swaps the program. Graph variables and entity variables stay. The in-flight stack, delays, and pause are dropped, and OnStart does not run again. If the compile fails, the previous program and variables stay.

A node that throws, a data cycle, or a turn that exceeds the step budget is reported as `{ nodeId, message, error }` through `runtime.nodeErrors` and `onNodeError`. Play mode stays `running`. `start()` with no program still throws `ScriptRuntimeError` (`no-program`).

Shipped games call `createRuntime(options)` from the generated module. That builds a `createScriptHost` session and does not include the interpreter. Hot reload and breakpoints stay on the Play-mode runtime.

## TypeScript scripts

```ts
const spin = defineScript({
  typeId: 'game/Spin',
  category: 'game',
  doc: 'Adds dt to angle.',
  run(ctx) {
    ctx.setVariable('angle', ctx.num(ctx.getVariable('angle')) + ctx.dt);
  },
});
spin.register(registry);
```

Plain scripts get an exec input and a `then` output. `then` runs unless `ctx.follow` was called. Custom nodes pass their own `pins` and can implement `value(ctx, pin)`. `hidden: true` is required when there is no `run` or `value`, and it keeps the node out of the palette.

`paletteNodes(registry)` lists visible definitions. `paletteGaps(registry)` lists visible nodes that have no handler. Every built-in node has a handler and is not hidden, so the built-in registry has no gaps.

In a shipped game, call `defineScript` from `@jurfi/script/host` so the compiled host and the script share one registry. Play mode resolves `defineScript` from `@jurfi/script`.

## Debug

Attach a `DebugSource` to receive events. Nothing is allocated for those events unless a source is attached.

- `{ kind: 'wire', wireId, value }` when a data value is read across an edge, or when an exec edge is taken. Edge `id` becomes `wireId`; otherwise the compiler generates one.
- `{ kind: 'node', nodeId, phase: 'enter' | 'exit' }` around each exec node. `exit` means the node has scheduled its successors, not that those successors have finished.

`setBreakpoint(nodeId)` / `clearBreakpoint(nodeId)` pause before that node. `pause`, `step`, and `resume` control the suspended stack. `step` runs one node. `tick` and `emit` do nothing while paused. Delay timers do not advance while paused.

## Built-in nodes

| Type id | Role |
| --- | --- |
| `core/OnStart`, `core/OnUpdate`, `core/OnEvent`, `core/FireEvent` | Events. Custom events stay inside the graph that fires them. `runtime.emit` targets the root graph. |
| `core/Branch`, `core/Sequence`, `core/ForLoop`, `core/While`, `core/Delay` | Flow. ForLoop is inclusive and steps by 1. Delay waits on `tick` time; `seconds <= 0` continues immediately. |
| `core/GetVariable`, `core/SetVariable` | `props.name` plus `props.scope`: `graph` (default) or `entity`. |
| `core/Add`, `core/Subtract`, `core/Multiply`, `core/Divide`, `core/Clamp` | Math. Clamp calls `clamp` from `@jurfi/core`. |
| `core/And`, `core/Or`, `core/Not` | Logic. And/Or short-circuit. |
| `core/Equal`, `core/NotEqual`, `core/Greater`, `core/GreaterEqual`, `core/Less`, `core/LessEqual` | Compare. Equal also matches entity refs by `id`. |
| `core/Self`, `core/GetComponent`, `core/SetComponent`, `core/GetField`, `core/SetField` | Entity and component access through `ScriptWorld`. Unconnected entity pins use `world.self`. |
| `core/Subgraph` | Runs `props.graph` from **this document’s** `subgraphs`, starting at that graph’s `core/OnStart` nodes, then continues. |

A type that is registered but has no script handler compiles with an `unimplemented-node` warning. At runtime its exec pin `then` is followed and its data outputs are `undefined`. Flag `hidden: true` to keep that node out of the palette.

Loops are structured inside ForLoop and While, so a cycle of exec edges is a compile error. Each `start` / `tick` / `emit` / `resume` records a `max-steps` fault (default 100000) and ends that turn. The session stays running.

## Gap: `@jurfi/core` has no ECS

`@jurfi/core` still exports `VERSION`, `Disposable`, and `clamp` only. There is no entity storage to wire up, so `ScriptWorld` remains the adapter. `createScriptRuntime` implements `Disposable`. `core/Clamp` uses `clamp`.

Everything about entities is the `ScriptWorld` adapter (`coreGaps` lists the missing surface):

- entity id and storage
- component get / set / has
- component field get / set
- per-entity variable storage

`createMemoryWorld` is a test stand-in, not the engine world. If `getField` / `setField` or `getVariable` / `setVariable` are omitted, the runtime falls back to component-object fields and a side table keyed by `entity.id`. World-backed entity variables are not cleared by `start()`, so an ECS adapter can own that data.
