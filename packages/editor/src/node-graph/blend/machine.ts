import { validateBlendTree } from '@jurfi/anim';
import type { ConditionOp, ParamType, TransitionCondition } from '@jurfi/anim';
import type { GraphController } from '../controller';
import { blendTreeFromGraph, readBlendMeta } from './document';
import {
  CONDITION_OPS,
  PARAM_TYPES,
  addBlendCondition,
  addBlendParam,
  addBlendState,
  addBlendTransition,
  allocateBlendId,
  removeBlendCondition,
  removeBlendParam,
  removeBlendState,
  removeBlendTransition,
  setBlendEntry,
  setBlendName,
  setBlendRoot,
  updateBlendCondition,
  updateBlendParam,
  updateBlendState,
  updateBlendTransition,
} from './edit';

export function mountBlendMachine(host: HTMLElement, controller: GraphController): { destroy(): void } {
  const doc = host.ownerDocument;
  const root = el(doc, 'aside', 'ng-machine');
  root.setAttribute('aria-label', 'State machine');
  host.replaceChildren(root);
  const stop = controller.subscribe(() => render());
  render();
  return {
    destroy() {
      stop();
      root.remove();
    },
  };

  function render(): void {
    const graph = controller.getDocument();
    const meta = readBlendMeta(graph);
    const tree = blendTreeFromGraph(graph);
    const issues = validateBlendTree(tree);
    const nodeIds = graph.nodes.map((node) => node.id);
    root.replaceChildren();
    root.append(el(doc, 'h2', 'ng-machine-title', 'State machine'));
    if (issues.length > 0) {
      const warning = el(doc, 'p', 'ng-machine-warn', issues[0] ?? '');
      warning.title = issues.join('\n');
      root.append(warning);
    }

    root.append(labelField(doc, 'Name', meta.name ?? '', (value) => controller.edit('Rename blend tree', (draft) => setBlendName(draft, value))));
    root.append(selectField(doc, 'Root', meta.root, nodeIds, (value) => controller.edit('Set blend root', (draft) => setBlendRoot(draft, value))));
    root.append(selectField(doc, 'Entry', meta.entry ?? '', ['', ...meta.states.map((state) => state.id)], (value) =>
      controller.edit('Set entry state', (draft) => setBlendEntry(draft, value)),
    ));

    root.append(sectionTitle(doc, 'Parameters', 'Add parameter', () => {
      controller.edit('Add parameter', (draft) => {
        const id = allocateBlendId(draft, 'param');
        addBlendParam(draft, { id, type: 'float', default: 0 });
      });
    }));
    for (const param of meta.params) {
      const row = el(doc, 'div', 'ng-machine-card');
      const idInput = textInput(doc, param.id, 'Parameter id');
      idInput.addEventListener('change', () => {
        const next = idInput.value.trim();
        if (!next || next === param.id) return;
        controller.edit('Rename parameter', (draft) => updateBlendParam(draft, param.id, { id: next }));
      });
      const type = selectInput(doc, param.type, PARAM_TYPES, 'Parameter type');
      type.addEventListener('change', () => {
        const next = type.value as ParamType;
        const fallback = next === 'bool' || next === 'trigger' ? false : 0;
        controller.edit('Edit parameter', (draft) => updateBlendParam(draft, param.id, { type: next, default: fallback }));
      });
      row.append(idInput, type);
      if (param.type === 'bool' || param.type === 'trigger') {
        const flag = selectInput(doc, String(param.default === true), ['false', 'true'], 'Default');
        flag.addEventListener('change', () => {
          controller.edit('Edit parameter', (draft) => updateBlendParam(draft, param.id, { default: flag.value === 'true' }));
        });
        row.append(flag);
      } else {
        const number = numInput(doc, typeof param.default === 'number' ? param.default : 0, 'Default');
        number.addEventListener('change', () => {
          controller.edit('Edit parameter', (draft) => updateBlendParam(draft, param.id, { default: Number(number.value) }));
        });
        row.append(number);
      }
      row.append(removeButton(doc, 'Remove parameter', () => controller.edit('Remove parameter', (draft) => removeBlendParam(draft, param.id))));
      root.append(row);
    }

    root.append(sectionTitle(doc, 'States', 'Add state', () => {
      controller.edit('Add state', (draft) => {
        const id = allocateBlendId(draft, 'state');
        const node = controller.getDocument().nodes[0]?.id ?? '';
        addBlendState(draft, { id, node });
      });
    }));
    for (const state of meta.states) {
      const row = el(doc, 'div', 'ng-machine-card');
      const name = textInput(doc, state.name ?? state.id, 'State name');
      name.addEventListener('change', () => {
        controller.edit('Rename state', (draft) => updateBlendState(draft, state.id, { name: name.value }));
      });
      const node = selectInput(doc, state.node, nodeIds.length > 0 ? nodeIds : [''], 'State node');
      node.addEventListener('change', () => {
        controller.edit('Set state node', (draft) => updateBlendState(draft, state.id, { node: node.value }));
      });
      const speed = numInput(doc, state.speed ?? 1, 'Speed');
      speed.addEventListener('change', () => {
        controller.edit('Set state speed', (draft) => updateBlendState(draft, state.id, { speed: Number(speed.value) }));
      });
      row.append(el(doc, 'span', 'ng-machine-id', state.id), name, node, speed);
      row.append(removeButton(doc, 'Remove state', () => controller.edit('Remove state', (draft) => removeBlendState(draft, state.id))));
      root.append(row);
    }

    root.append(sectionTitle(doc, 'Transitions', 'Add transition', () => {
      const from = meta.states[0]?.id ?? '*';
      const to = meta.states[1]?.id ?? meta.states[0]?.id ?? '';
      if (!to) return;
      controller.edit('Add transition', (draft) => {
        const id = allocateBlendId(draft, 'transition');
        addBlendTransition(draft, { id, from, to, duration: 0.2, conditions: [] });
      });
    }));
    const stateChoices = ['*', ...meta.states.map((state) => state.id)];
    for (const transition of meta.transitions) {
      const card = el(doc, 'div', 'ng-machine-card');
      const from = selectInput(doc, transition.from, stateChoices, 'From state');
      from.addEventListener('change', () => {
        controller.edit('Edit transition', (draft) => updateBlendTransition(draft, transition.id, { from: from.value }));
      });
      const to = selectInput(doc, transition.to, meta.states.map((state) => state.id), 'To state');
      to.addEventListener('change', () => {
        controller.edit('Edit transition', (draft) => updateBlendTransition(draft, transition.id, { to: to.value }));
      });
      const duration = numInput(doc, transition.duration, 'Duration');
      duration.addEventListener('change', () => {
        controller.edit('Edit transition', (draft) => updateBlendTransition(draft, transition.id, { duration: Number(duration.value) }));
      });
      const exit = numInput(doc, transition.exitTime ?? 0, 'Exit time');
      exit.addEventListener('change', () => {
        const value = Number(exit.value);
        controller.edit('Edit transition', (draft) => updateBlendTransition(draft, transition.id, { exitTime: value > 0 ? value : undefined }));
      });
      card.append(from, to, duration, exit);
      for (const [index, condition] of transition.conditions.entries()) {
        card.append(conditionRow(doc, controller, meta.params, transition.id, index, condition));
      }
      const addCondition = button(doc, 'Add condition');
      addCondition.addEventListener('click', () => {
        const param = meta.params[0]?.id ?? 'speed';
        controller.edit('Add condition', (draft) => addBlendCondition(draft, transition.id, { param, op: '==', value: 0 }));
      });
      card.append(addCondition, removeButton(doc, 'Remove transition', () => controller.edit('Remove transition', (draft) => removeBlendTransition(draft, transition.id))));
      root.append(card);
    }
  }
}

