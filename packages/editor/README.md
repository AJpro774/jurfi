# @jurfi/editor

Editor shell for Jurfi. Panel packages (`viewport`, hierarchy, inspector, asset browser, node graph, timeline) register a view and talk to the editor through `EditorContext`. Games and samples must never import this package.

`@jurfi/core` exports the ECS world. `createEditorWorld()` implements `EditorWorld`: string ids over generational entities, with `defineComponent` data stored in the ECS and other bag keys kept as JSON. `EditorContext.selection` is the ordered id list the viewport also reads and writes. Hierarchy and inspector subscribe to that same store.

## Register a panel

```ts
import { registerPanel, type EditorContext } from '@jurfi/editor';

registerPanel({
  id: 'hierarchy',
  title: 'Hierarchy',
  mount(el, ctx: EditorContext) {
    el.textContent = 'Hierarchy';
    const off = ctx.selection.subscribe(() => {
      /* refresh */
    });
    return () => off();
  },
});
```

`registerPanel({ id, title, mount(el, ctx) })` stores the definition in the process-wide registry. `mount` receives the zone body and the live `EditorContext`. It may return a dispose function; the shell calls that function before emptying the host or swapping panels.

Registering the same `id` again replaces the previous definition and keeps its place in the registry. The shell remounts any zone showing that id, so a real panel can take over a placeholder either before `createEditor` or afterwards. The returned function unregisters the panel only if that definition is still the current one.

| Function | Role |
| --- | --- |
| `registerPanel(def)` | Add or replace a panel. Returns an unregister function. |
| `getPanel(id)` | Current definition, or `undefined`. |
| `listPanels()` | Definitions in registration order. |
| `subscribePanels(listener)` | Fires with `(id, 'register' \| 'remove')` on add, replace, and remove. |

Placeholder ids the shell installs when nobody has claimed them yet:

| id | Title | Default zone |
| --- | --- | --- |
| `hierarchy` | Hierarchy | Left, top |
| `assets` | Asset Browser | Left, bottom |
| `viewport` | Viewport | Center (active tab) |
| `nodegraph` | Node Graph | Center |
| `timeline` | Timeline | Center |
| `inspector` | Inspector | Right |
| `console` | Console | Bottom dock |

`registerContentPanels()` replaces the `hierarchy`, `inspector`, and `assets` placeholders. Call it before `createEditor`, along with `registerViewportPanel()`, `registerNodeGraphPanel()`, and `registerTimelinePanel()`. The editor app opens `createEditorWorld()` from `@jurfi/core`, loads `createDemoSnapshot()`, and calls `seedDemoLibrary(ctx)`.

The inspector builds component editors from `@jurfi/core` `defineComponent` schemas (`Transform`, `Light`, `Light2D`, and any later component). Editing `Transform` also writes the viewport's `components.transform` document, which is the shape the scene view and gizmos read. `components.mesh.shape` is `box`, `sphere`, or `plane`. Visibility and lock stay in `jurfi.flags`. The asset library is session-only and is not part of the project file.

## EditorContext

`createEditorContext()` builds a headless context (no DOM). `createEditor({ root })` mounts the shell into an element and uses the same context object (`editor.ctx`).

```ts
export interface EditorContext {
  readonly world: EditorWorld;
  readonly selection: Selection;
  readonly undo: UndoStack;
  readonly commands: CommandRegistry;
  readonly bus: EditorBus;
  readonly project: EditorProject;
  getPlayState(): PlayState; // 'editing' | 'playing' | 'paused'
  play(): void;
  pause(): void;
  stop(): void;
  step(): void;
  getGizmoMode(): GizmoMode; // 'translate' | 'rotate' | 'scale'
  setGizmoMode(mode: GizmoMode): void;
}
```

### Selection

`selection.get()` returns the ordered entity ids. `selection.set(ids)` replaces them and notifies subscribers when the list actually changes. `selection.subscribe(listener)` returns an unsubscribe function. A change also emits `selection:changed` on the bus.

### World

```ts
interface EntityRecord {
  id: string;
  name: string;
  parentId: string | null;
  components: Record<string, unknown>; // JSON values only
}

interface EditorWorld {
  entities(): readonly EntityRecord[];
  get(id: string): EntityRecord | undefined;
  add(entity: EntityRecord): void;
  update(id: string, patch: Partial<Omit<EntityRecord, 'id'>>): void;
  remove(id: string): void; // children are reparented to the removed entity's parent
  serialize(): WorldSnapshot;
  deserialize(snapshot: WorldSnapshot): void;
  subscribe(listener: () => void): () => void;
}
```

