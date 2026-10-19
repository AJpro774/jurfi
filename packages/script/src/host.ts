import { createScriptWorld, createWorld } from '@jurfi/core';
import type { CompiledProgram } from './ir';
import { faultMessage, NODE_FAULT_CAP, type NodeFault } from './fault';
import { callDefinedRun, callDefinedValue, type ScriptCall } from './scripts';
import type { VariableScope } from './schema';
import { valuesEqual } from './util';
import type { EntityRef, ScriptWorld } from './world';

export { defineScript } from './scripts';
export type { DefineScriptOptions, DefinedScript, ScriptNodeContext } from './scripts';

export interface HostBindings {
  start(host: ScriptHost): void;
  update(host: ScriptHost): void;
}

export interface ScriptHostOptions {
  /** Scene adapter. Defaults to `createScriptWorld(createWorld())`. */
  world?: ScriptWorld;
  maxSteps?: number;
  onNodeError?: (fault: NodeFault) => void;
}

/**
 * Small runtime for JavaScript emitted by the compiler.
 * This module must not import the graph interpreter.
 */
export interface ScriptHost {
  readonly world: ScriptWorld;
  readonly running: boolean;
  readonly halted: boolean;
  readonly dt: number;
  readonly maxSteps: number;
  readonly nodeErrors: readonly NodeFault[];
  loadProgram(program: CompiledProgram): void;
  bind(bindings: HostBindings): void;
  addListener(scope: string, eventName: string, nodeId: string, run: (host: ScriptHost) => void): void;
  start(): void;
  tick(dt: number): void;
  stop(): void;
  emit(eventName: string, payload?: unknown): void;
  getVariable(name: string, scope?: VariableScope): unknown;
  setVariable(name: string, value: unknown, scope?: VariableScope): void;
  clearNodeErrors(): void;
  dispose(): void;
  step(nodeId: string): boolean;
  num(value: unknown): number;
  truthy(value: unknown): boolean;
  entity(value: unknown): EntityRef;
  equal(a: unknown, b: unknown): boolean;
  graphGet(scope: string, name: string): unknown;
  graphSet(scope: string, name: string, value: unknown): void;
  entityGet(entity: EntityRef, name: string): unknown;
  entitySet(entity: EntityRef, name: string, value: unknown): void;
  readLoop(scope: string, nodeId: string): number;
  writeLoop(scope: string, nodeId: string, index: number): void;
  delay(seconds: number, resume: () => void): void;
  payload(scope: string, nodeId: string): unknown;
  dispatch(scope: string, eventName: string, payload: unknown): void;
  getField(entity: EntityRef, component: string, field: string): unknown;
  setField(entity: EntityRef, component: string, field: string, value: unknown): void;
  readValue(nodeId: string, pin: string, compute: () => unknown): unknown;
  scriptExec(
    typeId: string,
    scope: string,
    nodeId: string,
    read: (pin: string) => unknown,
    follow: (pin: string) => void,
  ): void;
  scriptValue(
    typeId: string,
    scope: string,
    nodeId: string,
    pin: string,
    read: (pin: string) => unknown,
  ): unknown;
  fault(nodeId: string, error: unknown): void;
}

interface DelayTimer {
  remaining: number;
  resume: () => void;
}

interface Listener {
  nodeId: string;
  run: (host: ScriptHost) => void;
}

const DEFAULT_MAX_STEPS = 100_000;

class CompiledHost implements ScriptHost {
  readonly world: ScriptWorld;
  readonly maxSteps: number;

  running = false;
  halted = false;
  dt = 0;

  private program: CompiledProgram | null = null;
  private bindings: HostBindings | null = null;
  private readonly onNodeError?: (fault: NodeFault) => void;
  private readonly faults: NodeFault[] = [];
  private readonly graphVars = new Map<string, Map<string, unknown>>();
  private readonly entityVars = new Map<string, Map<string, unknown>>();
  private readonly loopValues = new Map<string, number>();
  private readonly payloads = new Map<string, unknown>();
  private readonly listeners = new Map<string, Listener[]>();
  private readonly reading = new Set<string>();
  private delays: DelayTimer[] = [];
  private steps = 0;

  constructor(options: ScriptHostOptions = {}) {
    this.world = options.world ?? createScriptWorld(createWorld());
    this.onNodeError = options.onNodeError;
    const requested = options.maxSteps;
    this.maxSteps =
      typeof requested === 'number' && requested > 0 ? Math.floor(requested) : DEFAULT_MAX_STEPS;
  }

