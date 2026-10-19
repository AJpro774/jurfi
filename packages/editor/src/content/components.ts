import { listComponentTypes, type FieldType } from '@jurfi/core';

/** Inspector field kinds. Vector kinds follow `@jurfi/core` `defineComponent` field types. */
export type FieldKind = 'number' | 'vec2' | 'vec3' | 'vec4' | 'quat' | 'color' | 'bool' | 'string' | 'entity';

export interface FieldSchema {
  key: string;
  label: string;
  kind: FieldKind;
  lanes: readonly string[];
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface ComponentSchema {
  type: string;
  title: string;
  fields: readonly FieldSchema[];
  defaults: () => Record<string, unknown>;
}

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

export function componentSchema(type: string): ComponentSchema | undefined {
  return componentSchemas().find((schema) => schema.type === type);
}

/** Schemas registered with `@jurfi/core` `defineComponent`, including Transform, Light, and Light2D. */
export function componentSchemas(): readonly ComponentSchema[] {
  return listComponentTypes().map((component) => ({
    type: component.id,
    title: component.id,
    fields: Object.entries(component.schema).map(([key, field]) => ({
      key,
      label: labelize(key),
      kind: mapKind(field.type),
      lanes: LANES[field.type],
      step: field.type === 'number' || field.type === 'entity' ? 0.1 : undefined,
    })),
    defaults: () => defaultsFrom(component.schema),
  }));
}

export function vecWidth(kind: FieldKind): number {
  if (kind === 'vec2') return 2;
  if (kind === 'vec3') return 3;
  if (kind === 'vec4' || kind === 'quat' || kind === 'color') return 4;
  return 0;
}

export function parseNumberField(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.' || trimmed.endsWith('.')) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

function mapKind(type: FieldType): FieldKind {
  if (type === 'boolean') return 'bool';
  return type;
}

function labelize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function defaultsFrom(schema: Readonly<Record<string, { type: FieldType; default?: unknown }>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    out[key] = field.default === undefined ? builtinDefault(field.type) : cloneDefault(field.default);
  }
  return out;
}

function cloneDefault(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value;
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
