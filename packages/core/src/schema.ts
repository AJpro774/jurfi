import type { Entity } from './entity';
import { EcsError } from './errors';

export const FIELD_TYPES = [
  'number',
  'boolean',
  'string',
  'entity',
  'vec2',
  'vec3',
  'vec4',
  'quat',
  'color',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type StorageKind = 'sparse' | 'soa';

type FieldDefault<T extends FieldType> = T extends 'number'
  ? number
  : T extends 'boolean'
    ? boolean
    : T extends 'string'
      ? string
      : T extends 'entity'
        ? Entity
        : T extends 'vec2'
          ? readonly [number, number]
          : T extends 'vec3'
            ? readonly [number, number, number]
            : T extends 'vec4' | 'quat' | 'color'
              ? readonly [number, number, number, number]
              : never;

export interface FieldSchema<T extends FieldType = FieldType> {
  readonly type: T;
  readonly default?: FieldDefault<T>;
}

export type Schema = { readonly [field: string]: FieldSchema };

export type ComponentValue<S extends Schema> = {
  -readonly [K in keyof S]: S[K] extends FieldSchema<infer T> ? FieldDefault<T> : never;
};

declare const dataBrand: unique symbol;

export interface ComponentType<TData extends object = Record<string, unknown>> {
  readonly id: string;
  readonly storage: StorageKind;
  readonly schema: Schema;
  /** Phantom. Keeps the component's data shape on the type. */
  readonly [dataBrand]?: TData;
}

export interface NormalizedField {
  readonly name: string;
  readonly type: FieldType;
  readonly lanes: readonly string[];
  readonly defaults: readonly number[];
  readonly defaultBool: boolean;
  readonly defaultString: string;
}

export interface NormalizedComponent {
  readonly id: string;
  readonly storage: StorageKind;
  readonly fields: readonly NormalizedField[];
  readonly fieldByName: ReadonlyMap<string, NormalizedField>;
}

export type FieldPath =
  | { readonly kind: 'whole'; readonly field: NormalizedField }
  | { readonly kind: 'lane'; readonly field: NormalizedField; readonly lane: string; readonly laneIndex: number };

const registry = new Map<string, ComponentType>();
const models = new WeakMap<ComponentType, NormalizedComponent>();
const modelsById = new Map<string, NormalizedComponent>();

const LANES: Record<FieldType, readonly string[]> = {
  number: [],
  boolean: [],
  string: [],
  entity: [],
  vec2: ['x', 'y'],
  vec3: ['x', 'y', 'z'],
  vec4: ['x', 'y', 'z', 'w'],
  quat: ['x', 'y', 'z', 'w'],
  color: ['r', 'g', 'b', 'a'],
};

export function resolveStorage(id: string, storage?: StorageKind): StorageKind {
  if (storage) return storage;
  return id === 'Transform' ? 'soa' : 'sparse';
}

export function defineComponent<const S extends Schema>(
  id: string,
  schema: S,
  options?: { storage?: StorageKind },
): ComponentType<ComponentValue<S>> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new EcsError('invalid-value', 'Component id must be a non-empty string');
  }
  if (registry.has(id)) {
    throw new EcsError('duplicate-id', `Component "${id}" is already defined`);
  }
  const storage = resolveStorage(id, options?.storage);
  const fields: NormalizedField[] = [];
  for (const [name, field] of Object.entries(schema)) {
    if (!isFieldType(field?.type)) {
      throw new EcsError('invalid-value', `Component "${id}" field "${name}" has an unknown type`);
    }
    if (storage === 'soa' && field.type === 'string') {
      throw new EcsError('invalid-value', `SoA component "${id}" cannot store string field "${name}"`);
    }
    fields.push(normalizeField(id, name, field.type, field.default));
  }
  const component = { id, storage, schema } as ComponentType<ComponentValue<S>>;
  const model: NormalizedComponent = {
    id,
    storage,
    fields,
    fieldByName: new Map(fields.map((field) => [field.name, field])),
  };
  registry.set(id, component);
  models.set(component, model);
  modelsById.set(id, model);
  return component;
}

export function getComponentType(id: string): ComponentType | undefined {
  return registry.get(id);
}

export function listComponentTypes(): readonly ComponentType[] {
  return [...registry.values()];
}

export function componentModel(component: ComponentType | string): NormalizedComponent | undefined {
  if (typeof component === 'string') return modelsById.get(component);
  return models.get(component);
}