  get nodeErrors(): readonly NodeFault[] {
    return this.faults;
  }

  loadProgram(program: CompiledProgram): void {
    this.program = program;
  }

  bind(bindings: HostBindings): void {
    this.bindings = bindings;
  }

  addListener(scope: string, eventName: string, nodeId: string, run: (host: ScriptHost) => void): void {
    const key = `${scope}\0${eventName}`;
    const list = this.listeners.get(key);
    if (list) list.push({ nodeId, run });
    else this.listeners.set(key, [{ nodeId, run }]);
  }

  start(): void {
    if (!this.program) throw new Error('No graph loaded');
    this.graphVars.clear();
    this.entityVars.clear();
    this.loopValues.clear();
    this.payloads.clear();
    this.delays = [];
    this.faults.length = 0;
    this.reading.clear();
    this.halted = false;
    this.steps = 0;
    this.dt = 0;
    this.running = true;
    this.bindings?.start(this);
  }

  tick(dt: number): void {
    if (!this.running) return;
    this.dt = typeof dt === 'number' && Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.steps = 0;
    this.halted = false;
    this.reading.clear();
    this.flushDelays();
    if (!this.halted) this.bindings?.update(this);
  }

  stop(): void {
    this.running = false;
    this.halted = false;
    this.delays = [];
    this.reading.clear();
  }

  dispose(): void {
    this.stop();
    this.program = null;
    this.bindings = null;
    this.listeners.clear();
    this.graphVars.clear();
    this.entityVars.clear();
    this.loopValues.clear();
    this.payloads.clear();
    this.faults.length = 0;
  }

  emit(eventName: string, payload?: unknown): void {
    if (!this.running) return;
    this.steps = 0;
    this.halted = false;
    this.dispatch('root', eventName, payload);
  }

  getVariable(name: string, scope: VariableScope = 'graph'): unknown {
    if (scope === 'entity') return this.entityGet(this.world.self, name);
    return this.graphGet('root', name);
  }

  setVariable(name: string, value: unknown, scope: VariableScope = 'graph'): void {
    if (scope === 'entity') this.entitySet(this.world.self, name, value);
    else this.graphSet('root', name, value);
  }

  clearNodeErrors(): void {
    this.faults.length = 0;
  }

  step(nodeId: string): boolean {
    if (this.halted) return false;
    this.steps += 1;
    if (this.steps > this.maxSteps) {
      this.halted = true;
      this.fault(nodeId, new Error(`Exceeded ${this.maxSteps} script steps`));
      return false;
    }
    return true;
  }

  num(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  truthy(value: unknown): boolean {
    return Boolean(value);
  }

  entity(value: unknown): EntityRef {
    if (value && typeof value === 'object' && 'id' in value) {
      const id = (value as { id: unknown }).id;
      if (typeof id === 'string' || typeof id === 'number') return value as EntityRef;
    }
    return this.world.self;
  }

  equal(a: unknown, b: unknown): boolean {
    return valuesEqual(a, b);
  }

  graphGet(scope: string, name: string): unknown {
    return this.graphVars.get(scope)?.get(name);
  }

  graphSet(scope: string, name: string, value: unknown): void {
    let bucket = this.graphVars.get(scope);
    if (!bucket) {
      bucket = new Map();
      this.graphVars.set(scope, bucket);
    }
    bucket.set(name, value);
  }

  entityGet(entity: EntityRef, name: string): unknown {
    if (this.world.getVariable) return this.world.getVariable(entity, name);
    return this.entityVars.get(String(entity.id))?.get(name);
  }

  entitySet(entity: EntityRef, name: string, value: unknown): void {
    if (this.world.setVariable) {
      this.world.setVariable(entity, name, value);
      return;
    }
    const key = String(entity.id);
    let bucket = this.entityVars.get(key);
    if (!bucket) {
      bucket = new Map();
      this.entityVars.set(key, bucket);
    }
    bucket.set(name, value);
  }

  readLoop(scope: string, nodeId: string): number {
    return this.loopValues.get(`${scope}\0${nodeId}`) ?? 0;
  }

  writeLoop(scope: string, nodeId: string, index: number): void {
    this.loopValues.set(`${scope}\0${nodeId}`, index);
  }

  delay(seconds: number, resume: () => void): void {
    if (!(seconds > 0)) {
      resume();
      return;
    }
    this.delays.push({ remaining: seconds, resume });
  }

  payload(scope: string, nodeId: string): unknown {
    return this.payloads.get(`${scope}\0${nodeId}`);
  }

  dispatch(scope: string, eventName: string, payload: unknown): void {
    const list = this.listeners.get(`${scope}\0${eventName}`);
    if (!list) return;
    for (const listener of list) {
      if (this.halted) return;
      this.payloads.set(`${scope}\0${listener.nodeId}`, payload);
      listener.run(this);
    }
  }

  getField(entity: EntityRef, component: string, field: string): unknown {
    if (this.world.getField) return this.world.getField(entity, component, field);
    const current = this.world.getComponent(entity, component);
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[field];
    }
    return undefined;
  }

