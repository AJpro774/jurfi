# @jurfi/editor

Editor-only package. Exported games and `apps/samples` must never import it.

## Node graph

`mountNodeGraph(element, document, options)` mounts the visual scripting panel. It returns a handle with `onChange`, `select`, `frame`, `setDebugSource`, `undo`, and `redo`.

```ts
import { createDemoGraph, mountNodeGraph } from '@jurfi/editor';

const graph = mountNodeGraph(element, createDemoGraph());
graph.onChange((doc) => {
  // doc is the full graph, including editor-only pos / groups / comments
  void doc.version;
});
graph.setDebugSource({ executingNodeIds: ['node_1'], values: { 'node_4:value': 'Hello, Jurfi' } });
```

Graph document types (`GraphDocument`, pins, edges) are imported from `@jurfi/script`. `packages/script/src/graph.ts` is a **provisional stub** (`GRAPH_TYPES_STUB`) until the Script Compiler publishes the schema.

`pos`, `groups`, and `comments` are editor-only. `stripEditorData(doc)` removes them for export.

### Undo

Every document edit is a command. The Editor Shell command bus, panel registry, and `EditorContext` are **not on main** (shell owner fc90dcbf). The panel talks to a thin `CommandBus` adapter (`createLocalCommandBus`). Pass `options.commandBus` or `options.editorContext.commandBus` to attach the shell bus later. `execute` must call `command.do()` synchronously.

### Run it

```bash
pnpm --filter @jurfi/ui build
pnpm --filter @jurfi/core build
pnpm --filter @jurfi/editor-app dev
```

The editor app opens the graph. Wheel zooms, Alt-drag or middle-drag pans, drag on empty space box-selects, Shift-click toggles multi-select. Search the palette, drag a node type onto the canvas, and use Undo / Redo.
