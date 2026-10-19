import type { AnimState, BlendParam, ConditionOp, ParamType, Transition, TransitionCondition } from '@jurfi/anim';
import type { GraphDoc } from '@jurfi/script';
import { readBlendMeta, writeBlendMeta, type BlendCanvasMeta } from './document';

export function allocateBlendId(doc: GraphDoc, prefix: string): string {
  const meta = readBlendMeta(doc);
  const id = `${prefix}_${meta.seq}`;
  meta.seq += 1;
  writeBlendMeta(doc, meta);
  return id;
}

export function setBlendName(doc: GraphDoc, name: string): void {
  const meta = readBlendMeta(doc);
  meta.name = name;
  writeBlendMeta(doc, meta);
}

export function setBlendRoot(doc: GraphDoc, root: string): void {
  const meta = readBlendMeta(doc);
  meta.root = root;
  writeBlendMeta(doc, meta);
}

export function setBlendEntry(doc: GraphDoc, entry: string): void {
  const meta = readBlendMeta(doc);
  if (entry) meta.entry = entry;
  else delete meta.entry;
  writeBlendMeta(doc, meta);
}

export function addBlendParam(doc: GraphDoc, param: BlendParam): void {
  updateMeta(doc, (meta) => {
    meta.params = [...meta.params, param];
  });
}

export function updateBlendParam(doc: GraphDoc, id: string, patch: Partial<BlendParam>): void {
  const nextId = patch.id && patch.id !== id ? patch.id : undefined;
  updateMeta(doc, (meta) => {
    meta.params = meta.params.map((param) => (param.id === id ? { ...param, ...patch, id: nextId ?? param.id } : param));
    if (nextId) {
      meta.transitions = meta.transitions.map((transition) => ({
        ...transition,
        conditions: transition.conditions.map((condition) =>
          condition.param === id ? { ...condition, param: nextId } : condition,
        ),
      }));
    }
  });
  if (!nextId) return;
  for (const node of doc.nodes) {
    const props = node.props;
    if (!props) continue;
    for (const key of ['param', 'paramX', 'paramY', 'weight'] as const) {
      if (props[key] === id) props[key] = nextId;
    }
  }
}

export function removeBlendParam(doc: GraphDoc, id: string): void {
  updateMeta(doc, (meta) => {
    meta.params = meta.params.filter((param) => param.id !== id);
  });
}

export function addBlendState(doc: GraphDoc, state: AnimState): void {
  updateMeta(doc, (meta) => {
    meta.states = [...meta.states, state];
    if (!meta.entry) meta.entry = state.id;
  });
}

export function updateBlendState(doc: GraphDoc, id: string, patch: Partial<AnimState>): void {
  updateMeta(doc, (meta) => {
    meta.states = meta.states.map((state) => (state.id === id ? { ...state, ...patch, id: state.id } : state));
  });
}

export function removeBlendState(doc: GraphDoc, id: string): void {
  updateMeta(doc, (meta) => {
    meta.states = meta.states.filter((state) => state.id !== id);
    meta.transitions = meta.transitions.filter((transition) => transition.to !== id && (transition.from === '*' || transition.from !== id));
    if (meta.entry === id) meta.entry = meta.states[0]?.id;
  });
}

export function addBlendTransition(doc: GraphDoc, transition: Transition): void {
  updateMeta(doc, (meta) => {
    meta.transitions = [...meta.transitions, transition];
  });
}

export function updateBlendTransition(doc: GraphDoc, id: string, patch: Partial<Transition>): void {
  updateMeta(doc, (meta) => {
    meta.transitions = meta.transitions.map((transition) => {
      if (transition.id !== id) return transition;
      const next: Transition = {
        ...transition,
        ...patch,
        id: transition.id,
        conditions: patch.conditions ?? transition.conditions,
      };
      if (Object.prototype.hasOwnProperty.call(patch, 'exitTime') && patch.exitTime === undefined) delete next.exitTime;
      return next;
    });
  });
}

export function removeBlendTransition(doc: GraphDoc, id: string): void {
  updateMeta(doc, (meta) => {
    meta.transitions = meta.transitions.filter((transition) => transition.id !== id);
  });
}

export function addBlendCondition(doc: GraphDoc, transitionId: string, condition: TransitionCondition): void {
  updateMeta(doc, (meta) => {
    meta.transitions = meta.transitions.map((transition) =>
      transition.id === transitionId ? { ...transition, conditions: [...transition.conditions, condition] } : transition,
    );
  });
}

export function updateBlendCondition(doc: GraphDoc, transitionId: string, index: number, condition: TransitionCondition): void {
  updateMeta(doc, (meta) => {
    meta.transitions = meta.transitions.map((transition) => {
      if (transition.id !== transitionId) return transition;
      const conditions = transition.conditions.map((item, itemIndex) => (itemIndex === index ? condition : item));
      return { ...transition, conditions };
    });
  });
}

export function removeBlendCondition(doc: GraphDoc, transitionId: string, index: number): void {
  updateMeta(doc, (meta) => {
    meta.transitions = meta.transitions.map((transition) => {
      if (transition.id !== transitionId) return transition;
      return { ...transition, conditions: transition.conditions.filter((_, itemIndex) => itemIndex !== index) };
    });
  });
}

export const CONDITION_OPS: readonly ConditionOp[] = ['==', '!=', '<', '<=', '>', '>=', 'triggered'];
export const PARAM_TYPES: readonly ParamType[] = ['float', 'int', 'bool', 'trigger'];

function updateMeta(doc: GraphDoc, mutate: (meta: BlendCanvasMeta) => void): void {
  const meta = readBlendMeta(doc);
  mutate(meta);
  writeBlendMeta(doc, meta);
}
