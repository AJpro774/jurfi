import { DATA_TYPES, GRAPH_VERSION } from '@jurfi/script';
import type {
  DataType,
  GraphComment,
  GraphDocument,
  GraphEdge,
  GraphGroup,
  GraphNode,
  GraphPin,
  GraphRect,
  RuntimeGraphDocument,
} from '@jurfi/script';
import { normalizeConnections } from './validate';

const DATA_TYPE_SET = new Set<string>(DATA_TYPES);

export class GraphSchemaError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join('\n'));
    this.name = 'GraphSchemaError';
    this.issues = issues;
  }
}

export function createEmptyGraph(): GraphDocument {
  return { version: GRAPH_VERSION, nodes: [], edges: [], groups: [], comments: [] };
}

export function serializeGraph(doc: GraphDocument): string {
  return JSON.stringify(canonicalDocument(doc));
}

export function deserializeGraph(input: string | unknown): GraphDocument {
  const parsed = parseGraph(input);
  if (!parsed.ok) throw new GraphSchemaError(parsed.issues);
  return parsed.document;
}

export function parseGraph(
  input: string | unknown,
): { ok: true; document: GraphDocument } | { ok: false; issues: string[] } {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return { ok: false, issues: ['Graph JSON is not valid JSON'] };
    }
  }
  const issues: string[] = [];
  const document = readDocument(value, issues);
  if (!document || issues.length > 0) return { ok: false, issues };
  const normalized = normalizeConnections(document);
  if (normalized.issues.length > 0) return { ok: false, issues: normalized.issues };
  return { ok: true, document: canonicalDocument(normalized.document) };
}

/** Drop editor-only `pos`, `groups`, and `comments` for a game export. */
export function stripEditorData(doc: GraphDocument): RuntimeGraphDocument {
  return {
    version: doc.version,
    nodes: doc.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      pins: node.pins.map(canonicalPin),
      props: node.props,
    })),
    edges: doc.edges.map((edge) => ({
      from: { node: edge.from.node, pin: edge.from.pin },
      to: { node: edge.to.node, pin: edge.to.pin },
    })),
  };
}

function canonicalDocument(doc: GraphDocument): GraphDocument {
  return {
    version: doc.version,
    nodes: doc.nodes.map(canonicalNode),
    edges: doc.edges.map((edge) => ({
      from: { node: edge.from.node, pin: edge.from.pin },
      to: { node: edge.to.node, pin: edge.to.pin },
    })),
    groups: doc.groups.map((group) => ({
      id: group.id,
      title: group.title,
      nodeIds: [...group.nodeIds],
      rect: { ...group.rect },
    })),
    comments: doc.comments.map((comment) => ({
      id: comment.id,
      text: comment.text,
      rect: { ...comment.rect },
    })),
  };
}

function canonicalNode(node: GraphNode): GraphNode {
  return {
    id: node.id,
    type: node.type,
    pins: node.pins.map(canonicalPin),
    props: node.props,
    pos: { x: node.pos.x, y: node.pos.y },
  };
}

function canonicalPin(pin: GraphPin): GraphPin {
  const next: GraphPin = { id: pin.id, name: pin.name, kind: pin.kind, direction: pin.direction };
  if (pin.kind === 'data' && pin.dataType) next.dataType = pin.dataType;
  return next;
}

function readDocument(value: unknown, issues: string[]): GraphDocument | null {
  if (!isRecord(value)) {
    issues.push('Graph must be an object');
    return null;
  }
  if (value.version !== GRAPH_VERSION) issues.push(`version must be ${GRAPH_VERSION}`);
  const nodes = readNodes(value.nodes, issues);
  const edges = readEdges(value.edges, issues);
  const groups = readGroups(value.groups, issues);
  const comments = readComments(value.comments, issues);
  if (!nodes || !edges || !groups || !comments || issues.length > 0) return null;

  const ids = new Set<string>();
  for (const node of nodes) claimId(ids, node.id, `node ${node.id}`, issues);
  for (const group of groups) claimId(ids, group.id, `group ${group.id}`, issues);
  for (const comment of comments) claimId(ids, comment.id, `comment ${comment.id}`, issues);

  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      if (!nodeIds.has(nodeId)) issues.push(`group ${group.id} references missing node ${nodeId}`);
    }
  }
  for (const edge of edges) {
    if (!endpointExists(nodes, edge.from)) issues.push('edge references a missing pin');
    if (!endpointExists(nodes, edge.to)) issues.push('edge references a missing pin');
  }
  if (issues.length > 0) return null;
  return { version: GRAPH_VERSION, nodes, edges, groups, comments };
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
  const pins = readPins(value.pins, `${path}.pins`, issues);
  const props = readProps(value.props, `${path}.props`, issues);
  const pos = readVec(value.pos, `${path}.pos`, issues);
  if (!id || !type || !pins || !props || !pos) return null;
  const pinIds = new Set<string>();
  for (const pin of pins) {
    if (pinIds.has(pin.id)) issues.push(`${path} has duplicate pin ${pin.id}`);
    pinIds.add(pin.id);
  }
  return { id, type, pins, props, pos };
}