function conditionRow(
  doc: Document,
  controller: GraphController,
  params: readonly { id: string; type: ParamType }[],
  transitionId: string,
  index: number,
  condition: TransitionCondition,
): HTMLElement {
  const row = el(doc, 'div', 'ng-condition');
  const paramIds = params.map((param) => param.id);
  const param = selectInput(doc, condition.param, paramIds.length > 0 ? paramIds : [condition.param], 'Condition parameter');
  const op = selectInput(doc, condition.op, CONDITION_OPS, 'Condition operator');
  const valueInput = condition.op === 'triggered' ? null : valueControl(doc, condition);
  const commit = (): void => {
    const next = readCondition(param.value, op.value as ConditionOp, valueInput);
    controller.edit('Edit condition', (draft) => updateBlendCondition(draft, transitionId, index, next));
  };
  param.addEventListener('change', commit);
  op.addEventListener('change', commit);
  row.append(param, op);
  if (valueInput) {
    valueInput.addEventListener('change', commit);
    row.append(valueInput);
  }
  row.append(removeButton(doc, 'Remove condition', () => controller.edit('Remove condition', (draft) => removeBlendCondition(draft, transitionId, index))));
  return row;
}

function readCondition(param: string, op: ConditionOp, valueInput: HTMLInputElement | HTMLSelectElement | null): TransitionCondition {
  if (op === 'triggered') return { param, op };
  if (valueInput instanceof HTMLSelectElement) return { param, op, value: valueInput.value === 'true' };
  const value = Number(valueInput?.value ?? 0);
  return { param, op, value: Number.isFinite(value) ? value : 0 };
}