export function resolveFieldPath(model: NormalizedComponent, path: string): FieldPath {
  if (typeof path !== 'string' || path.length === 0 || path === '__proto__' || path.includes('__proto__')) {
    throw new EcsError('unknown-field', `Component "${model.id}" has no field "${String(path)}"`);
  }
  const dot = path.indexOf('.');
  if (dot === -1) {
    const field = model.fieldByName.get(path);
    if (!field) throw new EcsError('unknown-field', `Component "${model.id}" has no field "${path}"`);
    return { kind: 'whole', field };
  }
  const head = path.slice(0, dot);
  const tail = path.slice(dot + 1);
  const field = model.fieldByName.get(head);
  if (!field || field.lanes.length === 0 || tail.length === 0 || tail.includes('.')) {
    throw new EcsError('unknown-field', `Component "${model.id}" has no field "${path}"`);
  }
  const laneIndex = field.lanes.indexOf(tail);
  if (laneIndex < 0) {
    throw new EcsError('unknown-field', `Component "${model.id}" has no field "${path}"`);
  }
  return { kind: 'lane', field, lane: tail, laneIndex };
}

export function coerceComponentData(model: NormalizedComponent, value: unknown): Record<string, unknown> {
  if (value === undefined) return defaultData(model);
  if (!isPlainObject(value)) {
    throw new EcsError('invalid-value', `Component "${model.id}" expects an object`);
  }
  for (const key of Object.keys(value)) {
    if (!model.fieldByName.has(key)) {
      throw new EcsError('unknown-field', `Component "${model.id}" has no field "${key}"`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const field of model.fields) {
    if (Object.hasOwn(value, field.name)) out[field.name] = validateField(model.id, field, value[field.name]);
    else out[field.name] = defaultFieldValue(field);
  }
  return out;
}

export function validateFieldWrite(model: NormalizedComponent, path: FieldPath, value: unknown): unknown {
  if (path.kind === 'lane') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EcsError(
        'invalid-value',
        `Component "${model.id}" field "${path.field.name}.${path.lane}" expects a finite number`,
      );
    }
    return value;
  }
  return validateField(model.id, path.field, value);
}

export function defaultData(model: NormalizedComponent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of model.fields) out[field.name] = defaultFieldValue(field);
  return out;
}

export function defaultFieldValue(field: NormalizedField): unknown {
  if (field.type === 'boolean') return field.defaultBool;
  if (field.type === 'string') return field.defaultString;
  if (field.lanes.length === 0) return field.defaults[0] ?? 0;
  return [...field.defaults];
}

function validateField(componentId: string, field: NormalizedField, value: unknown): unknown {
  const where = `Component "${componentId}" field "${field.name}"`;
  switch (field.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new EcsError('invalid-value', `${where} expects a finite number`);
      }
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw new EcsError('invalid-value', `${where} expects a boolean`);
      return value;
    case 'string':
      if (typeof value !== 'string') throw new EcsError('invalid-value', `${where} expects a string`);
      return value;
    case 'entity':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new EcsError('invalid-value', `${where} expects an entity id`);
      }
      return value;
    case 'vec2':
    case 'vec3':
    case 'vec4':
    case 'quat':
    case 'color':
      return readVector(where, field.lanes, value);
    default:
      throw new EcsError('invalid-value', `${where} has an unknown type`);
  }
}

function readVector(where: string, lanes: readonly string[], value: unknown): number[] {
  if (Array.isArray(value)) {
    if (value.length !== lanes.length) {
      throw new EcsError('invalid-value', `${where} expects ${lanes.length} numbers`);
    }
    return lanes.map((_, index) => finiteAt(where, value[index]));
  }
  if (isPlainObject(value)) {
    return lanes.map((lane) => finiteAt(`${where}.${lane}`, value[lane]));
  }
  throw new EcsError('invalid-value', `${where} expects ${lanes.length} numbers`);
}

function finiteAt(where: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EcsError('invalid-value', `${where} expects a finite number`);
  }
  return value;
}

function normalizeField(componentId: string, name: string, type: FieldType, fallback: unknown): NormalizedField {
  const lanes = LANES[type];
  const provided = fallback === undefined ? builtinDefault(type) : validateField(componentId, draft(name, type, lanes), fallback);
  if (type === 'boolean') {
    return { name, type, lanes, defaults: [], defaultBool: provided as boolean, defaultString: '' };
  }
  if (type === 'string') {
    return { name, type, lanes, defaults: [], defaultBool: false, defaultString: provided as string };
  }
  if (lanes.length === 0) {
    return { name, type, lanes, defaults: [provided as number], defaultBool: false, defaultString: '' };
  }
  return {
    name,
    type,
    lanes,
    defaults: [...(provided as number[])],
    defaultBool: false,
    defaultString: '',
  };
}

function draft(name: string, type: FieldType, lanes: readonly string[]): NormalizedField {
  return { name, type, lanes, defaults: [], defaultBool: false, defaultString: '' };
}

function builtinDefault(type: FieldType): unknown {
  switch (type) {
    case 'number':
    case 'entity':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return '';
    case 'vec2':
      return [0, 0];
    case 'vec3':
      return [0, 0, 0];
    case 'vec4':
      return [0, 0, 0, 0];
    case 'quat':
      return [0, 0, 0, 1];
    case 'color':
      return [1, 1, 1, 1];
    default:
      return 0;
  }
}

function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
