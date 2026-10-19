import type { NodeDef, NodeRegistry, PinSpec } from './registry';
import type { VariableScope } from './schema';
import type { EntityRef, ScriptWorld } from './world';

/** Context passed to a `defineScript` run or value function. */
export interface ScriptNodeContext {
  readonly dt: number;
  readonly world: ScriptWorld;
  readonly nodeId: string;
  readonly props: Record<string, unknown>;
  read(pin: string): unknown;
  /** Take an exec output. Calling this skips the automatic `then` follow. */
  follow(pin: string): void;
  getVariable(name: string, scope?: VariableScope): unknown;
  setVariable(name: string, value: unknown, scope?: VariableScope): void;
  num(value: unknown): number;
  truthy(value: unknown): boolean;
  entity(value?: unknown): EntityRef;
}

export interface DefineScriptOptions {
  typeId: string;
  category?: string;
  doc?: string;
  /** Defaults to an exec input and a `then` output. */
  pins?: readonly PinSpec[];
  /** Omit from the script palette. Required when the script has no `run` or `value`. */
  hidden?: boolean;
  pure?: boolean;
  run?: (ctx: ScriptNodeContext) => void;
  value?: (ctx: ScriptNodeContext, pin: string) => unknown;
}

export interface DefinedScript {
  readonly typeId: string;
  readonly def: NodeDef;
  register(registry: NodeRegistry): NodeDef;
}

interface DefinedRecord {
  run?: (ctx: ScriptNodeContext) => void;
  value?: (ctx: ScriptNodeContext, pin: string) => unknown;
}

const records = new Map<string, DefinedRecord>();

const DEFAULT_PINS: readonly PinSpec[] = [
  { name: 'exec', kind: 'exec', direction: 'in' },
  { name: 'then', kind: 'exec', direction: 'out' },
];

/**
 * Register a TypeScript script or a custom node.
 * Plain scripts get an exec input and a `then` output, and follow `then` unless `follow` was called.
 * The definition shows up in the palette after `register`, unless `hidden` is set.
 */
export function defineScript(options: DefineScriptOptions): DefinedScript {
  if (!options.typeId) throw new Error('defineScript typeId is required');
  if (!options.run && !options.value && options.hidden !== true) {
    throw new Error(`defineScript("${options.typeId}") needs run, value, or hidden: true`);
  }
  const def: NodeDef = {
    typeId: options.typeId,
    category: options.category ?? 'script',
    doc: options.doc ?? options.typeId,
    pins: options.pins ?? DEFAULT_PINS,
    ...(options.pure ? { pure: true } : {}),
    ...(options.hidden === true ? { hidden: true } : {}),
  };
  records.set(options.typeId, { run: options.run, value: options.value });
  return {
    typeId: options.typeId,
    def,
    register(registry) {
      registry.register(def);
      return def;
    },
  };
}

export function hasDefinedScript(typeId: string): boolean {
  return records.has(typeId);
}

/** Host surface `defineScript` callbacks need. Interpreter and compiled host both adapt to this. */
export interface ScriptCall {
  dt: number;
  world: ScriptWorld;
  nodeId: string;
  props: Record<string, unknown>;
  read(pin: string): unknown;
  follow(pin: string): void;
  entity(value: unknown): EntityRef;
  num(value: unknown): number;
  truthy(value: unknown): boolean;
  getVar(scope: VariableScope, name: string, entity?: EntityRef): unknown;
  setVar(scope: VariableScope, name: string, value: unknown, entity?: EntityRef): void;
}

function makeCtx(call: ScriptCall, onFollow?: () => void): ScriptNodeContext {
  return {
    dt: call.dt,
    world: call.world,
    nodeId: call.nodeId,
    props: call.props,
    read: (pin) => call.read(pin),
    follow: (pin) => {
      onFollow?.();
      call.follow(pin);
    },
    getVariable: (name, scope = 'graph') =>
      scope === 'entity' ? call.getVar('entity', name, call.entity(undefined)) : call.getVar('graph', name),
    setVariable: (name, value, scope = 'graph') => {
      if (scope === 'entity') call.setVar('entity', name, value, call.entity(undefined));
      else call.setVar('graph', name, value);
    },
    num: (value) => call.num(value),
    truthy: (value) => call.truthy(value),
    entity: (value) => call.entity(value),
  };
}

/**
 * Runs a defined script. Returns false when nothing is registered or the script has no `run`,
 * so the caller can pass execution through `then`.
 */
export function callDefinedRun(typeId: string, call: ScriptCall): boolean {
  const record = records.get(typeId);
  if (!record?.run) return false;
  let followed = false;
  record.run(makeCtx(call, () => {
    followed = true;
  }));
  if (!followed) call.follow('then');
  return true;
}

export function callDefinedValue(typeId: string, call: ScriptCall, pin: string): unknown {
  const record = records.get(typeId);
  if (!record?.value) return undefined;
  return record.value(makeCtx(call), pin);
}
