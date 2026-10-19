import { createScriptRuntime, type DebugSource, type GraphDoc } from '@jurfi/script';
import type { EditorContext } from '../context';
import { PANEL } from '../layout';
import { registerProjectSection } from '../project-sections';
import { registerPanel } from '../registry';
import { createUndoStack, type UndoStack } from '../undo';
import { identityGraphAdapter, type GraphDocAdapter } from './adapter';
import { createGraphController, type GraphController } from './controller';
import { createDemoGraph } from './demo-document';
import type { NodeRegistry } from './registry';
import { createDefaultRegistry } from './registry';
import { deserializeGraph } from './serialize';
import { NodeGraphView } from './view';

/**
 * Legacy graph autosave. New sessions store the graph in the project file
 * under the `nodegraph` section. This key is read once when that section is missing.
 */
export const GRAPH_AUTOSAVE_KEY = 'jurfi.editor.nodegraph';

export interface NodeGraphOptions<TDoc = GraphDoc> {
  /** Node types for this domain. Defaults to the script `core/*` catalog. */
  registry?: NodeRegistry;
  /**
   * Host-document boundary. Omit it when `doc` is already a `GraphDoc`.
   * `fromGraph` must return JSON-serializable data.
   */
  adapter?: GraphDocAdapter<TDoc>;
  /** Editor undo stack. A private stack is created when this is omitted. */
  undo?: UndoStack;
  readOnly?: boolean;
  onChange?: (document: TDoc) => void;
}

export interface NodeGraphHandle<TDoc = GraphDoc> {
  destroy(): void;
  getDocument(): TDoc;
  setDocument(document: TDoc): void;
  onChange(listener: (document: TDoc) => void): () => void;
  select(ids: readonly string[]): void;
  getSelection(): string[];
  /** Frame the given node ids, the current selection, or the whole graph. */
  frame(ids?: readonly string[]): void;
  setDebugSource(source: DebugSource | null): void;
  undo(): void;
  redo(): void;
}

export function mountNodeGraph<TDoc = GraphDoc>(
  el: HTMLElement,
  doc: TDoc,
  opts: NodeGraphOptions<TDoc> = {},
): NodeGraphHandle<TDoc> {
  const registry = opts.registry ?? createDefaultRegistry();
  const undo = opts.undo ?? createUndoStack();
  const adapter = opts.adapter ?? (identityGraphAdapter() as GraphDocAdapter<TDoc>);
  const controller = createGraphController({
    document: adapter.toGraph(doc),
    registry,
    undo,
    readOnly: opts.readOnly,
  });
  const emit = (graph: GraphDoc): void => {
    opts.onChange?.(adapter.fromGraph(graph));
  };
  const view = new NodeGraphView(el, controller, registry, emit);
  return {
    destroy: () => view.destroy(),
    getDocument: () => adapter.fromGraph(view.getDocument()),
    setDocument: (document) => view.setDocument(adapter.toGraph(document)),
    onChange: (listener) => view.onChange((graph) => listener(adapter.fromGraph(graph))),
    select: (ids) => view.select(ids),
    getSelection: () => view.getSelection(),
    frame: (ids) => view.frame(ids),
    setDebugSource: (source) => view.setDebugSource(source),
    undo: () => view.undo(),
    redo: () => view.redo(),
  };
}

interface GraphSession {
  undo: UndoStack;
  controller: GraphController;
  registry: NodeRegistry;
}

let session: GraphSession | null = null;
let graphDocument: GraphDoc | null = null;

function currentGraph(): GraphDoc {
  return session?.controller.getDocument() ?? graphDocument ?? readGraphAutosave() ?? createDemoGraph();
}

function readGraphAutosave(): GraphDoc | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GRAPH_AUTOSAVE_KEY);
    if (!raw) return null;
    return deserializeGraph(raw);
  } catch {
    return null;
  }
}

/**
 * Replace the shell's Node Graph placeholder.
 * Call this before `createEditor` so the placeholder is never installed.
 * The same graph controller stays bound to one undo stack across tab remounts.
 */
export function registerNodeGraphPanel(): () => void {
  const registry = createDefaultRegistry();
  const unregisterSection = registerProjectSection('nodegraph', {
    save: () => currentGraph(),
    load(data) {
      try {
        const doc = deserializeGraph(data);
        graphDocument = doc;
        session?.controller.resetDocument(doc);
        if (typeof localStorage !== 'undefined') localStorage.removeItem(GRAPH_AUTOSAVE_KEY);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'invalid graph';
        console.warn(`Skipped project section "nodegraph": ${detail}`);
      }
    },
  });
  const unregisterPanel = registerPanel({
    id: PANEL.nodeGraph,
    title: 'Node Graph',
    mount(el, ctx) {
      const controller = controllerFor(ctx, registry);
      const view = new NodeGraphView(el, controller, registry, (doc) => {
        graphDocument = doc;
        ctx.project.markDirty();
      });
      const debug = attachPlayDebug(ctx, view);
      return () => {
        debug();
        view.destroy();
      };
    },
  });
  return () => {
    unregisterSection();
    unregisterPanel();
  };
}

function controllerFor(ctx: EditorContext, registry: NodeRegistry): GraphController {
  if (session && session.undo === ctx.undo) return session.controller;
  const document = currentGraph();
  graphDocument = document;
  const controller = createGraphController({ document, registry, undo: ctx.undo });
  session = { undo: ctx.undo, controller, registry };
  return controller;
}

function attachPlayDebug(ctx: EditorContext, view: NodeGraphView): () => void {
  let timer = 0;
  const source: DebugSource = {
    onEvent(event) {
      view.onEvent(event);
    },
  };
  const runtime = createScriptRuntime({ registry: view.registry });

  const stop = (): void => {
    window.clearInterval(timer);
    timer = 0;
    runtime.detachDebugger();
    runtime.stop();
    view.clearDebug();
  };

  const start = (): void => {
    if (timer !== 0) return;
    const doc = session?.controller.getDocument();
    if (!doc) return;
    runtime.attachDebugger(source);
    const loaded = runtime.load(doc);
    if (!loaded.ok) {
      ctx.bus.emit('status', { level: 'warn', message: loaded.diagnostics[0]?.message ?? 'Graph did not compile' });
      runtime.detachDebugger();
      return;
    }
    runtime.start();
    timer = window.setInterval(() => runtime.tick(1 / 60), 200);
  };

  const sync = (): void => {
    if (ctx.getPlayState() === 'playing') start();
    else stop();
  };

  const offPlay = ctx.bus.on('play:changed', sync);
  const offStep = ctx.bus.on('play:step', () => {
    const doc = session?.controller.getDocument();
    if (!doc) return;
    runtime.attachDebugger(source);
    if (!runtime.running) {
      const loaded = runtime.load(doc);
      if (loaded.ok) runtime.start();
    }
    runtime.step();
  });
  sync();
  return () => {
    offPlay();
    offStep();
    stop();
  };
}
