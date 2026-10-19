import { BLEND_TREE_VERSION } from '@jurfi/anim';
import type {
  AnimState,
  Blend1DChild,
  Blend2DChild,
  BlendNode,
  BlendParam,
  BlendTree,
  Transition,
} from '@jurfi/anim';
import { GRAPH_VERSION } from '@jurfi/script';
import type { GraphDoc, GraphEdge, GraphNode, GraphPoint } from '@jurfi/script';
import type { GraphDocAdapter } from '../adapter';

/** Editor bookkeeping stored on the canvas document and omitted from `BlendTree`. */
export interface BlendCanvasMeta {
  id: string;
  name?: string;
  root: string;
  params: BlendParam[];
  states: AnimState[];
  transitions: Transition[];
  entry?: string;
  seq: number;
}

type BlendDoc = GraphDoc & { blend?: BlendCanvasMeta };

export function readBlendMeta(doc: GraphDoc): BlendCanvasMeta {
  const meta = (doc as BlendDoc).blend;
  if (!meta) {
    return { id: 'blend', root: doc.nodes[0]?.id ?? '', params: [], states: [], transitions: [], seq: 1 };
  }
  return {
    id: meta.id || 'blend',
    ...(meta.name !== undefined ? { name: meta.name } : {}),
    root: meta.root,
    params: meta.params ?? [],
    states: meta.states ?? [],
    transitions: meta.transitions ?? [],
    ...(meta.entry !== undefined ? { entry: meta.entry } : {}),
    seq: meta.seq ?? 1,
  };
}

export function writeBlendMeta(doc: GraphDoc, meta: BlendCanvasMeta): void {
  (doc as BlendDoc).blend = meta;
}

export function blendTreeToGraph(tree: BlendTree): GraphDoc {
  const nodes: GraphNode[] = tree.nodes.map((node, index) => graphNode(node, index));
  const edges: GraphEdge[] = [];
  for (const node of tree.nodes) pushEdges(node, edges);
  const graph: BlendDoc = {
    version: GRAPH_VERSION,
    nodes,
    edges,
    groups: [],
    comments: [],
    blend: {
      id: tree.id,
      ...(tree.name !== undefined ? { name: tree.name } : {}),
      root: tree.root,
      params: tree.params.map((param) => ({ ...param })),
      states: (tree.states ?? []).map((state) => ({ ...state })),
      transitions: (tree.transitions ?? []).map((transition) => ({
        ...transition,
        conditions: transition.conditions.map((condition) => ({ ...condition })),
      })),
      ...(tree.entry !== undefined ? { entry: tree.entry } : {}),
      seq: 1,
    },
  };
  return graph;
}

export function blendTreeFromGraph(graph: GraphDoc): BlendTree {
  const meta = readBlendMeta(graph);
  const nodes = graph.nodes.flatMap((node) => {
    const converted = toBlendNode(node, graph.edges);
    return converted ? [converted] : [];
  });
  const known = new Set(nodes.map((node) => node.id));
  const root = known.has(meta.root) ? meta.root : (nodes[0]?.id ?? '');
  const tree: BlendTree = {
    version: BLEND_TREE_VERSION,
    id: meta.id,
    root,
    params: meta.params.map((param) => ({ ...param })),
    nodes,
  };
  if (meta.name) tree.name = meta.name;
  if (meta.states.length > 0) tree.states = meta.states.map((state) => ({ ...state }));
  if (meta.transitions.length > 0) {
    tree.transitions = meta.transitions.map((transition) => ({
      ...transition,
      conditions: transition.conditions.map((condition) => ({ ...condition })),
    }));
  }
  if (meta.entry && meta.states.some((state) => state.id === meta.entry)) tree.entry = meta.entry;
  return tree;
}

export function blendTreeAdapter(): GraphDocAdapter<BlendTree> {
  return {
    toGraph: blendTreeToGraph,
    fromGraph: blendTreeFromGraph,
  };
}

export function isBlendTree(value: unknown): value is BlendTree {
  if (!isRecord(value)) return false;
  return value.version === BLEND_TREE_VERSION && typeof value.id === 'string' && typeof value.root === 'string' && Array.isArray(value.nodes) && Array.isArray(value.params);
}

