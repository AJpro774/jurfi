import type { GraphDocument, GraphEndpoint, GraphRect, Vec2 } from '@jurfi/script';
import type { UndoStack } from '../undo';
import { extractClipboard, pasteClipboard } from './clipboard';
import type { GraphClipboard } from './clipboard';
import type { NodeTypeRegistry } from './registry';
import { evaluateConnection } from './validate';

export interface IdFactory {
  (prefix: string): string;
}

export function createIdFactory(start = 1): IdFactory {
  let next = start;
  return (prefix: string) => {
    const id = `${prefix}_${next}`;
    next += 1;
    return id;
  };
}

export interface GraphController {
  readonly undo: UndoStack;
  getDocument(): GraphDocument;
  subscribe(listener: () => void): () => void;
  addNode(type: string, pos: Vec2): string | null;
  remove(selection: { nodes: readonly string[]; comments: readonly string[]; groups: readonly string[]; edge: GraphEndpointPair | null }): void;
  moveNodes(positions: Readonly<Record<string, Vec2>>): void;
  moveComments(rects: Readonly<Record<string, GraphRect>>): void;
  moveGroups(rects: Readonly<Record<string, GraphRect>>, positions: Readonly<Record<string, Vec2>>): void;
  connect(a: GraphEndpoint, b: GraphEndpoint): string | null;
  disconnect(edge: GraphEndpointPair): void;
  setProp(nodeId: string, key: string, value: unknown): void;
  addComment(rect: GraphRect, text?: string): string | null;
  setCommentText(id: string, text: string): void;
  addGroup(nodeIds: readonly string[], rect: GraphRect, title?: string): string | null;
  setGroupTitle(id: string, title: string): void;
  copy(selection: { nodes: readonly string[]; comments: readonly string[]; groups: readonly string[] }): GraphClipboard;
  paste(clipboard: GraphClipboard, offset: Vec2): { nodes: string[]; comments: string[]; groups: string[] } | null;
  replaceDocument(document: GraphDocument): void;
}

export interface GraphEndpointPair {
  fromNode: string;
  fromPin: string;
  toNode: string;
  toPin: string;
}

