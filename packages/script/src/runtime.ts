import type { Disposable } from '@jurfi/core';
import { compile } from './compile';
import type { ExecHost } from './handlers';
import { getNodeHandler } from './handlers';
import type { CompiledNode, CompiledProgram, CompileResult } from './ir';
import type { NodeRegistry } from './registry';
import type { GraphDoc, VariableScope } from './schema';
import { createBuiltinRegistry } from './builtins';
import type { EntityRef, ScriptWorld } from './world';
import { createMemoryWorld } from './world';

export type DebugPhase = 'enter' | 'exit';

export interface DebugWireEvent {
  kind: 'wire';
  wireId: string;
  value: unknown;
}

export interface DebugNodeEvent {
  kind: 'node';
  nodeId: string;
  phase: DebugPhase;
}

export type DebugEvent = DebugWireEvent | DebugNodeEvent;

/** Editor-implemented listener. Events are emitted only while one is attached. */
export interface DebugSource {
  onEvent(event: DebugEvent): void;
}

export type RuntimeErrorCode = 'no-program' | 'max-steps' | 'data-cycle';

export class ScriptRuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly nodeId?: string;

  constructor(message: string, code: RuntimeErrorCode, nodeId?: string) {
    super(message);
    this.name = 'ScriptRuntimeError';
    this.code = code;
    this.nodeId = nodeId;
  }
}

export interface ScriptRuntimeOptions {
  /** Scene adapter. Defaults to an in-memory world with `self.id === 'self'`. */
  world?: ScriptWorld;
  /** Defaults to the built-in script registry. */
  registry?: NodeRegistry;
  /** Safety cap for one start, tick, emit, or resume. Default 100000. */
  maxSteps?: number;
}

/**
 * Play-mode session: load a graph, start, tick, stop.
 * Implements `Disposable` from `@jurfi/core`.
 */
export interface ScriptRuntime extends Disposable {
  readonly world: ScriptWorld;
  readonly registry: NodeRegistry;
  readonly paused: boolean;
  readonly running: boolean;
  load(doc: GraphDoc): CompileResult;
  loadProgram(program: CompiledProgram): void;
  start(): void;
  /** Advances simulated time. Ignored until `start`, and while paused. */
  tick(dt: number): void;
  stop(): void;
  dispose(): void;
  /** Fires `core/OnEvent` nodes in the root graph that listen for `eventName`. */
  emit(eventName: string, payload?: unknown): void;
  getVariable(name: string, scope?: VariableScope): unknown;
  setVariable(name: string, value: unknown, scope?: VariableScope): void;
  attachDebugger(source: DebugSource): void;
  detachDebugger(): void;
  setBreakpoint(nodeId: string): void;
  clearBreakpoint(nodeId: string): void;
  pause(): void;
  /** Runs the next node, then pauses. Control frames between nodes are not steps. */
  step(): void;
  resume(): void;
}

interface NodeFrame {
  kind: 'node';
  program: CompiledProgram;
  scope: string;
  nodeId: string;
  execPin: string;
  wireId?: string;
}

interface ForFrame {
  kind: 'for';
  program: CompiledProgram;
  scope: string;
  nodeId: string;
  index: number;
  last: number;
}

interface WhileFrame {
  kind: 'while';
  program: CompiledProgram;
  scope: string;
  nodeId: string;
}

type Frame = NodeFrame | ForFrame | WhileFrame;

interface Delay {
  remaining: number;
  program: CompiledProgram;
  scope: string;
  nodeId: string;
  execPin: string;
  wireId: string;
}

const DEFAULT_MAX_STEPS = 100_000;

class Engine implements ExecHost, ScriptRuntime {
  readonly world: ScriptWorld;
  readonly registry: NodeRegistry;
  readonly maxSteps: number;

  paused = false;
  running = false;

  /** Tick delta, seconds. Read by `core/OnUpdate`. */
  dt = 0;

  private program: CompiledProgram | null = null;
  private active: CompiledProgram | null = null;
  private scope = 'root';
  private readonly stack: Frame[] = [];
  private delays: Delay[] = [];
  private readonly graphVars = new Map<string, Map<string, unknown>>();
  private readonly entityVars = new Map<string, Map<string, unknown>>();
  private readonly loopValues = new Map<string, number>();
  private readonly payloads = new Map<string, unknown>();
  private readonly reading = new Set<string>();
  private readonly breakpoints = new Set<string>();

  private source: DebugSource | null = null;
  /** True only while a DebugSource is attached. Gates every event allocation. */
  private trace = false;
  private pauseRequested = false;
  private stepBudget = 0;
  private resumeSkip: string | undefined;
  private steps = 0;
  private depth = 0;

