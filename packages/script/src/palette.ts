import { getNodeHandler } from './handlers';
import type { NodeDef, NodeRegistry } from './registry';

export interface PaletteGap {
  typeId: string;
  reason: 'missing-handler';
}

/** Palette entries. Hidden definitions stay registered but are left out. */
export function paletteNodes(registry: NodeRegistry): NodeDef[] {
  return registry.list().filter((def) => def.hidden !== true);
}

/**
 * Visible palette nodes that have no runtime handler.
 * Hidden nodes are excluded: flagging `hidden` is the supported way to keep an unfinished node out of the palette.
 */
export function paletteGaps(registry: NodeRegistry): PaletteGap[] {
  const gaps: PaletteGap[] = [];
  for (const def of paletteNodes(registry)) {
    if (!getNodeHandler(def.typeId)) gaps.push({ typeId: def.typeId, reason: 'missing-handler' });
  }
  return gaps;
}
