/**
 * Blend trees and animation state machines.
 * Plain JSON. No editor or DOM dependencies.
 * `pose` is the value type the Node Graph uses for a pose port (`POSE_DATA_TYPE`).
 */

export const BLEND_TREE_VERSION = 1 as const;

/** Port type string. Also registered on `@jurfi/script`'s `DATA_TYPES`. */
export const POSE_DATA_TYPE = 'pose' as const;

export interface PoseJoint {
  position?: [number, number, number];
  /** `[x, y, z, w]`. */
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

export interface Pose {
  joints: Record<string, PoseJoint>;
}

export type ParamType = 'float' | 'int' | 'bool' | 'trigger';

export interface BlendParam {
  id: string;
  name?: string;
  type: ParamType;
  /** Number for float/int, boolean for bool/trigger. Omitted means `0` or `false`. */
  default?: number | boolean;
}

export interface Blend1DChild {
  node: string;
  position: number;
}

export interface Blend2DChild {
  node: string;
  x: number;
  y: number;
}

export interface ClipNode {
  id: string;
  type: 'clip';
  /** Id passed to the pose source. */
  clip: string;
}

export interface Blend1DNode {
  id: string;
  type: 'blend1D';
  param: string;
  children: Blend1DChild[];
}

export interface Blend2DNode {
  id: string;
  type: 'blend2D';
  paramX: string;
  paramY: string;
  children: Blend2DChild[];
}

export interface AdditiveNode {
  id: string;
  type: 'additive';
  base: string;
  /** Offset pose. Position and scale are added. Rotation blends toward this pose. */
  add: string;
  /** Number, or the id of a float/int param. */
  weight: number | string;
}

export interface MaskNode {
  id: string;
  type: 'mask';
  source: string;
  /** Joints kept from `source`. Other joints come from `base` when it is set. */
  joints: string[];
  base?: string;
  /** Number, or the id of a float/int param. Defaults to 1. */
  weight?: number | string;
}

export type BlendNode = ClipNode | Blend1DNode | Blend2DNode | AdditiveNode | MaskNode;

export type ConditionOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'triggered';

export interface TransitionCondition {
  param: string;
  op: ConditionOp;
  /** Required unless `op` is `triggered`. */
  value?: number | boolean;
}

export interface AnimState {
  id: string;
  name?: string;
  /** Blend-node id played by this state. */
  node: string;
  /** Multiplies delta time. Default 1. */
  speed?: number;
}

export interface Transition {
  id: string;
  /** State id, or `*` for any state. */
  from: string;
  to: string;
  /** Crossfade length in seconds. `0` snaps. */
  duration: number;
  /** Seconds in the current state before the transition may fire. Omit to allow it immediately. */
  exitTime?: number;
  /** All must pass. An empty list is unconditional. */
  conditions: TransitionCondition[];
}

export interface BlendTree {
  version: typeof BLEND_TREE_VERSION;
  id: string;
  name?: string;
  /** Node evaluated by `evaluateBlendTree`. */
  root: string;
  params: BlendParam[];
  nodes: BlendNode[];
  states?: AnimState[];
  transitions?: Transition[];
  /** State id. Defaults to the first state. */
  entry?: string;
}

export type ParamValue = number | boolean;
export type ParamSet = Record<string, ParamValue>;

/** Sample a clip id at `time` seconds. Missing clips produce an empty pose. */
export type PoseSource = (clipId: string, time: number) => Pose | undefined;

export interface MachinePlayback {
  state: string;
  time: number;
  fromState?: string;
  fromTime?: number;
  fade: number;
  fadeDuration: number;
}

export interface MachineStep {
  machine: MachinePlayback;
  pose: Pose;
  /** Trigger param ids that fired a transition. The caller clears them. */
  consumed: string[];
}

const PARAM_TYPES = new Set<string>(['float', 'int', 'bool', 'trigger']);
const NODE_TYPES = new Set<string>(['clip', 'blend1D', 'blend2D', 'additive', 'mask']);
const NUMERIC_OPS = new Set<string>(['==', '!=', '<', '<=', '>', '>=']);
const BOOL_OPS = new Set<string>(['==', '!=']);

/** Problems in a blend-tree document. Empty means the tree is usable. */
export function validateBlendTree(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['Blend tree must be an object'];
  if (value.version !== BLEND_TREE_VERSION) errors.push('version must be 1');
  if (typeof value.id !== 'string' || value.id.length === 0) errors.push('id must be a non-empty string');
  if (value.name !== undefined && typeof value.name !== 'string') errors.push('name must be a string');

  const params = readParams(value.params, errors);
  const nodes = readNodes(value.nodes, errors);
  const paramById = new Map(params.map((param) => [param.id, param]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  if (typeof value.root !== 'string' || !nodeById.has(value.root)) errors.push('root must name a node');
  for (const node of nodes) checkNodeRefs(node, nodeById, paramById, errors);
  reportCycles(typeof value.root === 'string' ? value.root : '', nodeById, errors);

  const states = readStates(value.states, nodeById, errors);
  const stateIds = new Set(states.map((state) => state.id));
  readTransitions(value.transitions, stateIds, paramById, errors);
  if (value.entry !== undefined) {
    if (typeof value.entry !== 'string' || !stateIds.has(value.entry)) errors.push('entry must name a state');
  }
  return errors;
}

/**
 * Evaluate `tree.root` at `time`.
 * `params` supplies float, int, bool, and trigger values. Missing keys use the param default.
 */
export function evaluateBlendTree(tree: BlendTree, params: ParamSet, time: number, source: PoseSource): Pose {
  return evalNode(tree, tree.root, params, time, source, new Set());
}

/** Playback positioned on the entry state, or on `root` when the tree has no states. */
export function createMachine(tree: BlendTree): MachinePlayback {
  const state = tree.entry ?? tree.states?.[0]?.id ?? '';
  return { state, time: 0, fade: 0, fadeDuration: 0 };
}

/**
 * Advance a state machine by `dt` seconds and sample its pose.
 * The first matching transition wins. A fade samples the state being left at the time it exited.
 */
export function stepMachine(tree: BlendTree, machine: MachinePlayback, params: ParamSet, dt: number, source: PoseSource): MachineStep {
  const states = tree.states ?? [];
  if (states.length === 0) {
    const time = machine.time + dt;
    return {
      machine: { ...machine, time },
      pose: evaluateBlendTree(tree, params, time, source),
      consumed: [],
    };
  }

  const next: MachinePlayback = { ...machine };
  const consumed: string[] = [];
  const speed = stateSpeed(states, next.state);
  next.time += dt * speed;

  if (next.fromState !== undefined) {
    next.fade += dt;
    if (next.fadeDuration <= 0 || next.fade >= next.fadeDuration) clearFade(next);
  } else {
    const transition = pickTransition(tree, next, params, consumed);
    if (transition) {
      next.fromState = next.state;
      next.fromTime = next.time;
      next.state = transition.to;
      next.time = 0;
      next.fade = 0;
      next.fadeDuration = transition.duration;
      if (transition.duration <= 0) clearFade(next);
    }
  }

  const pose = sampleMachine(tree, next, params, source);
  return { machine: next, pose, consumed };
}

function sampleMachine(tree: BlendTree, machine: MachinePlayback, params: ParamSet, source: PoseSource): Pose {
  const current = stateById(tree, machine.state);
  const pose = evalNode(tree, current?.node ?? tree.root, params, machine.time, source, new Set());
  if (!machine.fromState || machine.fadeDuration <= 0) return pose;
  const previous = stateById(tree, machine.fromState);
  const from = evalNode(tree, previous?.node ?? tree.root, params, machine.fromTime ?? 0, source, new Set());
  const u = clamp01(machine.fade / machine.fadeDuration);
  return lerpPose(from, pose, u);
}

function pickTransition(tree: BlendTree, machine: MachinePlayback, params: ParamSet, consumed: string[]): Transition | undefined {
  for (const transition of tree.transitions ?? []) {
    if (transition.from !== '*' && transition.from !== machine.state) continue;
    if (transition.exitTime !== undefined && machine.time < transition.exitTime) continue;
    const triggers: string[] = [];
    if (!conditionsPass(tree, transition, params, triggers)) continue;
    consumed.push(...triggers);
    return transition;
  }
  return undefined;
}

function conditionsPass(tree: BlendTree, transition: Transition, params: ParamSet, triggers: string[]): boolean {
  for (const condition of transition.conditions) {
    const spec = tree.params.find((param) => param.id === condition.param);
    const value = readParam(spec, params[condition.param]);
    if (condition.op === 'triggered') {
      if (value !== true) return false;
      triggers.push(condition.param);
      continue;
    }
    if (typeof value === 'boolean') {
      if (typeof condition.value !== 'boolean' || !compareBool(condition.op, value, condition.value)) return false;
      continue;
    }
    if (typeof value !== 'number' || typeof condition.value !== 'number') return false;
    if (!compareNumber(condition.op, value, condition.value)) return false;
  }
  return true;
}

function evalNode(
  tree: BlendTree,
  id: string,
  params: ParamSet,
  time: number,
  source: PoseSource,
  stack: Set<string>,
): Pose {
  if (stack.has(id)) return { joints: {} };
  const node = tree.nodes.find((item) => item.id === id);
  if (!node) return { joints: {} };
  stack.add(id);
  try {
    switch (node.type) {
      case 'clip':
        return clonePose(source(node.clip, time) ?? { joints: {} });
      case 'blend1D':
        return evalBlend1D(tree, node, params, time, source, stack);
      case 'blend2D':
        return evalBlend2D(tree, node, params, time, source, stack);
      case 'additive':
        return evalAdditive(tree, node, params, time, source, stack);
      case 'mask':
        return evalMask(tree, node, params, time, source, stack);
      default:
        return { joints: {} };
    }
  } finally {
    stack.delete(id);
  }
}

function evalBlend1D(
  tree: BlendTree,
  node: Blend1DNode,
  params: ParamSet,
  time: number,
  source: PoseSource,
  stack: Set<string>,
): Pose {
  const children = [...node.children].sort((a, b) => a.position - b.position);
  const first = children[0];
  if (!first) return { joints: {} };
  const param = readParam(tree.params.find((item) => item.id === node.param), params[node.param]);
  const x = typeof param === 'number' ? param : first.position;
  if (children.length === 1 || x <= first.position) return evalNode(tree, first.node, params, time, source, stack);
  const last = children[children.length - 1];
  if (!last) return { joints: {} };
  if (x >= last.position) return evalNode(tree, last.node, params, time, source, stack);
  let right = last;
  let left = first;
  for (let index = 1; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;
    if (child.position >= x) {
      right = child;
      left = children[index - 1] ?? first;
      break;
    }
  }
  const span = right.position - left.position;
  const u = span > 0 ? (x - left.position) / span : 0;
  return lerpPose(
    evalNode(tree, left.node, params, time, source, stack),
    evalNode(tree, right.node, params, time, source, stack),
    u,
  );
}

function evalBlend2D(
  tree: BlendTree,
  node: Blend2DNode,
  params: ParamSet,
  time: number,
  source: PoseSource,
  stack: Set<string>,
): Pose {
  const px = readParam(tree.params.find((item) => item.id === node.paramX), params[node.paramX]);
  const py = readParam(tree.params.find((item) => item.id === node.paramY), params[node.paramY]);
  const x = typeof px === 'number' ? px : 0;
  const y = typeof py === 'number' ? py : 0;
  const samples = node.children.map((child) => {
    const distance = Math.hypot(x - child.x, y - child.y);
    return {
      pose: evalNode(tree, child.node, params, time, source, stack),
      weight: distance < 1e-6 ? Number.POSITIVE_INFINITY : 1 / distance,
    };
  });
  if (samples.some((sample) => sample.weight === Number.POSITIVE_INFINITY)) {
    for (const sample of samples) sample.weight = sample.weight === Number.POSITIVE_INFINITY ? 1 : 0;
  }
  return blendWeighted(samples);
}

function evalAdditive(
  tree: BlendTree,
  node: AdditiveNode,
  params: ParamSet,
  time: number,
  source: PoseSource,
  stack: Set<string>,
): Pose {
  const base = evalNode(tree, node.base, params, time, source, stack);
  const add = evalNode(tree, node.add, params, time, source, stack);
  const weight = readWeight(tree, node.weight, params);
  return addPose(base, add, weight);
}

function evalMask(
  tree: BlendTree,
  node: MaskNode,
  params: ParamSet,
  time: number,
  source: PoseSource,
  stack: Set<string>,
): Pose {
  const sourcePose = evalNode(tree, node.source, params, time, source, stack);
  const base = node.base ? evalNode(tree, node.base, params, time, source, stack) : { joints: {} };
  const weight = node.weight === undefined ? 1 : readWeight(tree, node.weight, params);
  const allowed = new Set(node.joints);
  const joints: Record<string, PoseJoint> = {};
  if (node.base) {
    for (const [name, joint] of Object.entries(base.joints)) {
      if (!allowed.has(name)) joints[name] = cloneJoint(joint);
    }
  }
  for (const name of node.joints) {
    const from = base.joints[name];
    const to = sourcePose.joints[name];
    if (!to && !from) continue;
    joints[name] = lerpJoint(from, to, weight);
  }
  return { joints };
}

function readWeight(tree: BlendTree, weight: number | string, params: ParamSet): number {
  if (typeof weight === 'number') return Number.isFinite(weight) ? weight : 0;
  const spec = tree.params.find((param) => param.id === weight);
  const value = readParam(spec, params[weight]);
  return typeof value === 'number' ? value : 0;
}

function readParam(spec: BlendParam | undefined, raw: ParamValue | undefined): ParamValue | undefined {
  const value = raw !== undefined ? raw : spec?.default;
  if (!spec) return value;
  if (spec.type === 'float') return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (spec.type === 'int') return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  if (spec.type === 'bool' || spec.type === 'trigger') return typeof value === 'boolean' ? value : false;
  return value;
}

function blendWeighted(samples: { pose: Pose; weight: number }[]): Pose {
  let acc: Pose | undefined;
  let accWeight = 0;
  for (const sample of samples) {
    if (!(sample.weight > 0)) continue;
    if (!acc) {
      acc = sample.pose;
      accWeight = sample.weight;
      continue;
    }
    const next = accWeight + sample.weight;
    acc = lerpPose(acc, sample.pose, sample.weight / next);
    accWeight = next;
  }
  return acc ?? { joints: {} };
}

function lerpPose(a: Pose, b: Pose, u: number): Pose {
  const names = new Set([...Object.keys(a.joints), ...Object.keys(b.joints)]);
  const joints: Record<string, PoseJoint> = {};
  for (const name of names) joints[name] = lerpJoint(a.joints[name], b.joints[name], u);
  return { joints };
}

function lerpJoint(a: PoseJoint | undefined, b: PoseJoint | undefined, u: number): PoseJoint {
  if (!a) return cloneJoint(b ?? {});
  if (!b) return cloneJoint(a);
  const joint: PoseJoint = {};
  if (a.position || b.position) joint.position = lerp3(a.position ?? b.position, b.position ?? a.position, u);
  if (a.rotation || b.rotation) joint.rotation = nlerp(a.rotation ?? b.rotation ?? [0, 0, 0, 1], b.rotation ?? a.rotation ?? [0, 0, 0, 1], u);
  if (a.scale || b.scale) joint.scale = lerp3(a.scale ?? b.scale, b.scale ?? a.scale, u);
  return joint;
}

function addPose(base: Pose, add: Pose, weight: number): Pose {
  const names = new Set([...Object.keys(base.joints), ...Object.keys(add.joints)]);
  const joints: Record<string, PoseJoint> = {};
  for (const name of names) {
    const left = base.joints[name];
    const right = add.joints[name];
    const joint: PoseJoint = {};
    if (left?.position || right?.position) {
      const b = left?.position ?? [0, 0, 0];
      const a = right?.position ?? [0, 0, 0];
      joint.position = [b[0] + a[0] * weight, b[1] + a[1] * weight, b[2] + a[2] * weight];
    }
    if (left?.scale || right?.scale) {
      const b = left?.scale ?? [0, 0, 0];
      const a = right?.scale ?? [0, 0, 0];
      joint.scale = [b[0] + a[0] * weight, b[1] + a[1] * weight, b[2] + a[2] * weight];
    }
    if (left?.rotation || right?.rotation) {
      joint.rotation = nlerp(left?.rotation ?? [0, 0, 0, 1], right?.rotation ?? [0, 0, 0, 1], weight);
    }
    joints[name] = joint;
  }
  return { joints };
}

function lerp3(a: readonly [number, number, number] | undefined, b: readonly [number, number, number] | undefined, u: number): [number, number, number] {
  const left = a ?? b ?? [0, 0, 0];
  const right = b ?? a ?? [0, 0, 0];
  return [left[0] + (right[0] - left[0]) * u, left[1] + (right[1] - left[1]) * u, left[2] + (right[2] - left[2]) * u];
}

function nlerp(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  u: number,
): [number, number, number, number] {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  if (a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  const x = a[0] + (bx - a[0]) * u;
  const y = a[1] + (by - a[1]) * u;
  const z = a[2] + (bz - a[2]) * u;
  const w = a[3] + (bw - a[3]) * u;
  const length = Math.hypot(x, y, z, w);
  if (length < 1e-12) return [0, 0, 0, 1];
  return [x / length, y / length, z / length, w / length];
}

function clonePose(pose: Pose): Pose {
  const joints: Record<string, PoseJoint> = {};
  for (const [name, joint] of Object.entries(pose.joints)) joints[name] = cloneJoint(joint);
  return { joints };
}

function cloneJoint(joint: PoseJoint): PoseJoint {
  return {
    ...(joint.position ? { position: [...joint.position] as [number, number, number] } : {}),
    ...(joint.rotation ? { rotation: [...joint.rotation] as [number, number, number, number] } : {}),
    ...(joint.scale ? { scale: [...joint.scale] as [number, number, number] } : {}),
  };
}

function stateById(tree: BlendTree, id: string): AnimState | undefined {
  return tree.states?.find((state) => state.id === id);
}

function stateSpeed(states: readonly AnimState[], id: string): number {
  const speed = states.find((state) => state.id === id)?.speed;
  return typeof speed === 'number' && Number.isFinite(speed) ? speed : 1;
}

function clearFade(machine: MachinePlayback): void {
  machine.fromState = undefined;
  machine.fromTime = undefined;
  machine.fade = 0;
  machine.fadeDuration = 0;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function compareNumber(op: ConditionOp, left: number, right: number): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    default:
      return false;
  }
}

function compareBool(op: ConditionOp, left: boolean, right: boolean): boolean {
  if (op === '==') return left === right;
  if (op === '!=') return left !== right;
  return false;
}

function readParams(value: unknown, errors: string[]): BlendParam[] {
  if (!Array.isArray(value)) {
    errors.push('params must be an array');
    return [];
  }
  const params: BlendParam[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) {
      errors.push('param is missing an id');
      continue;
    }
    if (seen.has(item.id)) errors.push(`duplicate param "${item.id}"`);
    seen.add(item.id);
    if (typeof item.type !== 'string' || !PARAM_TYPES.has(item.type)) {
      errors.push(`param "${item.id}" has an unknown type`);
      continue;
    }
    const type = item.type as ParamType;
    if (item.default !== undefined && !defaultMatches(type, item.default)) {
      errors.push(`param "${item.id}" default does not match ${type}`);
    }
    if (item.name !== undefined && typeof item.name !== 'string') errors.push(`param "${item.id}" name must be a string`);
    params.push({
      id: item.id,
      type,
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(item.default !== undefined ? { default: item.default as number | boolean } : {}),
    });
  }
  return params;
}

function readNodes(value: unknown, errors: string[]): BlendNode[] {
  if (!Array.isArray(value)) {
    errors.push('nodes must be an array');
    return [];
  }
  const nodes: BlendNode[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) {
      errors.push('node is missing an id');
      continue;
    }
    if (seen.has(item.id)) errors.push(`duplicate node "${item.id}"`);
    seen.add(item.id);
    if (typeof item.type !== 'string' || !NODE_TYPES.has(item.type)) {
      errors.push(`node "${item.id}" has an unknown type`);
      continue;
    }
    const node = coerceNode(item, errors);
    if (node) nodes.push(node);
  }
  return nodes;
}

function coerceNode(item: Record<string, unknown>, errors: string[]): BlendNode | undefined {
  const id = item.id as string;
  switch (item.type) {
    case 'clip':
      if (typeof item.clip !== 'string' || item.clip.length === 0) {
        errors.push(`node "${id}" is missing a clip id`);
        return undefined;
      }
      return { id, type: 'clip', clip: item.clip };
    case 'blend1D':
      if (typeof item.param !== 'string' || !Array.isArray(item.children)) {
        errors.push(`node "${id}" needs a param and children`);
        return undefined;
      }
      return { id, type: 'blend1D', param: item.param, children: item.children as Blend1DChild[] };
    case 'blend2D':
      if (typeof item.paramX !== 'string' || typeof item.paramY !== 'string' || !Array.isArray(item.children)) {
        errors.push(`node "${id}" needs paramX, paramY, and children`);
        return undefined;
      }
      return { id, type: 'blend2D', paramX: item.paramX, paramY: item.paramY, children: item.children as Blend2DChild[] };
    case 'additive':
      if (typeof item.base !== 'string' || typeof item.add !== 'string' || (typeof item.weight !== 'number' && typeof item.weight !== 'string')) {
        errors.push(`node "${id}" needs base, add, and weight`);
        return undefined;
      }
      return { id, type: 'additive', base: item.base, add: item.add, weight: item.weight };
    case 'mask':
      if (typeof item.source !== 'string' || !Array.isArray(item.joints) || item.joints.some((joint) => typeof joint !== 'string')) {
        errors.push(`node "${id}" needs a source and a list of joints`);
        return undefined;
      }
      return {
        id,
        type: 'mask',
        source: item.source,
        joints: item.joints as string[],
        ...(typeof item.base === 'string' ? { base: item.base } : {}),
        ...(typeof item.weight === 'number' || typeof item.weight === 'string' ? { weight: item.weight } : {}),
      };
    default:
      return undefined;
  }
}

function readStates(value: unknown, nodes: ReadonlyMap<string, BlendNode>, errors: string[]): AnimState[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('states must be an array');
    return [];
  }
  const states: AnimState[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) {
      errors.push('state is missing an id');
      continue;
    }
    if (seen.has(item.id)) errors.push(`duplicate state "${item.id}"`);
    seen.add(item.id);
    if (typeof item.node !== 'string' || !nodes.has(item.node)) errors.push(`state "${item.id}" must name a node`);
    if (item.speed !== undefined && (typeof item.speed !== 'number' || !Number.isFinite(item.speed))) {
      errors.push(`state "${item.id}" speed must be a finite number`);
    }
    states.push({
      id: item.id,
      node: typeof item.node === 'string' ? item.node : '',
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.speed === 'number' ? { speed: item.speed } : {}),
    });
  }
  return states;
}