  constructor(options: ScriptRuntimeOptions = {}) {
    this.world = options.world ?? createMemoryWorld();
    this.registry = options.registry ?? createBuiltinRegistry();
    const requested = options.maxSteps;
    this.maxSteps =
      typeof requested === 'number' && requested > 0 ? Math.floor(requested) : DEFAULT_MAX_STEPS;
  }

  load(doc: GraphDoc): CompileResult {
    this.resetSession();
    const result = compile(doc, this.registry);
    this.program = result.program;
    return result;
  }

  loadProgram(program: CompiledProgram): void {
    this.resetSession();
    this.program = program;
  }

  start(): void {
    if (!this.program) throw new ScriptRuntimeError('No graph loaded', 'no-program');
    this.stack.length = 0;
    this.delays = [];
    this.graphVars.clear();
    this.entityVars.clear();
    this.loopValues.clear();
    this.payloads.clear();
    this.reading.clear();
    this.running = true;
    this.paused = false;
    this.pauseRequested = false;
    this.stepBudget = 0;
    this.resumeSkip = undefined;
    this.steps = 0;
    this.queue(this.program, 'root', this.program.entries.start);
    this.run();
  }

  tick(dt: number): void {
    if (!this.running || this.paused || !this.program) return;
    this.dt = typeof dt === 'number' && Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.steps = 0;
    this.queue(this.program, 'root', this.program.entries.update);
    this.promoteDelays(this.dt);
    this.run();
  }

  stop(): void {
    this.running = false;
    this.stack.length = 0;
    this.delays = [];
    this.paused = false;
    this.pauseRequested = false;
    this.stepBudget = 0;
    this.resumeSkip = undefined;
    this.reading.clear();
  }

  dispose(): void {
    this.stop();
    this.detachDebugger();
    this.breakpoints.clear();
    this.program = null;
    this.graphVars.clear();
    this.entityVars.clear();
    this.loopValues.clear();
    this.payloads.clear();
  }