  setField(entity: EntityRef, component: string, field: string, value: unknown): void {
    if (this.world.setField) {
      this.world.setField(entity, component, field, value);
      return;
    }
    const current = this.world.getComponent(entity, component);
    const base: Record<string, unknown> =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};
    base[field] = value;
    this.world.setComponent(entity, component, base);
  }

  readValue(nodeId: string, pin: string, compute: () => unknown): unknown {
    const token = `${nodeId}\0${pin}`;
    if (this.reading.has(token)) {
      this.halted = true;
      this.fault(nodeId, new Error(`Data cycle while reading node "${nodeId}" pin "${pin}"`));
      return undefined;
    }
    this.reading.add(token);
    try {
      return compute();
    } catch (error) {
      this.fault(nodeId, error);
      return undefined;
    } finally {
      this.reading.delete(token);
    }
  }

  scriptExec(
    typeId: string,
    scope: string,
    nodeId: string,
    read: (pin: string) => unknown,
    follow: (pin: string) => void,
  ): void {
    if (!callDefinedRun(typeId, this.scriptCall(scope, nodeId, read, follow))) follow('then');
  }

  scriptValue(
    typeId: string,
    scope: string,
    nodeId: string,
    pin: string,
    read: (pin: string) => unknown,
  ): unknown {
    return callDefinedValue(typeId, this.scriptCall(scope, nodeId, read, () => undefined), pin);
  }

  fault(nodeId: string, error: unknown): void {
    const fault: NodeFault = { nodeId, message: faultMessage(error), error };
    if (this.faults.length < NODE_FAULT_CAP) this.faults.push(fault);
    this.onNodeError?.(fault);
  }

  private scriptCall(
    scope: string,
    nodeId: string,
    read: (pin: string) => unknown,
    follow: (pin: string) => void,
  ): ScriptCall {
    const props = this.programAt(scope)?.nodes[nodeId]?.props ?? {};
    return {
      dt: this.dt,
      world: this.world,
      nodeId,
      props,
      read,
      follow,
      entity: (value) => this.entity(value),
      num: (value) => this.num(value),
      truthy: (value) => this.truthy(value),
      getVar: (varScope, name, entity) =>
        varScope === 'entity' ? this.entityGet(entity ?? this.world.self, name) : this.graphGet(scope, name),
      setVar: (varScope, name, value, entity) => {
        if (varScope === 'entity') this.entitySet(entity ?? this.world.self, name, value);
        else this.graphSet(scope, name, value);
      },
    };
  }

  private programAt(scope: string): CompiledProgram | undefined {
    const root = this.program;
    if (!root) return undefined;
    if (scope === 'root' || scope === '') return root;
    const parts = scope.split('/');
    let current: CompiledProgram | undefined = root;
    for (let i = 1; i < parts.length; i += 1) {
      const id = parts[i];
      if (!current || id === undefined) return undefined;
      current = current.subgraphs[id];
    }
    return current;
  }

  private flushDelays(): void {
    if (this.dt <= 0 || this.delays.length === 0) return;
    const pending: DelayTimer[] = [];
    const ready: DelayTimer[] = [];
    for (const timer of this.delays) {
      timer.remaining -= this.dt;
      if (timer.remaining <= 0) ready.push(timer);
      else pending.push(timer);
    }
    this.delays = pending;
    for (const timer of ready) {
      if (this.halted) break;
      timer.resume();
    }
  }
}

export function createScriptHost(options?: ScriptHostOptions): ScriptHost {
  return new CompiledHost(options);
}
