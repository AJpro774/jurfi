import { GRAPH_VERSION, stripEditorData } from '@jurfi/script';
import type { GraphComment, GraphDoc, GraphEdge, GraphGroup, GraphNode, GraphPoint, PinEndpoint } from '@jurfi/script';
import { createBuiltinRegistry } from '@jurfi/script';
import { normalizeConnections } from './validate';

export { stripEditorData };

const MAX_SUBGRAPH_DEPTH = 8;

export class GraphSchemaError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join('\n'));
    this.name = 'GraphSchemaError';
    this.issues = issues;
  }
}

export function createEmptyGraph(): GraphDoc {
  return { version: GRAPH_VERSION, nodes: [], edges: [], groups: [], comments: [] };
}

export function serializeGraph(doc: GraphDoc): string {
  return JSON.stringify(doc);
}

export function deserializeGraph(input: string | unknown, registry = createBuiltinRegistry()): GraphDoc {
  const parsed = parseGraph(input, registry);
  if (!parsed.ok) throw new GraphSchemaError(parsed.issues);
  return parsed.document;
}

export function parseGraph(
  input: string | unknown,
  registry = createBuiltinRegistry(),
): { ok: true; document: GraphDoc } | { ok: false; issues: string[] } {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return { ok: false, issues: ['Graph JSON is not valid JSON'] };
    }
  }
  const issues: string[] = [];
  const document = readDocument(value, issues, 0);
  if (!document || issues.length > 0) return { ok: false, issues };
  const normalized = normalizeTree(document, registry, issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, document: normalized };
}

function normalizeTree(doc: GraphDoc, registry: ReturnType<typeof createBuiltinRegistry>, issues: string[]): GraphDoc {
  const self = normalizeConnections(doc, registry);
  for (const issue of self.issues) issues.push(issue);
  if (!doc.subgraphs) return self.document;
  const subgraphs: Record<string, GraphDoc> = {};
  for (const [id, child] of Object.entries(doc.subgraphs)) {
    const before = issues.length;
    subgraphs[id] = normalizeTree(child, registry, issues);
    if (issues.length > before) {
      for (let index = before; index < issues.length; index += 1) {
        const issue = issues[index];
        if (issue) issues[index] = `${id}: ${issue}`;
      }
    }
  }
  return { ...self.document, subgraphs };
}

function readDocument(value: unknown, issues: string[], depth: number): GraphDoc | null {
  const start = issues.length;
  if (!isRecord(value)) {
    issues.push('Graph must be an object');
    return null;
  }
  if (value.version !== GRAPH_VERSION) issues.push(`version must be ${GRAPH_VERSION}`);
  const nodes = readNodes(value.nodes, issues);
  const edges = readEdges(value.edges, issues);
  const groups = value.groups === undefined ? [] : readGroups(value.groups, issues);
  const comments = value.comments === undefined ? [] : readComments(value.comments, issues);
  const subgraphs = value.subgraphs === undefined ? undefined : readSubgraphs(value.subgraphs, issues, depth);
  if (!nodes || !edges || !groups || !comments || (value.subgraphs !== undefined && !subgraphs) || issues.length > start) {
    return null;
  }
  const ids = new Set<string>();
  for (const node of nodes) claimId(ids, node.id, `node ${node.id}`, issues);
  for (const group of groups) claimId(ids, group.id, `group ${group.id}`, issues);
  for (const comment of comments) claimId(ids, comment.id, `comment ${comment.id}`, issues);
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const group of groups) {
    for (const nodeId of group.nodeIds ?? []) {
      if (!nodeIds.has(nodeId)) issues.push(`group ${group.id} references missing node ${nodeId}`);
    }
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.from.node) || !nodeIds.has(edge.to.node)) issues.push('edge references a missing node');
  }
  if (issues.length > start) return null;
  const document: GraphDoc = { version: GRAPH_VERSION, nodes, edges, groups, comments };
  if (subgraphs) document.subgraphs = subgraphs;
  return document;
}

function readSubgraphs(value: unknown, issues: string[], depth: number): Record<string, GraphDoc> | null {
  if (depth >= MAX_SUBGRAPH_DEPTH) {
    issues.push('subgraphs nested too deeply');
    return null;
  }
  if (!isRecord(value)) {
    issues.push('subgraphs must be an object');
    return null;
  }
  const subgraphs: Record<string, GraphDoc> = {};
  for (const [id, child] of Object.entries(value)) {
    if (id.length === 0) {
      issues.push('subgraph id must be a non-empty string');
      continue;
    }
    const before = issues.length;
    const document = readDocument(child, issues, depth + 1);
    if (!document || issues.length > before) continue;
    subgraphs[id] = document;
  }
  return Object.keys(subgraphs).length === Object.keys(value).length ? subgraphs : null;
}

function readNodes(value: unknown, issues: string[]): GraphNode[] | null {
  if (!Array.isArray(value)) {
    issues.push('nodes must be an array');
    return null;
  }
  const nodes: GraphNode[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const node = readNode(value[index], `nodes[${index}]`, issues);
    if (node) nodes.push(node);
  }
  return nodes;
}

