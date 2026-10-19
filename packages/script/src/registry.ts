import type { DataType, PinKind } from './schema';

export interface PinSpec {
  name: string;
  kind: PinKind;
  direction: 'in' | 'out';
  /** Present on data pins. Exec pins do not carry a data type. */
  dataType?: DataType;
  /** Used when the pin is unconnected and the instance has no literal. */
  default?: unknown;
  /** Unconnected data input without a literal or default is a compile error. */
  required?: boolean;
  label?: string;
}

/**
 * Extra exec outputs named `${prefix}${index}` for `index` in `0 .. count-1`.
 * `count` is read from `props[countProp]`, falling back to `defaultCount`.
 */
export interface VariadicExecOut {
  prefix: string;
  countProp: string;
  defaultCount: number;
  min?: number;
  max?: number;
}

/**
 * Declarative node definition. Registries are data only so other domains
 * (animation blend trees, for example) can keep their own registries and compilers.
 */
export interface NodeDef {
  /** Stable id such as `core/Add`. */
  typeId: string;
  category: string;
  doc: string;
  pins: readonly PinSpec[];
  /** Data-only node. It has no exec pins and is pulled by consumers. */
  pure?: boolean;
  variadicExecOut?: VariadicExecOut;
  /**
   * Leave this node out of the script palette.
   * Hidden is how an unfinished node stays registered without a handler.
   */
  hidden?: boolean;
}

/**
 * Pluggable node catalog. `register` rejects duplicate type ids and ill-formed pins.
 * Execution is not stored here; the script runtime binds handlers by `typeId`.
 */
export class NodeRegistry {
  private readonly defs = new Map<string, NodeDef>();

  register(def: NodeDef): this {
    if (!def.typeId) throw new Error('Node typeId is required');
    if (this.defs.has(def.typeId)) {
      throw new Error(`Node type already registered: ${def.typeId}`);
    }
    const names = new Set<string>();
    for (const pin of def.pins) {
      if (!pin.name) throw new Error(`Pin name is required on ${def.typeId}`);
      if (names.has(pin.name)) {
        throw new Error(`Duplicate pin "${pin.name}" on ${def.typeId}`);
      }
      names.add(pin.name);
      if (pin.kind === 'data' && !pin.dataType) {
        throw new Error(`Data pin "${pin.name}" on ${def.typeId} needs a dataType`);
      }
      if (pin.kind === 'exec' && pin.dataType !== undefined) {
        throw new Error(`Exec pin "${pin.name}" on ${def.typeId} cannot have a dataType`);
      }
    }
    this.defs.set(def.typeId, def);
    return this;
  }

  get(typeId: string): NodeDef | undefined {
    return this.defs.get(typeId);
  }

  /** Definitions in registration order. */
  list(): NodeDef[] {
    return [...this.defs.values()];
  }
}

export function createNodeRegistry(defs?: readonly NodeDef[]): NodeRegistry {
  const registry = new NodeRegistry();
  if (defs) {
    for (const def of defs) registry.register(def);
  }
  return registry;
}