export function createGraphController(options: {
  document: GraphDocument;
  registry: NodeTypeRegistry;
  undo: UndoStack;
  ids?: IdFactory;
  readOnly?: boolean;
}): GraphController {
  let doc = cloneDoc(options.document);
  const listeners = new Set<() => void>();
  const ids = options.ids ?? createIdFactory();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  function commit(label: string, mutate: (draft: GraphDocument) => void): boolean {
    if (options.readOnly) return false;
    const before = cloneDoc(doc);
    const draft = cloneDoc(doc);
    mutate(draft);
    if (JSON.stringify(before) === JSON.stringify(draft)) return false;
    const after = cloneDoc(draft);
    doc = after;
    emit();
    options.undo.push({
      label,
      undo() {
        doc = cloneDoc(before);
        emit();
      },
      redo() {
        doc = cloneDoc(after);
        emit();
      },
    });
    return true;
  }

  return {
    undo: options.undo,
    getDocument: () => cloneDoc(doc),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    addNode(type, pos) {
      const definition = options.registry.get(type);
      if (!definition) return null;
      const id = ids('node');
      const ok = commit('Add node', (draft) => {
        draft.nodes.push({
          id,
          type,
          pins: structuredClone(definition.pins) as GraphDocument['nodes'][number]['pins'],
          props: structuredClone(definition.defaults ?? {}) as Record<string, unknown>,
          pos: { x: pos.x, y: pos.y },
        });
      });
      return ok ? id : null;
    },
    remove(selection) {
      const nodes = new Set(selection.nodes);
      const comments = new Set(selection.comments);
      const groups = new Set(selection.groups);
      commit('Delete', (draft) => {
        if (selection.edge) {
          draft.edges = draft.edges.filter((edge) => !samePair(edge, selection.edge as GraphEndpointPair));
        }
        draft.edges = draft.edges.filter((edge) => !nodes.has(edge.from.node) && !nodes.has(edge.to.node));
        draft.nodes = draft.nodes.filter((node) => !nodes.has(node.id));
        draft.comments = draft.comments.filter((comment) => !comments.has(comment.id));
        draft.groups = draft.groups.filter((group) => !groups.has(group.id));
        for (const group of draft.groups) group.nodeIds = group.nodeIds.filter((id) => !nodes.has(id));
      });
    },
    moveNodes(positions) {
      commit('Move nodes', (draft) => {
        for (const node of draft.nodes) {
          const next = positions[node.id];
          if (next) node.pos = { x: next.x, y: next.y };
        }
      });
    },
    moveComments(rects) {
      commit('Move comment', (draft) => {
        for (const comment of draft.comments) {
          const next = rects[comment.id];
          if (next) comment.rect = { ...next };
        }
      });
    },
    moveGroups(rects, positions) {
      commit('Move group', (draft) => {
        for (const group of draft.groups) {
          const next = rects[group.id];
          if (next) group.rect = { ...next };
        }
        for (const node of draft.nodes) {
          const next = positions[node.id];
          if (next) node.pos = { x: next.x, y: next.y };
        }
      });
    },
    connect(a, b) {
      const result = evaluateConnection(doc, a, b);
      if (!result.ok) return result.message;
      const edge = result.edge;
      const ok = commit('Connect', (draft) => {
        draft.edges.push(edge);
      });
      return ok ? null : 'Read only';
    },
    disconnect(edge) {
      commit('Disconnect', (draft) => {
        draft.edges = draft.edges.filter((item) => !samePair(item, edge));
      });
    },
    setProp(nodeId, key, value) {
      commit('Edit property', (draft) => {
        const node = draft.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        node.props = { ...node.props, [key]: value };
      });
    },
    addComment(rect, text = 'Comment') {
      const id = ids('comment');
      const ok = commit('Add comment', (draft) => {
        draft.comments.push({ id, text, rect: { ...rect } });
      });
      return ok ? id : null;
    },
    setCommentText(id, text) {
      commit('Edit comment', (draft) => {
        const comment = draft.comments.find((item) => item.id === id);
        if (comment) comment.text = text;
      });
    },
    addGroup(nodeIds, rect, title = 'Group') {
      const id = ids('group');
      const ok = commit('Add group', (draft) => {
        draft.groups.push({ id, title, nodeIds: [...nodeIds], rect: { ...rect } });
      });
      return ok ? id : null;
    },
    setGroupTitle(id, title) {
      commit('Rename group', (draft) => {
        const group = draft.groups.find((item) => item.id === id);
        if (group) group.title = title;
      });
    },
    copy(selection) {
      return extractClipboard(doc, selection.nodes, selection.comments, selection.groups);
    },
    paste(clipboard, offset) {
      let created: { nodes: string[]; comments: string[]; groups: string[] } | null = null;
      const ok = commit('Paste', (draft) => {
        created = pasteClipboard(draft, clipboard, offset, ids);
      });
      return ok ? created : null;
    },
    replaceDocument(document) {
      commit('Set graph', (draft) => {
        const next = cloneDoc(document);
        draft.version = next.version;
        draft.nodes = next.nodes;
        draft.edges = next.edges;
        draft.groups = next.groups;
        draft.comments = next.comments;
      });
    },
  };
}

function samePair(edge: GraphDocument['edges'][number], pair: GraphEndpointPair): boolean {
  return (
    edge.from.node === pair.fromNode &&
    edge.from.pin === pair.fromPin &&
    edge.to.node === pair.toNode &&
    edge.to.pin === pair.toPin
  );
}

function cloneDoc(document: GraphDocument): GraphDocument {
  return structuredClone(document);
}