function readTransitions(
  value: unknown,
  states: ReadonlySet<string>,
  params: ReadonlyMap<string, BlendParam>,
  errors: string[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('transitions must be an array');
    return;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) {
      errors.push('transition is missing an id');
      continue;
    }
    if (seen.has(item.id)) errors.push(`duplicate transition "${item.id}"`);
    seen.add(item.id);
    if (typeof item.from !== 'string' || (item.from !== '*' && !states.has(item.from))) {
      errors.push(`transition "${item.id}" from must name a state or "*"`);
    }
    if (typeof item.to !== 'string' || !states.has(item.to)) errors.push(`transition "${item.id}" must name a destination state`);
    if (typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration < 0) {
      errors.push(`transition "${item.id}" duration must be a non-negative number`);
    }
    if (item.exitTime !== undefined && (typeof item.exitTime !== 'number' || !Number.isFinite(item.exitTime) || item.exitTime < 0)) {
      errors.push(`transition "${item.id}" exitTime must be a non-negative number`);
    }
    if (!Array.isArray(item.conditions)) {
      errors.push(`transition "${item.id}" conditions must be an array`);
      continue;
    }
    for (const condition of item.conditions) checkCondition(item.id, condition, params, errors);
  }
}

function checkCondition(transitionId: string, value: unknown, params: ReadonlyMap<string, BlendParam>, errors: string[]): void {
  if (!isRecord(value) || typeof value.param !== 'string' || typeof value.op !== 'string') {
    errors.push(`transition "${transitionId}" has a malformed condition`);
    return;
  }
  const param = params.get(value.param);
  if (!param) {
    errors.push(`transition "${transitionId}" condition references unknown param "${value.param}"`);
    return;
  }
  if (value.op === 'triggered') {
    if (param.type !== 'trigger') errors.push(`transition "${transitionId}" triggered condition needs a trigger param`);
    return;
  }
  const numeric = param.type === 'float' || param.type === 'int';
  const allowed = numeric ? NUMERIC_OPS : BOOL_OPS;
  if (!allowed.has(value.op)) {
    errors.push(`transition "${transitionId}" cannot use ${value.op} on ${param.type} "${param.id}"`);
    return;
  }
  if (numeric && (typeof value.value !== 'number' || !Number.isFinite(value.value))) {
    errors.push(`transition "${transitionId}" condition on "${param.id}" needs a finite number`);
  }
  if (!numeric && typeof value.value !== 'boolean') {
    errors.push(`transition "${transitionId}" condition on "${param.id}" needs a boolean`);
  }
}

