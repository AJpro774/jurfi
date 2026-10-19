import { clamp } from '@jurfi/core';
import type { CompiledNode } from './ir';
import type { VariableScope } from './schema';
import { callDefinedRun, callDefinedValue, hasDefinedScript, type ScriptCall } from './scripts';
import { propString, valuesEqual } from './util';
import type { EntityRef, ScriptWorld } from './world';

/** Host surface the built-in nodes call. The runtime implements this; handlers never see the editor. */
export interface ExecHost {
  readonly world: ScriptWorld;
  readonly dt: number;
  read(node: CompiledNode, pin: string): unknown;
  follow(node: CompiledNode, pin: string): void;
  num(value: unknown): number;
  truthy(value: unknown): boolean;
  entity(value: unknown): EntityRef;
  getVar(scope: VariableScope, name: string, entity?: EntityRef): unknown;
  setVar(scope: VariableScope, name: string, value: unknown, entity?: EntityRef): void;
  loopIndex(nodeId: string): number;
  scheduleFor(node: CompiledNode, first: number, last: number): void;
  scheduleWhile(node: CompiledNode): void;
  scheduleDelay(seconds: number, node: CompiledNode): void;
  fire(name: string, payload: unknown): void;
  payload(nodeId: string): unknown;
  enterSubgraph(graphId: string): void;
  getField(entity: EntityRef, component: string, field: string): unknown;
  setField(entity: EntityRef, component: string, field: string, value: unknown): void;
}

export interface NodeHandler {
  exec?(host: ExecHost, node: CompiledNode): void;
  value?(host: ExecHost, node: CompiledNode, pin: string): unknown;
}

function scopeOf(props: Record<string, unknown>): VariableScope {
  return props.scope === 'entity' ? 'entity' : 'graph';
}

function binary(op: (a: number, b: number) => number): NodeHandler {
  return {
    value(host, node, pin) {
      if (pin !== 'result') return undefined;
      return op(host.num(host.read(node, 'a')), host.num(host.read(node, 'b')));
    },
  };
}

function compareNum(op: (a: number, b: number) => boolean): NodeHandler {
  return {
    value(host, node, pin) {
      if (pin !== 'result') return undefined;
      return op(host.num(host.read(node, 'a')), host.num(host.read(node, 'b')));
    },
  };
}

function pass(host: ExecHost, node: CompiledNode): void {
  host.follow(node, 'then');
}

