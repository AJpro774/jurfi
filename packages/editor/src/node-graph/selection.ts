import type { GraphRect } from '@jurfi/script';
import { intersects } from './geometry';

export interface GraphSelection {
  nodes: string[];
  comments: string[];
  groups: string[];
  edge: { fromNode: string; fromPin: string; toNode: string; toPin: string } | null;
}

export function emptySelection(): GraphSelection {
  return { nodes: [], comments: [], groups: [], edge: null };
}

export function toggleMember(current: readonly string[], id: string): string[] {
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

export function mergeIds(current: readonly string[], hits: readonly string[], additive: boolean): string[] {
  if (!additive) return [...new Set(hits)];
  return [...new Set([...current, ...hits])];
}

export function idsTouchingRect(items: readonly { id: string; rect: GraphRect }[], marquee: GraphRect): string[] {
  return items.filter((item) => intersects(item.rect, marquee)).map((item) => item.id);
}