function readPins(value: unknown, path: string, issues: string[]): GraphPin[] | null {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return null;
  }
  const pins: GraphPin[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const pin = readPin(value[index], `${path}[${index}]`, issues);
    if (pin) pins.push(pin);
  }
  return pins;
}

function readPin(value: unknown, path: string, issues: string[]): GraphPin | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  const id = readId(value.id, `${path}.id`, issues);
  const name = typeof value.name === 'string' ? value.name : null;
  if (name === null) issues.push(`${path}.name must be a string`);
  const kind = value.kind === 'exec' || value.kind === 'data' ? value.kind : null;
  const direction = value.direction === 'in' || value.direction === 'out' ? value.direction : null;
  if (!kind) issues.push(`${path}.kind must be exec or data`);
  if (!direction) issues.push(`${path}.direction must be in or out`);
  let dataType: DataType | undefined;
  if (kind === 'data') {
    if (typeof value.dataType !== 'string' || !DATA_TYPE_SET.has(value.dataType)) {
      issues.push(`${path}.dataType is invalid`);
    } else dataType = value.dataType as DataType;
  }
  if (!id || name === null || !kind || !direction || (kind === 'data' && !dataType)) return null;
  const pin: GraphPin = { id, name, kind, direction };
  if (dataType) pin.dataType = dataType;
  return pin;
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
  return { from, to };
}

function readEndpoint(value: unknown, path: string, issues: string[]): GraphEdge['from'] | null {
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
  if (typeof value.title !== 'string') issues.push(`${path}.title must be a string`);
  const rect = readRect(value.rect, `${path}.rect`, issues);
  const nodeIds = Array.isArray(value.nodeIds) ? value.nodeIds.filter((item): item is string => typeof item === 'string') : null;
  if (!Array.isArray(value.nodeIds)) issues.push(`${path}.nodeIds must be an array`);
  else if (nodeIds && nodeIds.length !== value.nodeIds.length) issues.push(`${path}.nodeIds must contain strings`);
  if (!id || typeof value.title !== 'string' || !rect || !nodeIds) return null;
  return { id, title: value.title, nodeIds: [...nodeIds], rect };
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
  if (typeof value.text !== 'string') issues.push(`${path}.text must be a string`);
  const rect = readRect(value.rect, `${path}.rect`, issues);
  if (!id || typeof value.text !== 'string' || !rect) return null;
  return { id, text: value.text, rect };
}

function readProps(value: unknown, path: string, issues: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  if (!isJsonValue(value)) {
    issues.push(`${path} must be JSON data`);
    return null;
  }
  return value;
}

function readVec(value: unknown, path: string, issues: string[]): { x: number; y: number } | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    issues.push(`${path} must be {x, y}`);
    return null;
  }
  return { x: value.x, y: value.y };
}

function readRect(value: unknown, path: string, issues: string[]): GraphRect | null {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.w) ||
    !isFiniteNumber(value.h) ||
    value.w <= 0 ||
    value.h <= 0
  ) {
    issues.push(`${path} must be a rectangle with positive size`);
    return null;
  }
  return { x: value.x, y: value.y, w: value.w, h: value.h };
}

function endpointExists(nodes: readonly GraphNode[], endpoint: GraphEdge['from']): boolean {
  const node = nodes.find((item) => item.id === endpoint.node);
  return Boolean(node?.pins.some((pin) => pin.id === endpoint.pin));
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
