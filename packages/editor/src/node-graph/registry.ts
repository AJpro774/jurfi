import { createBuiltinRegistry, createNodeRegistry, resolvePins } from '@jurfi/script';
import type { GraphNode, NodeDef, NodeRegistry, PinSpec } from '@jurfi/script';

export type { NodeDef, NodeRegistry, PinSpec };
export { createNodeRegistry, resolvePins };

export interface NodePropField {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'boolean';
}

const PROP_FIELDS: Record<string, readonly NodePropField[]> = {
  'core/OnEvent': [{ key: 'event', label: 'Event', kind: 'string' }],
  'core/FireEvent': [{ key: 'event', label: 'Event', kind: 'string' }],
  'core/Sequence': [{ key: 'count', label: 'Count', kind: 'number' }],
  'core/GetVariable': [
    { key: 'name', label: 'Name', kind: 'string' },
    { key: 'scope', label: 'Scope', kind: 'string' },
  ],
  'core/SetVariable': [
    { key: 'name', label: 'Name', kind: 'string' },
    { key: 'scope', label: 'Scope', kind: 'string' },
  ],
  'core/GetComponent': [{ key: 'component', label: 'Component', kind: 'string' }],
  'core/SetComponent': [{ key: 'component', label: 'Component', kind: 'string' }],
  'core/GetField': [
    { key: 'component', label: 'Component', kind: 'string' },
    { key: 'field', label: 'Field', kind: 'string' },
  ],
  'core/SetField': [
    { key: 'component', label: 'Component', kind: 'string' },
    { key: 'field', label: 'Field', kind: 'string' },
  ],
  'core/Subgraph': [{ key: 'graph', label: 'Graph', kind: 'string' }],
};

export function nodeTitle(def: NodeDef | undefined, typeId: string): string {
  const leaf = typeId.split('/').pop();
  return leaf && leaf.length > 0 ? leaf : typeId;
}

export function nodeFields(def: NodeDef | undefined): readonly NodePropField[] {
  if (!def) return [];
  return PROP_FIELDS[def.typeId] ?? [];
}

export function nodePins(node: GraphNode, registry: NodeRegistry): PinSpec[] {
  const def = registry.get(node.type);
  if (!def) return [];
  return resolvePins(def, node.props);
}

export function searchNodes(registry: NodeRegistry, query: string): readonly NodeDef[] {
  const needle = query.trim().toLowerCase();
  const all = registry.list();
  if (!needle) return all;
  return all.filter((def) => {
    const title = nodeTitle(def, def.typeId);
    return `${title} ${def.typeId} ${def.category} ${def.doc}`.toLowerCase().includes(needle);
  });
}

export function createRegistry(definitions: readonly NodeDef[] = []): NodeRegistry {
  return createNodeRegistry(definitions);
}

export function createDefaultRegistry(): NodeRegistry {
  return createBuiltinRegistry();
}