`get` and `entities` return copies. Mutate through `update`, `add`, and `remove`. Every mutation emits `world:changed` with `{ snapshot }`. Do not write the world from a `world:changed` listener.

`remove` deletes one entity and points its children at that entity's parent.

### Undo stack

Undo commands are separate from palette commands. Push a command **after** the edit is already applied. `push` does not call `redo`.

```ts
interface UndoCommand {
  label: string;
  mergeKey?: string;
  merge?(previous: UndoCommand): boolean;
  undo(): void;
  redo(): void;
}
```

Consecutive `push` calls that share a `mergeKey` become one history step. Undo or redo breaks the run, so the next push starts a new step even when the key matches. The default merge keeps the earlier `undo` (the original baseline) and the later `redo` (the newest value), which is the right behavior when `undo` / `redo` assign absolute state. Pass `merge(previous)` and return `false` to keep the commands separate, or return `true` after folding `previous` in yourself.

`undo()` and `redo()` return `false` at the ends of the stack. A new `push` clears the redo stack. `subscribe` receives `'push' | 'undo' | 'redo' | 'clear'` after the world change for undo and redo. The stack caps at 200 entries.

Keyboard: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo (wired by the shell).

### Commands

Palette and menu actions:

```ts
interface EditorCommand {
  id: string;
  title: string;
  shortcut?: string; // 'Mod+K', 'Mod+Shift+Z', ...
  group?: string;
  when?: () => boolean;
  run(): void;
}
```

`commands.register` replaces the same id. `commands.execute(id)` runs `run` and returns `false` when the id is missing or `when()` is false. A successful execute emits `command:executed`. `Mod` is Cmd on Apple platforms and Ctrl elsewhere. The command palette (Ctrl/Cmd+K) lists `commands.list()`.

### Event bus

`bus.on(type, listener)` returns an unsubscribe function. `bus.emit(type, payload)` notifies current listeners. Known payloads:

| Event | Payload |
| --- | --- |
| `selection:changed` | `{ ids: readonly string[] }` |
| `world:changed` | `{ snapshot: WorldSnapshot }` |
| `play:changed` | `{ state: PlayState }` |
| `play:step` | `{ state: PlayState }` |
| `gizmo:changed` | `{ mode: GizmoMode }` |
| `layout:changed` | `{ layout }` |
| `layout:reset` | `{ layout }` |
| `project:saved` | `{ name: string }` |
| `project:loaded` | `{ name: string }` |
| `project:dirty` | `{}` |
| `status` | `{ message: string; level: 'info' \| 'warn' \| 'error' }` |
| `command:executed` | `{ id: string }` |

Other string event names are allowed; their payload is `unknown` unless you agree on a shape with the listener.

### Play mode

`play()` stores `world.serialize()` the first time the session leaves editing, then sets the state to `playing`. `pause()` only applies while playing. `play()` from paused resumes and keeps the original snapshot. `stop()` deserializes that snapshot, clears the undo stack, and returns to `editing`. When the world is the `@jurfi/core` adapter, that snapshot includes packed entity ids, per-entity variables, and the generation table, so `stop()` restores the same numeric ids and variables that were current when play began. `step()` snapshots if needed, forces `paused`, and emits `play:step`. Nothing in the shell ticks a game loop; the snapshot boundary is the scaffold a runtime can hook.

## Shell

`createEditor({ root, world?, storage? })` mounts the dock, menu bar, toolbar, command palette, and status bar into `root`. It registers a placeholder for any standard panel id that is still empty. Layout (zone sizes, tab order, collapsed dock) is stored in `localStorage` under `jurfi.editor.layout`. Reset Layout restores the default and clears that key.

Project files are JSON (`format: 'jurfi-project'`, version 1) containing the world snapshot, the layout, and a `sections` object. File → Save downloads that JSON. File → Open reads a file the user picks. An autosave of the same document is written to `localStorage` under `jurfi.editor.autosave` and restored on the next launch. A file written before `sections` existed still loads; its section bag is empty.

## Project sections

Panels that own data outside the world snapshot register a section. The shell stores each section under its id and restores it on open and on autosave restore.

```ts
import { registerProjectSection, type ProjectSection } from '@jurfi/editor';

const section: ProjectSection = {
  save: () => ({ yaw: 0.4, pitch: 0.2 }),
  load(data: unknown) {
    /* replace this panel's document from `data` */
  },
};

const unregister = registerProjectSection('camera', section);
```