function readNode(value: unknown, path: string, issues: string[]): GraphNode | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  const id = readId(value.id, `${path}.id`, issues);
  const type = readId(value.type, `${path}.type`, issues);
  const props = value.props === undefined ? undefined : readProps(value.props, `${path}.props`, issues);
  const pins = value.pins === undefined ? undefined : readProps(value.pins, `${path}.pins`, issues);
  const pos = value.pos === undefined ? undefined : readPoint(value.pos, `${path}.pos`, issues);
  if (!id || !type || (value.props !== undefined && !props) || (value.pins !== undefined && !pins) || (value.pos !== undefined && !pos)) {
    return null;
  }
  const node: GraphNode = { id, type };
  if (props) node.props = props;
  if (pins) node.pins = pins;
  if (pos) node.pos = pos;
  return node;
}

function readEdges(value: unknown, issues: string[]): GraphEdge[] | null {
  if (!Array.isArray(value)) {
    issues.push('edges must be an array');
    return null;
  }
  const edges: GraphEdge[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const edge = readEdge(value[index], `edges[${index}]`, issues);
    if (edge) edges.push(edge);
  }
  return edges;
}

function readEdge(value: unknown, path: string, issues: string[]): GraphEdge | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  const from = readEndpoint(value.from, `${path}.from`, issues);
  const to = readEndpoint(value.to, `${path}.to`, issues);
  if (!from || !to) return null;
  const edge: GraphEdge = { from, to };
  if (value.id !== undefined) {
    const id = readId(value.id, `${path}.id`, issues);
    if (!id) return null;
    edge.id = id;
  }
  return edge;
}

function readEndpoint(value: unknown, path: string, issues: string[]): PinEndpoint | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  const node = readId(value.node, `${path}.node`, issues);
  const pin = readId(value.pin, `${path}.pin`, issues);
  if (!node || !pin) return null;
  return { node, pin };
}

function readGroups(value: unknown, issues: string[]): GraphGroup[] | null {
  if (!Array.isArray(value)) {
    issues.push('groups must be an array');
    return null;
  }
  const groups: GraphGroup[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const group = readGroup(value[index], `groups[${index}]`, issues);
    if (group) groups.push(group);
  }
  return groups;
}

function readGroup(value: unknown, path: string, issues: string[]): GraphGroup | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  const id = readId(value.id, `${path}.id`, issues);
  if (!id) return null;
  const group: GraphGroup = { id };
  if (typeof value.title === 'string') group.title = value.title;
  if (Array.isArray(value.nodeIds) && value.nodeIds.every((item) => typeof item === 'string')) group.nodeIds = [...value.nodeIds];
  if (value.pos !== undefined) {
    const pos = readPoint(value.pos, `${path}.pos`, issues);
    if (!pos) return null;
    group.pos = pos;
  }
  if (value.size !== undefined) {
    const size = readSize(value.size, `${path}.size`, issues);
    if (!size) return null;
    group.size = size;
  }
  return group;
}

function readComments(value: unknown, issues: string[]): GraphComment[] | null {
  if (!Array.isArray(value)) {
    issues.push('comments must be an array');
    return null;
  }
  const comments: GraphComment[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const comment = readComment(value[index], `comments[${index}]`, issues);
    if (comment) comments.push(comment);
  }
  return comments;
}

function readComment(value: unknown, path: string, issues: string[]): GraphComment | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  const id = readId(value.id, `${path}.id`, issues);
  if (!id) return null;
  const comment: GraphComment = { id };
  if (typeof value.text === 'string') comment.text = value.text;
  if (value.pos !== undefined) {
    const pos = readPoint(value.pos, `${path}.pos`, issues);
    if (!pos) return null;
    comment.pos = pos;
  }
  if (value.size !== undefined) {
    const size = readSize(value.size, `${path}.size`, issues);
    if (!size) return null;
    comment.size = size;
  }
  return comment;
}

function readProps(value: unknown, path: string, issues: string[]): Record<string, unknown> | null {
  if (!isRecord(value) || !isJsonValue(value)) {
    issues.push(`${path} must be a JSON object`);
    return null;
  }
  return value;
}

function readPoint(value: unknown, path: string, issues: string[]): GraphPoint | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    issues.push(`${path} must be {x, y}`);
    return null;
  }
  return { x: value.x, y: value.y };
}

function readSize(value: unknown, path: string, issues: string[]): { width: number; height: number } | null {
  if (!isRecord(value) || !isFiniteNumber(value.width) || !isFiniteNumber(value.height) || value.width <= 0 || value.height <= 0) {
    issues.push(`${path} must be {width, height} with positive size`);
    return null;
  }
  return { width: value.width, height: value.height };
}

function claimId(ids: Set<string>, id: string, label: string, issues: string[]): void {
  if (ids.has(id)) issues.push(`duplicate id ${id} (${label})`);
  ids.add(id);
}

function readId(value: unknown, path: string, issues: string[]): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(`${path} must be a non-empty string`);
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}
