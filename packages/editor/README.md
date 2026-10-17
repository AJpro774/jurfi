# @jurfi/editor

Editor shell for Jurfi. Panel packages (`viewport`, hierarchy, inspector, asset browser, node graph, timeline) register a view and talk to the editor through `EditorContext`. Games and samples must never import this package.

`@jurfi/core` does not export an ECS world yet. `EditorContext.world` is the editor's JSON scene document (`EditorWorld`): entities with a name, a parent, and a JSON component bag. Save/load, undo, and play mode all snapshot that document. When core ships an ECS, a world that implements `EditorWorld` can be passed to `createEditorContext({ world })`.

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

## EditorContext

`createEditorContext()` builds a headless context (no DOM). `createEditor({ root })` mounts the shell into an element and uses the same context object (`editor.ctx`).

```ts
export interface EditorContext {
  readonly world: EditorWorld;
  readonly selection: Selection;
  readonly undo: UndoStack;
  readonly commands: CommandRegistry;
  readonly bus: EditorBus;
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

Consecutive `push` calls that share a `mergeKey` become one history step. The default merge keeps the earlier `undo` (the original baseline) and the later `redo` (the newest value), which is the right behavior when `undo` / `redo` assign absolute state. Pass `merge(previous)` and return `false` to keep the commands separate, or return `true` after folding `previous` in yourself.

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
| `status` | `{ message: string; level: 'info' \| 'warn' \| 'error' }` |
| `command:executed` | `{ id: string }` |

Other string event names are allowed; their payload is `unknown` unless you agree on a shape with the listener.

### Play mode

`play()` stores `world.serialize()` the first time the session leaves editing, then sets the state to `playing`. `pause()` only applies while playing. `play()` from paused resumes and keeps the original snapshot. `stop()` deserializes that snapshot, clears the undo stack, and returns to `editing`. `step()` snapshots if needed, forces `paused`, and emits `play:step`. Nothing in the shell ticks a game loop; the snapshot boundary is the scaffold a runtime can hook.

## Shell

`createEditor({ root, world?, storage? })` mounts the dock, menu bar, toolbar, command palette, and status bar into `root`. It registers a placeholder for any standard panel id that is still empty. Layout (zone sizes, tab order, collapsed dock) is stored in `localStorage` under `jurfi.editor.layout`. Reset Layout restores the default and clears that key.

Project files are JSON (`format: 'jurfi-project'`, version 1) containing the world snapshot and the layout. File → Save downloads that JSON. File → Open reads a file the user picks. An autosave of the same document is written to `localStorage` under `jurfi.editor.autosave` and restored on the next launch.