function checkNodeRefs(
  node: BlendNode,
  nodes: ReadonlyMap<string, BlendNode>,
  params: ReadonlyMap<string, BlendParam>,
  errors: string[],
): void {
  const need = (id: string): void => {
    if (!nodes.has(id)) errors.push(`node "${node.id}" references unknown node "${id}"`);
  };
  const needNumber = (id: string, label: string): void => {
    const param = params.get(id);
    if (!param) errors.push(`node "${node.id}" references unknown param "${id}"`);
    else if (param.type !== 'float' && param.type !== 'int') errors.push(`node "${node.id}" ${label} must be a float or int param`);
  };
  switch (node.type) {
    case 'clip':
      return;
    case 'blend1D':
      needNumber(node.param, 'param');
      if (node.children.length === 0) errors.push(`node "${node.id}" needs a child`);
      for (const child of node.children) {
        if (!isRecord(child) || typeof child.node !== 'string' || typeof child.position !== 'number' || !Number.isFinite(child.position)) {
          errors.push(`node "${node.id}" has a malformed child`);
          continue;
        }
        need(child.node);
      }
      return;
    case 'blend2D':
      needNumber(node.paramX, 'paramX');
      needNumber(node.paramY, 'paramY');
      if (node.children.length === 0) errors.push(`node "${node.id}" needs a child`);
      for (const child of node.children) {
        if (
          !isRecord(child) ||
          typeof child.node !== 'string' ||
          typeof child.x !== 'number' ||
          typeof child.y !== 'number' ||
          !Number.isFinite(child.x) ||
          !Number.isFinite(child.y)
        ) {
          errors.push(`node "${node.id}" has a malformed child`);
          continue;
        }
        need(child.node);
      }
      return;
    case 'additive':
      need(node.base);
      need(node.add);
      if (typeof node.weight === 'string') needNumber(node.weight, 'weight');
      else if (!Number.isFinite(node.weight)) errors.push(`node "${node.id}" weight must be finite`);
      return;
    case 'mask':
      need(node.source);
      if (node.base) need(node.base);
      if (typeof node.weight === 'string') needNumber(node.weight, 'weight');
      else if (node.weight !== undefined && !Number.isFinite(node.weight)) errors.push(`node "${node.id}" weight must be finite`);
      return;
    default:
      return;
  }
}

function reportCycles(root: string, nodes: ReadonlyMap<string, BlendNode>, errors: string[]): void {
  const color = new Map<string, 'open' | 'done'>();
  const visit = (id: string, trail: string[]): void => {
    const state = color.get(id);
    if (state === 'done') return;
    if (state === 'open') {
      const start = trail.indexOf(id);
      errors.push(`cycle in nodes: ${[...trail.slice(start), id].join(' → ')}`);
      return;
    }
    color.set(id, 'open');
    const node = nodes.get(id);
    for (const next of node ? childIds(node) : []) visit(next, [...trail, id]);
    color.set(id, 'done');
  };
  visit(root, []);
  for (const id of nodes.keys()) visit(id, []);
}

function childIds(node: BlendNode): string[] {
  switch (node.type) {
    case 'clip':
      return [];
    case 'blend1D':
    case 'blend2D':
      return node.children.flatMap((child) => (isRecord(child) && typeof child.node === 'string' ? [child.node] : []));
    case 'additive':
      return [node.base, node.add];
    case 'mask':
      return node.base ? [node.source, node.base] : [node.source];
    default:
      return [];
  }
}

function defaultMatches(type: ParamType, value: unknown): boolean {
  if (type === 'float') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'int') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