`registerProjectSection(id, { save, load })` returns an unregister function. Unregister removes the section only when that registration is still current; registering the same id again replaces it. `save` must return JSON (`null`, boolean, number, string, array, or plain object). `undefined` is stored as `null`. A `save` that throws, or that returns a value `JSON.stringify` cannot clone, is omitted and a warning is written.

`writeProject` / File → Save / autosave call every `save`. `readProject` keeps the bag but does not call `load`. The shell calls `applyProjectSections` on open and when it restores an autosave:

- An id in the file with no current registration is an unknown section. It is skipped and `console.warn` reports `Skipped unknown project section "<id>"`. `load` is not called.
- A registration whose id is absent from the file is a missing section. It is skipped with `Skipped missing project section "<id>"`. `load` is not called.
- A present, registered id is passed to `load`.

`applyProjectSections(data)` returns `{ id, reason: 'unknown' | 'missing', message }[]` for those skips. Opening a file that skipped sections also sets the status bar to a warning.

World edits already schedule autosave through `world.subscribe`. A section that changes without touching the world calls `ctx.project.markDirty()`. That emits `project:dirty`, and the shell schedules the same autosave. `markDirty` does not write the file itself.

This package does not register `hierarchy.flags` or `assets.library`. The Inspector & Assets UI owner registers those two ids against this hook:

| id | Owner | Contents |
| --- | --- | --- |
| `hierarchy.flags` | Inspector & Assets UI | Visibility and lock flags |
| `assets.library` | Inspector & Assets UI | Asset library |
| `nodegraph` | Node graph panel | Graph document (today still mirrored at `jurfi.editor.nodegraph`) |
| `timeline` | Timeline panel | Timeline clips |
| `camera` | Viewport | Camera state |

`hierarchy.flags` and `assets.library` stay unregistered until that owner calls `registerProjectSection`. The node graph, timeline, and camera sections use the same hook when those panels save into the project file.

## Node graph

`registerNodeGraphPanel()` claims the `nodegraph` panel id. Call it before `createEditor` so the shell placeholder is never installed. The panel uses `EditorContext.undo`: each edit is applied, then pushed. `push` does not call `redo`. Tab switches remount the view against the same controller, so undo closures stay valid.

`mountNodeGraph(element, document, options)` mounts the same canvas without the dock. Pass `options.undo` to share a stack. Otherwise it creates a private `UndoStack`. Pass `options.registry` (`register`, `get`, `list`) and `options.adapter` (`toGraph` / `fromGraph`) to reuse the canvas for another domain, such as a blend tree. The canvas edits a `GraphDoc`. The handle exposes `onChange`, `select`, `frame`, `setDebugSource`, `undo`, and `redo`. `onChange` emits the host document from the adapter.

```ts
import { createEditor, registerNodeGraphPanel, registerViewportPanel } from '@jurfi/editor';

registerViewportPanel();
registerNodeGraphPanel();
createEditor({ root });
```

Graph document types come from `@jurfi/script`: `GraphDoc`, `NodeRegistry`, and `DebugSource`. The document uses `edges`, optional node `pos`, top-level `groups` and `comments` stored as `pos` plus `size`, type ids such as `core/Add`, and an optional `subgraphs` map keyed by id. Pin specs live on the node definition. `stripEditorData(doc)` is the script export and removes `pos`, `groups`, and `comments`, including inside subgraphs.

The view implements `DebugSource`. Play mode loads the graph with `createScriptRuntime`, calls `attachDebugger`, and paints `{ kind: 'wire', wireId, value }` and `{ kind: 'node', nodeId, phase: 'enter' | 'exit' }` through `onEvent`. `wireId` is the edge id when the edge has one, otherwise `fromNode:fromPin->toNode:toPin`. `setDebugSource` installs an extra listener for those same events, and `null` clears the overlay.

Every committed edit is on the undo stack, and `getDocument()` is JSON. The panel writes that JSON to `localStorage` under `jurfi.editor.nodegraph` after each commit so a reload can restore it. Registering a `nodegraph` project section (see Project sections) is how that document joins the project file and `jurfi.editor.autosave`. A drag or a text field is not in the document until the gesture or the field commits.

```bash
pnpm --filter @jurfi/ui build
pnpm --filter @jurfi/core build
pnpm --filter @jurfi/editor-app dev
```

Open the Node Graph tab. Wheel zooms, Alt-drag or middle-drag pans, drag on empty space box-selects, and Shift-click toggles multi-select. Search the palette, drag a node type onto the canvas, and use Undo / Redo. Ctrl/Cmd+Z follows the shell shortcut and the graph toolbar.