const nodeHandlers: Record<string, NodeHandler> = {
  'core/OnStart': { exec: pass },
  'core/OnUpdate': {
    exec: pass,
    value(host, _node, pin) {
      return pin === 'dt' ? host.dt : undefined;
    },
  },
  'core/OnEvent': {
    exec: pass,
    value(host, node, pin) {
      return pin === 'payload' ? host.payload(node.id) : undefined;
    },
  },
  'core/FireEvent': {
    exec(host, node) {
      const fromPin = host.read(node, 'event');
      const name =
        typeof fromPin === 'string' && fromPin !== ''
          ? fromPin
          : propString(node.props, 'event') || propString(node.props, 'name');
      const payload = host.read(node, 'payload');
      host.follow(node, 'then');
      if (name) host.fire(name, payload);
    },
  },
  'core/Branch': {
    exec(host, node) {
      host.follow(node, host.truthy(host.read(node, 'condition')) ? 'true' : 'false');
    },
  },
  'core/Sequence': {
    exec(host, node) {
      const pins = Object.keys(node.execOut)
        .map((name) => ({ name, index: sequenceIndex(name) }))
        .filter((pin): pin is { name: string; index: number } => pin.index !== null)
        .sort((a, b) => b.index - a.index);
      for (const pin of pins) host.follow(node, pin.name);
    },
  },
  'core/ForLoop': {
    exec(host, node) {
      host.scheduleFor(node, host.num(host.read(node, 'first')), host.num(host.read(node, 'last')));
    },
    value(host, node, pin) {
      return pin === 'index' ? host.loopIndex(node.id) : undefined;
    },
  },
  'core/While': {
    exec(host, node) {
      host.scheduleWhile(node);
    },
  },
  'core/Delay': {
    exec(host, node) {
      host.scheduleDelay(host.num(host.read(node, 'seconds')), node);
    },
  },
  'core/GetVariable': {
    value(host, node, pin) {
      if (pin !== 'value') return undefined;
      const scope = scopeOf(node.props);
      const entity = scope === 'entity' ? host.entity(host.read(node, 'entity')) : undefined;
      return host.getVar(scope, propString(node.props, 'name'), entity);
    },
  },
  'core/SetVariable': {
    exec(host, node) {
      const scope = scopeOf(node.props);
      const entity = scope === 'entity' ? host.entity(host.read(node, 'entity')) : undefined;
      host.setVar(scope, propString(node.props, 'name'), host.read(node, 'value'), entity);
      host.follow(node, 'then');
    },
    value(host, node, pin) {
      return pin === 'result' ? host.read(node, 'value') : undefined;
    },
  },
  'core/Add': binary((a, b) => a + b),
  'core/Subtract': binary((a, b) => a - b),
  'core/Multiply': binary((a, b) => a * b),
  'core/Divide': binary((a, b) => a / b),
  'core/Clamp': {
    value(host, node, pin) {
      if (pin !== 'result') return undefined;
      return clamp(
        host.num(host.read(node, 'value')),
        host.num(host.read(node, 'min')),
        host.num(host.read(node, 'max')),
      );
    },
  },
  'core/And': {
    value(host, node, pin) {
      if (pin !== 'result') return undefined;
      return host.truthy(host.read(node, 'a')) && host.truthy(host.read(node, 'b'));
    },
  },
  'core/Or': {
    value(host, node, pin) {
      if (pin !== 'result') return undefined;
      return host.truthy(host.read(node, 'a')) || host.truthy(host.read(node, 'b'));
    },
  },
  'core/Not': {
    value(host, node, pin) {
      if (pin !== 'result') return undefined;
      return !host.truthy(host.read(node, 'value'));
    },
  },
  'core/Equal': {
    value(host, node, pin) {
      if (pin !== 'result') return undefined;
      return valuesEqual(host.read(node, 'a'), host.read(node, 'b'));
    },
  },
  'core/NotEqual': {
    value(host, node, pin) {
      if (pin !== 'result') return undefined;
      return !valuesEqual(host.read(node, 'a'), host.read(node, 'b'));
    },
  },
  'core/Greater': compareNum((a, b) => a > b),
  'core/GreaterEqual': compareNum((a, b) => a >= b),
  'core/Less': compareNum((a, b) => a < b),
  'core/LessEqual': compareNum((a, b) => a <= b),
  'core/Self': {
    value(host, _node, pin) {
      return pin === 'entity' ? host.world.self : undefined;
    },
  },
  'core/GetComponent': {
    value(host, node, pin) {
      if (pin !== 'value') return undefined;
      const component = propString(node.props, 'component');
      if (!component) return undefined;
      return host.world.getComponent(host.entity(host.read(node, 'entity')), component);
    },
  },
  'core/SetComponent': {
    exec(host, node) {
      const component = propString(node.props, 'component');
      if (component) {
        host.world.setComponent(
          host.entity(host.read(node, 'entity')),
          component,
          host.read(node, 'value'),
        );
      }
      host.follow(node, 'then');
    },
  },
  'core/GetField': {
    value(host, node, pin) {
      if (pin !== 'value') return undefined;
      const component = propString(node.props, 'component');
      const field = propString(node.props, 'field');
      if (!component || !field) return undefined;
      return host.getField(host.entity(host.read(node, 'entity')), component, field);
    },
  },
  'core/SetField': {
    exec(host, node) {
      const component = propString(node.props, 'component');
      const field = propString(node.props, 'field');
      if (component && field) {
        host.setField(
          host.entity(host.read(node, 'entity')),
          component,
          field,
          host.read(node, 'value'),
        );
      }
      host.follow(node, 'then');
    },
  },
  'core/Subgraph': {
    exec(host, node) {
      host.follow(node, 'then');
      const graphId = propString(node.props, 'graph');
      if (graphId) host.enterSubgraph(graphId);
    },
  },
};

function sequenceIndex(name: string): number | null {
  const match = /^then(\d+)$/.exec(name);
  if (!match) return null;
  return Number(match[1]);
}

function callFrom(host: ExecHost, node: CompiledNode): ScriptCall {
  return {
    dt: host.dt,
    world: host.world,
    nodeId: node.id,
    props: node.props,
    read: (pin) => host.read(node, pin),
    follow: (pin) => host.follow(node, pin),
    entity: (value) => host.entity(value),
    num: (value) => host.num(value),
    truthy: (value) => host.truthy(value),
    getVar: (scope, name, entity) => host.getVar(scope, name, entity),
    setVar: (scope, name, value, entity) => host.setVar(scope, name, value, entity),
  };
}

export function getNodeHandler(typeId: string): NodeHandler | undefined {
  const builtin = nodeHandlers[typeId];
  if (builtin) return builtin;
  if (!hasDefinedScript(typeId)) return undefined;
  return {
    exec(host, node) {
      if (!callDefinedRun(typeId, callFrom(host, node))) host.follow(node, 'then');
    },
    value(host, node, pin) {
      return callDefinedValue(typeId, callFrom(host, node), pin);
    },
  };
}

export function nodeHandlerTypes(): string[] {
  return Object.keys(nodeHandlers);
}
