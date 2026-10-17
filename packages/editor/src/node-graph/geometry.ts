import type { GraphNode, GraphRect, PinDirection, Vec2 } from '@jurfi/script';

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

export function nodeRect(node: GraphNode, fieldCount: number): GraphRect {
  const inputs = node.pins.filter((pin) => pin.direction === 'in').length;
  const outputs = node.pins.filter((pin) => pin.direction === 'out').length;
  return {
    x: node.pos.x,
    y: node.pos.y,
    w: LAYOUT.nodeWidth,
    h: nodeHeight(inputs, outputs, fieldCount),
  };
}

export function pinAnchor(node: GraphNode, pinId: string): Vec2 | null {
  const pin = node.pins.find((item) => item.id === pinId);
  if (!pin) return null;
  const row = node.pins.filter((item) => item.direction === pin.direction).findIndex((item) => item.id === pinId);
  if (row < 0) return null;
  return {
    x: node.pos.x + (pin.direction === 'out' ? LAYOUT.nodeWidth : 0),
    y: node.pos.y + LAYOUT.header + row * LAYOUT.row + LAYOUT.row / 2,
  };
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

export function wireGeometry(from: Vec2, to: Vec2, fromDir: PinDirection = 'out'): WireGeometry {
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
