import type { GraphDocument } from '@jurfi/script';
import type { EditorContext } from '../context';
import { PANEL } from '../layout';
import { registerPanel } from '../registry';
import { createUndoStack, type UndoStack } from '../undo';
import { createGraphController, type GraphController } from './controller';
import type { NodeGraphDebugSource } from './debug';
import { createDemoGraph } from './demo-document';
import type { NodeTypeRegistry } from './registry';
import { createDefaultRegistry } from './registry';
import { NodeGraphView } from './view';

export interface NodeGraphOptions {
  registry?: NodeTypeRegistry;
  /** Editor undo stack. A private stack is created when this is omitted. */
  undo?: UndoStack;
  readOnly?: boolean;
  onChange?: (document: GraphDocument) => void;
}

export interface NodeGraphHandle {
  destroy(): void;
  getDocument(): GraphDocument;
  setDocument(document: GraphDocument): void;
  onChange(listener: (document: GraphDocument) => void): () => void;
  select(ids: readonly string[]): void;
  getSelection(): string[];
  /** Frame the given node ids, the current selection, or the whole graph. */
  frame(ids?: readonly string[]): void;
  setDebugSource(source: NodeGraphDebugSource | null): void;
  undo(): void;
  redo(): void;
}

export function mountNodeGraph(el: HTMLElement, doc: GraphDocument, opts: NodeGraphOptions = {}): NodeGraphHandle {
  const registry = opts.registry ?? createDefaultRegistry();
  const undo = opts.undo ?? createUndoStack();
  const controller = createGraphController({
    document: doc,
    registry,
    undo,
    readOnly: opts.readOnly,
  });
  const view = new NodeGraphView(el, controller, registry, opts.onChange);
  return {
    destroy: () => view.destroy(),
    getDocument: () => view.getDocument(),
    setDocument: (document) => view.setDocument(document),
    onChange: (listener) => view.onChange(listener),
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
  registry: NodeTypeRegistry;
}

let session: GraphSession | null = null;

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
      const view = new NodeGraphView(el, controller, registry);
      const debug = attachPlayDebug(ctx, view);
      return () => {
        debug();
        view.destroy();
      };
    },
  });
}

function controllerFor(ctx: EditorContext, registry: NodeTypeRegistry): GraphController {
  if (session && session.undo === ctx.undo) return session.controller;
  const document = session?.controller.getDocument() ?? createDemoGraph();
  const controller = createGraphController({ document, registry, undo: ctx.undo });
  session = { undo: ctx.undo, controller, registry };
  return controller;
}

function attachPlayDebug(ctx: EditorContext, view: NodeGraphView): () => void {
  let timer = 0;
  let step = 0;

  const publish = (): void => {
    const doc = session?.controller.getDocument();
    if (!doc) return;
    const ids = doc.nodes.map((node) => node.id);
    const current = ids.length === 0 ? '' : ids[step % ids.length] ?? '';
    step += 1;
    const values: Record<string, unknown> = {};
    for (const edge of doc.edges) {
      const source = doc.nodes.find((node) => node.id === edge.from.node);
      const pin = source?.pins.find((item) => item.id === edge.from.pin);
      if (pin?.kind !== 'data') continue;
      values[`${edge.from.node}:${edge.from.pin}`] = source?.props.value ?? source?.props.name ?? pin.dataType;
    }
    const source: NodeGraphDebugSource = { executingNodeIds: current ? [current] : [], values };
    view.setDebugSource(source);
  };

  const stop = (): void => {
    window.clearInterval(timer);
    timer = 0;
    view.setDebugSource(null);
  };

  const sync = (): void => {
    if (ctx.getPlayState() === 'playing') {
      if (timer !== 0) return;
      publish();
      timer = window.setInterval(publish, 700);
      return;
    }
    stop();
  };

  const offPlay = ctx.bus.on('play:changed', sync);
  const offStep = ctx.bus.on('play:step', () => {
    if (ctx.getPlayState() === 'playing') return;
    publish();
  });
  sync();
  return () => {
    offPlay();
    offStep();
    stop();
  };
}