function valueControl(doc: Document, condition: TransitionCondition): HTMLInputElement | HTMLSelectElement {
  if (typeof condition.value === 'boolean') return selectInput(doc, String(condition.value), ['false', 'true'], 'Condition value');
  return numInput(doc, typeof condition.value === 'number' ? condition.value : 0, 'Condition value');
}

function sectionTitle(doc: Document, title: string, action: string, onClick: () => void): HTMLElement {
  const row = el(doc, 'div', 'ng-machine-section');
  row.append(el(doc, 'h3', 'ng-machine-heading', title));
  const add = button(doc, action);
  add.addEventListener('click', onClick);
  row.append(add);
  return row;
}

function labelField(doc: Document, label: string, value: string, onCommit: (value: string) => void): HTMLElement {
  const row = el(doc, 'label', 'ng-machine-field');
  row.append(el(doc, 'span', 'ng-machine-label', label));
  const input = textInput(doc, value, label);
  input.addEventListener('change', () => onCommit(input.value));
  row.append(input);
  return row;
}

function selectField(doc: Document, label: string, value: string, options: readonly string[], onCommit: (value: string) => void): HTMLElement {
  const row = el(doc, 'label', 'ng-machine-field');
  row.append(el(doc, 'span', 'ng-machine-label', label));
  const input = selectInput(doc, value, options, label);
  input.addEventListener('change', () => onCommit(input.value));
  row.append(input);
  return row;
}

function textInput(doc: Document, value: string, label: string): HTMLInputElement {
  const input = doc.createElement('input');
  input.className = 'ng-machine-input';
  input.type = 'text';
  input.value = value;
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  return input;
}

function numInput(doc: Document, value: number, label: string): HTMLInputElement {
  const input = doc.createElement('input');
  input.className = 'ng-machine-input';
  input.type = 'number';
  input.step = 'any';
  input.value = String(value);
  input.setAttribute('aria-label', label);
  return input;
}

function selectInput(doc: Document, value: string, options: readonly string[], label: string): HTMLSelectElement {
  const input = doc.createElement('select');
  input.className = 'ng-machine-input';
  input.setAttribute('aria-label', label);
  const choices = options.includes(value) || value === '' ? options : [value, ...options];
  for (const option of choices) {
    const item = doc.createElement('option');
    item.value = option;
    item.textContent = option === '' ? '—' : option;
    if (option === value) item.selected = true;
    input.append(item);
  }
  return input;
}

function button(doc: Document, label: string): HTMLButtonElement {
  const input = doc.createElement('button');
  input.type = 'button';
  input.className = 'ng-machine-button';
  input.textContent = label;
  return input;
}

function removeButton(doc: Document, label: string, onClick: () => void): HTMLButtonElement {
  const input = button(doc, 'Remove');
  input.setAttribute('aria-label', label);
  input.addEventListener('click', onClick);
  return input;
}

function el(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
