import type { GraphComment, GraphGroup, GraphNode, GraphPoint, PinSpec } from '@jurfi/script';

/** Editor layout rectangle. Groups and comments store this as `pos` + `size`. */
export interface GraphRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Vec2 = GraphPoint;

/** Layout numbers shared with the canvas CSS variables set at mount. */
export const LAYOUT = {
  nodeWidth: 220,
  header: 28,
  row: 24,
  field: 28,
  fieldPad: 8,
  pin: 12,
} as const;

export function nodeHeight(inputCount: number, outputCount: number, fieldCount: number): number {
  const rows = Math.max(inputCount, outputCount, 1);
  const fields = fieldCount > 0 ? LAYOUT.fieldPad + fieldCount * LAYOUT.field : LAYOUT.fieldPad;
  return LAYOUT.header + rows * LAYOUT.row + fields;
}

/** Canvas position. Nodes may omit `pos` until the editor places them. */
export function nodePos(node: GraphNode): Vec2 {
  return node.pos ?? { x: 0, y: 0 };
}

export function nodeRect(node: GraphNode, pins: readonly PinSpec[], fieldCount: number): GraphRect {
  const inputs = pins.filter((pin) => pin.direction === 'in').length;
  const outputs = pins.filter((pin) => pin.direction === 'out').length;
  const pos = nodePos(node);
  return {
    x: pos.x,
    y: pos.y,
    w: LAYOUT.nodeWidth,
    h: nodeHeight(inputs, outputs, fieldCount),
  };
}

export function pinAnchor(node: GraphNode, pins: readonly PinSpec[], pinName: string): Vec2 | null {
  const pin = pins.find((item) => item.name === pinName);
  if (!pin) return null;
  const row = pins.filter((item) => item.direction === pin.direction).findIndex((item) => item.name === pinName);
  if (row < 0) return null;
  const pos = nodePos(node);
  return {
    x: pos.x + (pin.direction === 'out' ? LAYOUT.nodeWidth : 0),
    y: pos.y + LAYOUT.header + row * LAYOUT.row + LAYOUT.row / 2,
  };
}

export function blockRect(
  block: { pos?: GraphPoint; size?: { width: number; height: number } },
  fallback: { w: number; h: number },
): GraphRect {
  return {
    x: block.pos?.x ?? 0,
    y: block.pos?.y ?? 0,
    w: block.size?.width ?? fallback.w,
    h: block.size?.height ?? fallback.h,
  };
}

export function groupRect(group: GraphGroup): GraphRect {
  return blockRect(group, { w: 200, h: 120 });
}

export function commentRect(comment: GraphComment): GraphRect {
  return blockRect(comment, { w: 200, h: 96 });
}

export function rectFields(rect: GraphRect): { pos: GraphPoint; size: { width: number; height: number } } {
  return { pos: { x: rect.x, y: rect.y }, size: { width: rect.w, height: rect.h } };
}

export function intersects(a: GraphRect, b: GraphRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): GraphRect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export function unionRects(rects: readonly GraphRect[]): GraphRect | null {
  const first = rects[0];
  if (!first) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.w;
  let maxY = first.y + first.h;
  for (const rect of rects.slice(1)) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function padRect(rect: GraphRect, pad: number): GraphRect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
}

export interface WireGeometry {
  path: string;
  mid: Vec2;
}

export function wireGeometry(from: Vec2, to: Vec2, fromDir: PinSpec['direction'] = 'out'): WireGeometry {
  const sign = fromDir === 'out' ? 1 : -1;
  const dx = Math.max(48, Math.abs(to.x - from.x) * 0.45) * sign;
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx, y: to.y };
  const mid = cubicPoint(from, c1, c2, to, 0.5);
  return {
    path: `M ${from.x} ${from.y} C ${c1.x} ${from.y}, ${c2.x} ${to.y}, ${to.x} ${to.y}`,
    mid,
  };
}

function cubicPoint(a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
    y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y,
  };
}
