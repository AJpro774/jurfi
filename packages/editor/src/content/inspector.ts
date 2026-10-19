import type { EditorContext } from '../context';
import type { EntityRecord } from '../world';
import { assetLibrary, type AssetItem } from './assets';
import {
  componentSchema,
  componentSchemas,
  parseNumberField,
  vecWidth,
  type FieldSchema,
} from './components';
import {
  addComponentType,
  looseKeys,
  removeComponentType,
  renameEntity,
  writeComponentField,
  writeLooseField,
} from './edits';
import { isRecord, readFlags } from './flags';

const AXES = ['X', 'Y', 'Z', 'W'] as const;

export function mountInspector(el: HTMLElement, ctx: EditorContext): () => void {
  el.classList.add('jp-host');
  const panel = document.createElement('div');
  panel.className = 'jp-panel jp-inspector';
  el.append(panel);

  let writing = false;
  const offWorld = ctx.world.subscribe(() => {
    if (!writing) render();
  });
  const offSelection = ctx.selection.subscribe(() => render());
  render();

  return () => {
    offWorld();
    offSelection();
    panel.remove();
  };

  function selectedEntities(): EntityRecord[] {
    return ctx.selection.get().flatMap((id) => {
      const entity = ctx.world.get(id);
      return entity ? [entity] : [];
    });
  }

  function edit(run: () => void): void {
    writing = true;
    run();
    writing = false;
  }

  function render(): void {
    const entities = selectedEntities();
    const ids = entities.map((entity) => entity.id);
    const lockedCount = entities.filter((entity) => readFlags(entity.components).locked).length;
    const allLocked = entities.length > 0 && lockedCount === entities.length;
    const assets = assetLibrary(ctx).assets();
    panel.replaceChildren();
    if (entities.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'je-muted jp-empty';
      empty.textContent = 'Nothing selected';
      panel.append(empty);
      return;
    }

    const scroller = document.createElement('div');
    scroller.className = 'jp-scroll';
    const heading = document.createElement('p');
    heading.className = 'jp-selection';
    heading.textContent = entities.length === 1 ? (entities[0]?.name ?? 'Entity') : `${entities.length} selected`;
    scroller.append(heading);
    if (lockedCount > 0) {
      const note = document.createElement('p');
      note.className = 'je-muted';
      note.textContent = allLocked ? 'Locked' : 'Locked entities stay unchanged';
      scroller.append(note);
    }

    const primary = entities[0];
    if (entities.length === 1 && primary) {
      scroller.append(nameField(primary, allLocked));
      const keys = looseKeys(primary.components);
      if (keys.length > 0) scroller.append(looseSection(primary, keys, allLocked));
      if (isRecord(primary.components.mesh)) scroller.append(meshSection(primary, allLocked));
    }

    for (const schema of componentSchemas()) {
      const owners = entities.filter((entity) => isRecord(entity.components[schema.type]));
      if (owners.length === 0) continue;
      scroller.append(componentSection(schema.type, schema.title, owners, entities.length, ids, allLocked, assets));
    }

    const available = componentSchemas().filter((schema) => entities.some((entity) => (
      entity.components[schema.type] === undefined && !readFlags(entity.components).locked
    )));
    if (available.length > 0) scroller.append(addRow(available.map((schema) => schema.type), ids, allLocked));
    panel.append(scroller);
  }

  function nameField(entity: EntityRecord, disabled: boolean): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'jp-field';
    const label = document.createElement('label');
    label.className = 'je-label';
    label.htmlFor = 'jp-entity-name';
    label.textContent = 'Name';
    const input = document.createElement('input');
    input.id = 'jp-entity-name';
    input.className = 'je-field';
    input.type = 'text';
    input.value = entity.name;
    input.disabled = disabled;
    input.addEventListener('input', () => edit(() => renameEntity(ctx, entity.id, input.value)));
    input.addEventListener('blur', () => render());
    wrap.append(label, input);
    return wrap;
  }

  function looseSection(entity: EntityRecord, keys: string[], disabled: boolean): HTMLElement {
    const section = document.createElement('section');
    section.className = 'jp-section';
    const title = document.createElement('h3');
    title.className = 'jp-section-title';
    title.textContent = 'Properties';
    section.append(title);
    for (const key of keys) {
      const value = entity.components[key];
      const kind = typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'number' : 'string';
      section.append(fieldControl({
        schema: { key, label: key, kind, lanes: [] },
        values: [value],
        disabled,
        assets: [],
        onText: (raw) => commitLoose(entity.id, key, kind, raw),
        onBool: (next) => edit(() => writeLooseField(ctx, entity.id, key, next, `loose:${entity.id}:${key}`)),
        onBlur: () => render(),
      }));
    }
    return section;
  }

  function componentSection(
    type: string,
    title: string,
    owners: EntityRecord[],
    total: number,
    ids: readonly string[],
    disabled: boolean,
    assets: readonly AssetItem[],
  ): HTMLElement {
    const schema = componentSchema(type);
    const section = document.createElement('section');
    section.className = 'jp-section';
    const head = document.createElement('div');
    head.className = 'jp-section-head';
    const heading = document.createElement('h3');
    heading.className = 'jp-section-title';
    heading.textContent = title;
    head.append(heading);
    if (owners.length < total) {
      const count = document.createElement('span');
      count.className = 'je-muted';
      count.textContent = `On ${owners.length} of ${total}`;
      head.append(count);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'jp-text-btn';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${title}`);
    remove.disabled = disabled;
    remove.addEventListener('click', () => edit(() => removeComponentType(ctx, ids, type)));
    head.append(remove);
    section.append(head);
    if (!schema) return section;
    const ownerIds = owners.map((entity) => entity.id);
    for (const field of schema.fields) {
      const values = owners.map((entity) => {
        const bag = entity.components[type];
        return isRecord(bag) ? bag[field.key] : undefined;
      });
      section.append(schemaField(type, field, values, ownerIds, disabled, assets));
    }
    return section;
  }

  function schemaField(
    type: string,
    field: FieldSchema,
    values: unknown[],
    ids: readonly string[],
    disabled: boolean,
    assets: readonly AssetItem[],
  ): HTMLElement {
    const width = vecWidth(field.kind);
    if (width > 0) return vecField(type, field, values, ids, disabled, width);
    return fieldControl({
      schema: field,
      values,
      disabled,
      assets,
      onText: (raw) => commitField(type, field, ids, raw),
      onBool: (next) => edit(() => writeComponentField(ctx, ids, type, field.key, next, undefined, mergeKey(ids, type, field.key))),
      onBlur: () => render(),
    });
  }

  function vecField(
    type: string,
    field: FieldSchema,
    values: unknown[],
    ids: readonly string[],
    disabled: boolean,
    width: number,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'jp-field';
    const label = document.createElement('span');
    label.className = 'je-label';
    label.textContent = field.label;
    const axes = document.createElement('div');
    axes.className = 'jp-axes';
    const labels = field.lanes.length > 0 ? field.lanes : AXES;
    for (let axis = 0; axis < width; axis += 1) {
      const axisValues = values.map((value) => (Array.isArray(value) ? value[axis] : undefined));
      const state = display(axisValues);
      const input = document.createElement('input');
      input.className = 'je-field';
      input.type = 'text';
      input.inputMode = 'decimal';
      input.spellcheck = false;
      input.disabled = disabled;
      const axisLabel = String(labels[axis] ?? axis).toUpperCase();
      input.setAttribute('aria-label', `${field.label} ${axisLabel}`);
      const note = state.mixed ? mixedNote(`${field.label} ${String(labels[axis] ?? axis).toUpperCase()}`) : null;
      if (note) {
        input.placeholder = 'Mixed';
        input.setAttribute('aria-describedby', note.id);
      } else input.value = state.text;
      input.addEventListener('input', () => {
        const parsed = parseNumberField(input.value);
        input.setAttribute('aria-invalid', parsed === undefined ? 'true' : 'false');
        if (parsed === undefined) return;
        edit(() => writeComponentField(ctx, ids, type, field.key, parsed, axis, mergeKey(ids, type, field.key, axis)));
      });
      input.addEventListener('blur', () => render());
      axes.append(input);
      if (note) axes.append(note);
    }
    wrap.append(label, axes);
    return wrap;
  }

  function meshSection(entity: EntityRecord, disabled: boolean): HTMLElement {
    const mesh = isRecord(entity.components.mesh) ? entity.components.mesh : {};
    const section = document.createElement('section');
    section.className = 'jp-section';
    const title = document.createElement('h3');
    title.className = 'jp-section-title';
    title.textContent = 'Mesh';
    const select = document.createElement('select');
    select.className = 'je-field';
    select.disabled = disabled;
    select.setAttribute('aria-label', 'Shape');
    for (const shape of ['box', 'sphere', 'plane']) {
      const option = document.createElement('option');
      option.value = shape;
      option.textContent = shape;
      select.append(option);
    }
    select.value = typeof mesh.shape === 'string' ? mesh.shape : 'box';
    select.addEventListener('change', () => {
      edit(() => writeLooseField(ctx, entity.id, 'mesh', { ...mesh, shape: select.value }, `mesh:${entity.id}:shape`));
    });
    section.append(title, select);
    return section;
  }

  function addRow(types: readonly string[], ids: readonly string[], disabled: boolean): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'jp-add';
    const select = document.createElement('select');
    select.className = 'je-field';
    select.setAttribute('aria-label', 'Component type');
    select.disabled = disabled;
    for (const type of types) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = componentSchema(type)?.title ?? type;
      select.append(option);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jp-text-btn';
    button.textContent = 'Add';
    button.setAttribute('aria-label', 'Add component');
    button.disabled = disabled;
    button.addEventListener('click', () => edit(() => addComponentType(ctx, ids, select.value)));
    wrap.append(select, button);
    return wrap;
  }

  function commitField(type: string, field: FieldSchema, ids: readonly string[], raw: string): void {
    if (field.kind === 'number' || field.kind === 'entity') {
      const parsed = parseNumberField(raw);
      if (parsed === undefined) return;
      edit(() => writeComponentField(ctx, ids, type, field.key, parsed, undefined, mergeKey(ids, type, field.key)));
      return;
    }
    edit(() => writeComponentField(ctx, ids, type, field.key, raw, undefined, mergeKey(ids, type, field.key)));
  }

  function commitLoose(id: string, key: string, kind: string, raw: string): void {
    if (kind === 'number') {
      const parsed = parseNumberField(raw);
      if (parsed === undefined) return;
      edit(() => writeLooseField(ctx, id, key, parsed, `loose:${id}:${key}`));
      return;
    }
    edit(() => writeLooseField(ctx, id, key, raw, `loose:${id}:${key}`));
  }
}

function fieldControl(options: {
  schema: FieldSchema;
  values: unknown[];
  disabled: boolean;
  assets: readonly AssetItem[];
  onText: (raw: string) => void;
  onBool: (value: boolean) => void;
  onBlur: () => void;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'jp-field';
  const state = display(options.values);
  if (options.schema.kind === 'bool') {
    const label = document.createElement('label');
    label.className = 'jp-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.disabled = options.disabled;
    input.checked = !state.mixed && options.values[0] === true;
    input.indeterminate = state.mixed;
    input.setAttribute('aria-label', options.schema.label);
    const mixed = state.mixed ? mixedNote(options.schema.label) : null;
    if (mixed) input.setAttribute('aria-describedby', mixed.id);
    input.addEventListener('change', () => options.onBool(input.checked));
    const text = document.createElement('span');
    text.textContent = options.schema.label;
    label.append(input, text);
    if (mixed) label.append(mixed);
    wrap.append(label);
    return wrap;
  }

  const label = document.createElement('label');
  label.className = 'je-label';
  label.textContent = options.schema.label;
  wrap.append(label);

  const row = document.createElement('div');
  row.className = 'jp-inline';
  const input = document.createElement('input');
  input.className = 'je-field';
  input.type = 'text';
  input.spellcheck = false;
  input.disabled = options.disabled;
  input.setAttribute('aria-label', options.schema.label);
  if (options.schema.kind === 'number' || options.schema.kind === 'entity') input.inputMode = 'decimal';
  const mixed = state.mixed ? mixedNote(options.schema.label) : null;
  if (mixed) {
    input.placeholder = 'Mixed';
    input.setAttribute('aria-describedby', mixed.id);
  } else input.value = state.text;
  input.addEventListener('input', () => {
    const invalid = options.schema.kind === 'number' || options.schema.kind === 'entity'
      ? parseNumberField(input.value) === undefined
      : false;
    if (options.schema.kind === 'number' || options.schema.kind === 'entity') {
      input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    }
    if (!invalid) options.onText(input.value);
  });
  input.addEventListener('blur', () => options.onBlur());
  row.append(input);
  if (mixed) row.append(mixed);
  wrap.append(row);
  return wrap;
}

function mixedNote(label: string): HTMLSpanElement {
  const note = document.createElement('span');
  note.id = `jp-mixed-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  note.className = 'jp-sr';
  note.textContent = 'Mixed values';
  return note;
}

function display(values: unknown[]): { text: string; mixed: boolean } {
  const present = values.filter((value) => value !== undefined);
  if (present.length === 0) return { text: '', mixed: false };
  const first = JSON.stringify(present[0]);
  if (present.some((value) => JSON.stringify(value) !== first)) return { text: '', mixed: true };
  const value = present[0];
  if (typeof value === 'number' || typeof value === 'string') return { text: String(value), mixed: false };
  return { text: '', mixed: false };
}

function mergeKey(ids: readonly string[], type: string, key: string, axis?: number): string {
  const suffix = axis === undefined ? '' : `:${axis}`;
  return `field:${ids.join(',')}:${type}:${key}${suffix}`;
}
