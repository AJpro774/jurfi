import type { GraphDocument } from '@jurfi/script';
import { resolveCommandBus } from '../shell/command-bus';
import type { CommandBus } from '../shell/command-bus';
import type { EditorContext } from '../shell/editor-context';
import { createGraphController } from './controller';
import type { NodeGraphDebugSource } from './debug';
import type { NodeTypeRegistry } from './registry';
import { createDefaultRegistry } from './registry';
import { NodeGraphView } from './view';

/**
 * FLAG: Editor Shell undo bus / panel registry / EditorContext are not on
 * main. Pass `commandBus` or `editorContext` when fc90dcbf publishes them.
 * Otherwise the panel uses `createLocalCommandBus()`.
 */
export interface NodeGraphOptions {
  registry?: NodeTypeRegistry;
  commandBus?: CommandBus;
  editorContext?: EditorContext;
  /** Panel id passed to EditorContext.registerPanel. */
  panelId?: string;
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
  const bus = resolveCommandBus(opts);
  const controller = createGraphController({
    document: doc,
    registry,
    bus,
    readOnly: opts.readOnly,
  });
  const view = new NodeGraphView(el, controller, registry, opts.onChange);
  const unregister = opts.editorContext?.registerPanel?.({
    id: opts.panelId ?? 'node-graph',
    title: 'Node Graph',
    mount(host) {
      const nested = mountNodeGraph(host, controller.getDocument(), { ...opts, editorContext: undefined });
      return { destroy: () => nested.destroy() };
    },
  });
  return {
    destroy() {
      unregister?.();
      view.destroy();
    },
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