  emit(eventName: string, payload?: unknown): void {
    if (!this.running || !this.program) return;
    if (this.depth === 0 && this.paused) return;
    const ids = this.program.entries.event[eventName] ?? [];
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      const nodeId = ids[i];
      if (nodeId === undefined) continue;
      this.payloads.set(`root\0${nodeId}`, payload);
      this.stack.push({
        kind: 'node',
        program: this.program,
        scope: 'root',
        nodeId,
        execPin: 'exec',
      });
    }
    if (this.depth === 0) {
      this.steps = 0;
      this.run();
    }
  }

  getVariable(name: string, scope: VariableScope = 'graph'): unknown {
    if (scope === 'entity') return this.getVar('entity', name, this.world.self);
    return this.graphVars.get('root')?.get(name);
  }

  setVariable(name: string, value: unknown, scope: VariableScope = 'graph'): void {
    if (scope === 'entity') this.setVar('entity', name, value, this.world.self);
    else this.writeGraph('root', name, value);
  }

  attachDebugger(source: DebugSource): void {
    this.source = source;
    this.trace = true;
  }

  detachDebugger(): void {
    this.source = null;
    this.trace = false;
  }

  setBreakpoint(nodeId: string): void {
    this.breakpoints.add(nodeId);
  }

  clearBreakpoint(nodeId: string): void {
    this.breakpoints.delete(nodeId);
    if (this.resumeSkip === nodeId) this.resumeSkip = undefined;
  }

  pause(): void {
    this.pauseRequested = true;
    this.paused = true;
  }

  step(): void {
    if (this.stack.length === 0) return;
    this.stepBudget = 1;
    this.pauseRequested = false;
    this.paused = false;
    this.run();
  }

  resume(): void {
    this.stepBudget = 0;
    this.pauseRequested = false;
    const wasPaused = this.paused;
    this.paused = false;
    if (this.stack.length > 0) this.run();
    else if (!wasPaused) return;
  }

  read(node: CompiledNode, pin: string): unknown {
    const src = node.dataIn[pin];
    if (!src) return undefined;
    if (src.kind === 'literal') return src.value;
    const value = this.evalOutput(src.nodeId, src.pin);
    if (this.trace) this.source?.onEvent({ kind: 'wire', wireId: src.wireId, value });
    return value;
  }

  follow(node: CompiledNode, pin: string): void {
    const links = node.execOut[pin];
    if (!links || links.length === 0) return;
    const active = this.live();
    if (this.trace) {
      for (const link of links) this.source?.onEvent({ kind: 'wire', wireId: link.wireId, value: true });
    }
    for (let i = links.length - 1; i >= 0; i -= 1) {
      const link = links[i];
      if (!link) continue;
      this.stack.push({
        kind: 'node',
        program: active,
        scope: this.scope,
        nodeId: link.nodeId,
        execPin: link.pin,
      });
    }
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

  getVar(scope: VariableScope, name: string, entity?: EntityRef): unknown {
    if (scope === 'entity') {
      const target = entity ?? this.world.self;
      if (this.world.getVariable) return this.world.getVariable(target, name);
      return this.entityVars.get(String(target.id))?.get(name);
    }
    return this.graphVars.get(this.scope)?.get(name);
  }

  setVar(scope: VariableScope, name: string, value: unknown, entity?: EntityRef): void {
    if (scope === 'entity') {
      const target = entity ?? this.world.self;
      if (this.world.setVariable) {
        this.world.setVariable(target, name, value);
        return;
      }
      const key = String(target.id);
      let bucket = this.entityVars.get(key);
      if (!bucket) {
        bucket = new Map();
        this.entityVars.set(key, bucket);
      }
      bucket.set(name, value);
      return;
    }
    this.writeGraph(this.scope, name, value);
  }

  loopIndex(nodeId: string): number {
    return this.loopValues.get(`${this.scope}\0${nodeId}`) ?? 0;
  }

  scheduleFor(node: CompiledNode, first: number, last: number): void {
    this.stack.push({
      kind: 'for',
      program: this.live(),
      scope: this.scope,
      nodeId: node.id,
      index: first,
      last,
    });
  }

  scheduleWhile(node: CompiledNode): void {
    this.stack.push({
      kind: 'while',
      program: this.live(),
      scope: this.scope,
      nodeId: node.id,
    });
  }

  scheduleDelay(seconds: number, node: CompiledNode): void {
    const links = node.execOut.then;
    if (!links || links.length === 0) return;
    if (seconds <= 0) {
      this.follow(node, 'then');
      return;
    }
    const active = this.live();
    for (const link of links) {
      this.delays.push({
        remaining: seconds,
        program: active,
        scope: this.scope,
        nodeId: link.nodeId,
        execPin: link.pin,
        wireId: link.wireId,
      });
    }
  }

  fire(name: string, payload: unknown): void {
    const active = this.live();
    const ids = active.entries.event[name] ?? [];
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      const nodeId = ids[i];
      if (nodeId === undefined) continue;
      this.payloads.set(`${this.scope}\0${nodeId}`, payload);
      this.stack.push({
        kind: 'node',
        program: active,
        scope: this.scope,
        nodeId,
        execPin: 'exec',
      });
    }
  }

  payload(nodeId: string): unknown {
    return this.payloads.get(`${this.scope}\0${nodeId}`);
  }

  enterSubgraph(graphId: string): void {
    const child = this.live().subgraphs[graphId];
    if (!child) return;
    this.queue(child, `${this.scope}/${graphId}`, child.entries.start);
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

  private resetSession(): void {
    this.stop();
    this.graphVars.clear();
    this.entityVars.clear();
    this.loopValues.clear();
    this.payloads.clear();
    this.program = null;
  }

  private writeGraph(scope: string, name: string, value: unknown): void {
    let bucket = this.graphVars.get(scope);
    if (!bucket) {
      bucket = new Map();
      this.graphVars.set(scope, bucket);
    }
    bucket.set(name, value);
  }

  private live(): CompiledProgram {
    if (!this.active) throw new ScriptRuntimeError('No graph loaded', 'no-program');
    return this.active;
  }

  private queue(program: CompiledProgram, scope: string, ids: readonly string[]): void {
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      const nodeId = ids[i];
      if (nodeId === undefined) continue;
      this.stack.push({ kind: 'node', program, scope, nodeId, execPin: 'exec' });
    }
  }

  private promoteDelays(dt: number): void {
    if (this.delays.length === 0 || dt <= 0) return;
    const pending: Delay[] = [];
    const ready: Delay[] = [];
    for (const delay of this.delays) {
      delay.remaining -= dt;
      if (delay.remaining <= 0) ready.push(delay);
      else pending.push(delay);
    }
    this.delays = pending;
    for (let i = ready.length - 1; i >= 0; i -= 1) {
      const delay = ready[i];
      if (!delay) continue;
      this.stack.push({
        kind: 'node',
        program: delay.program,
        scope: delay.scope,
        nodeId: delay.nodeId,
        execPin: delay.execPin,
        wireId: delay.wireId,
      });
    }
  }

  private run(): void {
    this.depth += 1;
    try {
      if (this.instrumented()) this.runInstrumented();
      else this.runFast();
    } catch (error) {
      this.reading.clear();
      this.stack.length = 0;
      this.running = false;
      this.paused = false;
      this.pauseRequested = false;
      this.stepBudget = 0;
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  /** Breakpoints, pause, or a listener force the instrumented loop. Otherwise the fast path allocates nothing for debug. */
  private instrumented(): boolean {
    return (
      this.trace ||
      this.breakpoints.size > 0 ||
      this.pauseRequested ||
      this.paused ||
      this.stepBudget > 0
    );
  }

  private runFast(): void {
    const stack = this.stack;
    while (stack.length > 0) {
      this.steps += 1;
      if (this.steps > this.maxSteps) this.overflow(stack[stack.length - 1]);
      const frame = stack.pop();
      if (frame) this.applyFrame(frame);
    }
  }

  private runInstrumented(): void {
    const stack = this.stack;
    while (stack.length > 0) {
      this.steps += 1;
      const top = stack[stack.length - 1];
      if (!top) break;
      if (this.steps > this.maxSteps) this.overflow(top);
      if (top.kind === 'node' && this.breakBefore(top.nodeId)) {
        this.paused = true;
        return;
      }
      const frame = stack.pop();
      if (!frame) break;
      if (frame.kind === 'node' && frame.wireId && this.trace) {
        this.source?.onEvent({ kind: 'wire', wireId: frame.wireId, value: true });
      }
      if (frame.kind === 'node' && this.trace) {
        this.source?.onEvent({ kind: 'node', nodeId: frame.nodeId, phase: 'enter' });
      }
      this.applyFrame(frame);
      if (frame.kind === 'node' && this.trace) {
        this.source?.onEvent({ kind: 'node', nodeId: frame.nodeId, phase: 'exit' });
      }
      if (frame.kind === 'node' && this.stepBudget > 0) {
        this.stepBudget -= 1;
        if (this.stepBudget === 0) this.pauseRequested = true;
      }
    }
    this.paused = false;
    this.pauseRequested = false;
    this.resumeSkip = undefined;
  }

  private breakBefore(nodeId: string): boolean {
    if (this.stepBudget > 0) {
      if (this.resumeSkip === nodeId) this.resumeSkip = undefined;
      return false;
    }
    if (this.resumeSkip === nodeId) {
      this.resumeSkip = undefined;
      return false;
    }
    if (this.pauseRequested) return true;
    if (this.breakpoints.has(nodeId)) {
      this.resumeSkip = nodeId;
      return true;
    }
    return false;
  }

  private overflow(frame: Frame | undefined): never {
    throw new ScriptRuntimeError(
      `Exceeded ${this.maxSteps} script steps`,
      'max-steps',
      frame?.nodeId,
    );
  }

  private applyFrame(frame: Frame): void {
    this.active = frame.program;
    this.scope = frame.scope;
    if (frame.kind === 'for') {
      this.stepFor(frame);
      return;
    }
    if (frame.kind === 'while') {
      this.stepWhile(frame);
      return;
    }
    const node = frame.program.nodes[frame.nodeId];
    if (!node) return;
    const handler = getNodeHandler(node.typeId);
    if (handler?.exec) handler.exec(this, node);
    else this.follow(node, 'then');
  }

  private stepFor(frame: ForFrame): void {
    const node = frame.program.nodes[frame.nodeId];
    if (!node) return;
    if (frame.index <= frame.last) {
      this.loopValues.set(`${frame.scope}\0${frame.nodeId}`, frame.index);
      this.stack.push({ ...frame, index: frame.index + 1 });
      this.follow(node, 'body');
    } else {
      this.follow(node, 'completed');
    }
  }

  private stepWhile(frame: WhileFrame): void {
    const node = frame.program.nodes[frame.nodeId];
    if (!node) return;
    if (this.truthy(this.read(node, 'condition'))) {
      this.stack.push({ ...frame });
      this.follow(node, 'body');
    } else {
      this.follow(node, 'completed');
    }
  }

  private evalOutput(nodeId: string, pin: string): unknown {
    const token = `${nodeId}\0${pin}`;
    if (this.reading.has(token)) {
      throw new ScriptRuntimeError(
        `Data cycle while reading node "${nodeId}" pin "${pin}"`,
        'data-cycle',
        nodeId,
      );
    }
    this.reading.add(token);
    try {
      const node = this.live().nodes[nodeId];
      if (!node) return undefined;
      return getNodeHandler(node.typeId)?.value?.(this, node, pin);
    } finally {
      this.reading.delete(token);
    }
  }
}

/** Entry point for editor Play mode: load docs, start, tick, stop. */
export function createScriptRuntime(options?: ScriptRuntimeOptions): ScriptRuntime {
  return new Engine(options);
}