function graphNode(node: BlendNode, index: number): GraphNode {
  const pos = place(index);
  switch (node.type) {
    case 'clip':
      return { id: node.id, type: 'anim/Clip', props: { clip: node.clip }, pos };
    case 'blend1D':
      return {
        id: node.id,
        type: 'anim/Blend1D',
        props: {
          param: node.param,
          count: Math.max(node.children.length, 1),
          ...Object.fromEntries(node.children.map((child, childIndex) => [`pos${childIndex}`, child.position])),
        },
        pos,
      };
    case 'blend2D':
      return {
        id: node.id,
        type: 'anim/Blend2D',
        props: {
          paramX: node.paramX,
          paramY: node.paramY,
          count: Math.max(node.children.length, 1),
          ...Object.fromEntries(node.children.flatMap((child, childIndex) => [[`x${childIndex}`, child.x], [`y${childIndex}`, child.y]])),
        },
        pos,
      };
    case 'additive':
      return { id: node.id, type: 'anim/Additive', props: { weight: node.weight }, pos };
    case 'mask':
      return {
        id: node.id,
        type: 'anim/Mask',
        props: {
          joints: node.joints.join(', '),
          ...(node.weight !== undefined ? { weight: node.weight } : {}),
        },
        pos,
      };
  }
}

function pushEdges(node: BlendNode, edges: GraphEdge[]): void {
  if (node.type === 'blend1D' || node.type === 'blend2D') {
    node.children.forEach((child, index) => {
      edges.push(edge(child.node, node.id, `in${index}`));
    });
    return;
  }
  if (node.type === 'additive') {
    edges.push(edge(node.base, node.id, 'base'), edge(node.add, node.id, 'add'));
    return;
  }
  if (node.type === 'mask') {
    edges.push(edge(node.source, node.id, 'source'));
    if (node.base) edges.push(edge(node.base, node.id, 'base'));
  }
}

function edge(from: string, to: string, pin: string): GraphEdge {
  return { from: { node: from, pin: 'pose' }, to: { node: to, pin } };
}

function toBlendNode(node: GraphNode, edges: readonly GraphEdge[]): BlendNode | null {
  const props = node.props ?? {};
  switch (node.type) {
    case 'anim/Clip':
      return { id: node.id, type: 'clip', clip: text(props.clip) || node.id };
    case 'anim/Blend1D': {
      const children: Blend1DChild[] = incoming(edges, node.id)
        .map((link) => ({ node: link.from, position: numberProp(props, `pos${link.index}`, link.index) }));
      return { id: node.id, type: 'blend1D', param: text(props.param), children };
    }
    case 'anim/Blend2D': {
      const children: Blend2DChild[] = incoming(edges, node.id).map((link) => ({
        node: link.from,
        x: numberProp(props, `x${link.index}`, 0),
        y: numberProp(props, `y${link.index}`, 0),
      }));
      return { id: node.id, type: 'blend2D', paramX: text(props.paramX), paramY: text(props.paramY), children };
    }
    case 'anim/Additive': {
      const base = sourceOn(edges, node.id, 'base');
      const add = sourceOn(edges, node.id, 'add');
      return { id: node.id, type: 'additive', base: base ?? '', add: add ?? '', weight: weightProp(props.weight) };
    }
    case 'anim/Mask': {
      const source = sourceOn(edges, node.id, 'source');
      const base = sourceOn(edges, node.id, 'base');
      const weight = props.weight;
      return {
        id: node.id,
        type: 'mask',
        source: source ?? '',
        joints: text(props.joints).split(',').map((joint) => joint.trim()).filter((joint) => joint.length > 0),
        ...(base ? { base } : {}),
        ...(weight !== undefined && weight !== '' ? { weight: weightProp(weight) } : {}),
      };
    }
    default:
      return null;
  }
}

function incoming(edges: readonly GraphEdge[], nodeId: string): { from: string; index: number }[] {
  const links: { from: string; index: number }[] = [];
  for (const edgeItem of edges) {
    if (edgeItem.to.node !== nodeId) continue;
    const match = /^in(\d+)$/.exec(edgeItem.to.pin);
    if (!match) continue;
    links.push({ from: edgeItem.from.node, index: Number(match[1]) });
  }
  links.sort((a, b) => a.index - b.index);
  return links;
}

function sourceOn(edges: readonly GraphEdge[], nodeId: string, pin: string): string | undefined {
  return edges.find((edgeItem) => edgeItem.to.node === nodeId && edgeItem.to.pin === pin)?.from.node;
}

function place(index: number): GraphPoint {
  return { x: 48 + (index % 4) * 280, y: 64 + Math.floor(index / 4) * 200 };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberProp(props: Record<string, unknown>, key: string, fallback: number): number {
  const value = props[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function weightProp(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return 1;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && String(asNumber) === trimmed) return asNumber;
    return trimmed;
  }
  return 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
