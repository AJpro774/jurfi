import type { GraphDocument } from '@jurfi/script';
import type { EditorContext } from '../context';
import { PANEL } from '../layout';
import { registerPanel } from '../registry';
import { createUndoStack, type UndoStack } from '../undo';
import { identityGraphAdapter, type GraphDocAdapter } from './adapter';
import { createGraphController, type GraphController } from './controller';
import { edgeWireId, type DebugEvent, type DebugSource } from './debug';
import { createDemoGraph } from './demo-document';
import type { NodeRegistry } from './registry';
import { createDefaultRegistry } from './registry';
import { deserializeGraph, serializeGraph } from './serialize';
import { NodeGraphView } from './view';

/** Last committed graph. Separate from the shell project file, which stores the world. */
export const GRAPH_AUTOSAVE_KEY = 'jurfi.editor.nodegraph';

export interface NodeGraphOptions<TDoc = GraphDocument> {
  /** Node types for this domain. Defaults to the script `core/*` catalog. */
  registry?: NodeRegistry;
  /**
   * Host-document boundary. Omit it when `doc` is already a `GraphDocument`.
   * `fromGraph` must return JSON-serializable data.
   */
  adapter?: GraphDocAdapter<TDoc>;
  /** Editor undo stack. A private stack is created when this is omitted. */
  undo?: UndoStack;
  readOnly?: boolean;
  onChange?: (document: TDoc) => void;
}

export interface NodeGraphHandle<TDoc = GraphDocument> {
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

export function mountNodeGraph<TDoc = GraphDocument>(
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
  const emit = (graph: GraphDocument): void => {
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

function readGraphAutosave(): GraphDocument | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GRAPH_AUTOSAVE_KEY);
    if (!raw) return null;
    return deserializeGraph(raw);
  } catch {
    return null;
  }
}

function writeGraphAutosave(doc: GraphDocument): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GRAPH_AUTOSAVE_KEY, serializeGraph(doc));
  } catch {
    // Storage can be full or disabled. The in-memory document stays current.
  }
}

/**
 * Replace the shell's Node Graph placeholder.
 * Call this before `createEditor` so the placeholder is never installed.
 * The same graph controller stays bound to one undo stack across tab remounts.
 */
export function registerNodeGraphPanel(): () => void {
  const registry = createDefaultRegistry();
  return registerPanel({
    id: PANEL.nodeGraph,
    title: 'Node Graph',
    mount(el, ctx) {
      const controller = controllerFor(ctx, registry);
      const view = new NodeGraphView(el, controller, registry, writeGraphAutosave);
      const debug = attachPlayDebug(ctx, view);
      return () => {
        debug();
        view.destroy();
      };
    },
  });
}

function controllerFor(ctx: EditorContext, registry: NodeRegistry): GraphController {
  if (session && session.undo === ctx.undo) return session.controller;
  const document = session?.controller.getDocument() ?? readGraphAutosave() ?? createDemoGraph();
  const controller = createGraphController({ document, registry, undo: ctx.undo });
  session = { undo: ctx.undo, controller, registry };
  return controller;
}

function attachPlayDebug(ctx: EditorContext, view: NodeGraphView): () => void {
  let timer = 0;
  let step = 0;
  let activeNode = '';
  const listeners = new Set<(event: DebugEvent) => void>();
  const source: DebugSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  const emit = (event: DebugEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const publish = (): void => {
    const doc = session?.controller.getDocument();
    if (!doc) return;
    const ids = doc.nodes.map((node) => node.id);
    const current = ids.length === 0 ? '' : (ids[step % ids.length] ?? '');
    step += 1;
    if (activeNode) emit({ kind: 'node', nodeId: activeNode, phase: 'exit' });
    activeNode = current;
    if (current) emit({ kind: 'node', nodeId: current, phase: 'enter' });
    for (const edge of doc.edges) {
      const node = doc.nodes.find((item) => item.id === edge.from.node);
      const pin = node?.pins.find((item) => item.id === edge.from.pin);
      if (pin?.kind !== 'data') continue;
      emit({
        kind: 'wire',
        wireId: edgeWireId(edge),
        value: node?.props.value ?? node?.props.name ?? pin.dataType,
      });
    }
  };

  const stop = (): void => {
    window.clearInterval(timer);
    timer = 0;
    activeNode = '';
    view.setDebugSource(null);
  };

  const sync = (): void => {
    if (ctx.getPlayState() === 'playing') {
      if (timer !== 0) return;
      view.setDebugSource(source);
      publish();
      timer = window.setInterval(publish, 700);
      return;
    }
    stop();
  };

  const offPlay = ctx.bus.on('play:changed', sync);
  const offStep = ctx.bus.on('play:step', () => {
    if (ctx.getPlayState() === 'playing') return;
    view.setDebugSource(source);
    publish();
  });
  sync();
  return () => {
    offPlay();
    offStep();
    stop();
  };
}
