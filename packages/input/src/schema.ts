import type { ActionMapJSON } from './types';

export const ACTION_MAP_VERSION = 1;

const str = { type: 'string', minLength: 1 };
const pad = { type: 'integer', minimum: 0, maximum: 3 };
const obj = (device: string, props: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties: { device: { const: device }, ...props },
  required: ['device', ...required],
  additionalProperties: false,
});

/** JSON Schema (draft 2020-12) for action map files. Mirrored in docs/api/action-map.schema.json. */
export const ACTION_MAP_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://jurfi.dev/schemas/action-map/v1.json',
  title: 'Jurfi action map',
  description: 'Named input actions and their bindings. Schema version 1.',
  type: 'object',
  properties: {
    version: { const: ACTION_MAP_VERSION, description: 'Action map schema version.' },
    actions: {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/action' },
    },
  },
  required: ['version', 'actions'],
  additionalProperties: false,
  $defs: {
    action: {
      type: 'object',
      properties: {
        type: { enum: ['button', 'axis1d', 'axis2d'] },
        bindings: { type: 'array', items: { $ref: '#/$defs/binding' } },
        contexts: { type: 'array', items: str, uniqueItems: true, description: 'Active only in these contexts; omit for all.' },
      },
      required: ['type', 'bindings'],
      additionalProperties: false,
    },
    binding: {
      oneOf: [
        obj('key', { code: str }, ['code']),
        obj('key', { negative: str, positive: str }, ['negative', 'positive']),
        obj('key', { up: str, down: str, left: str, right: str }, ['up', 'down', 'left', 'right']),
        obj('mouse', { button: { type: 'integer', minimum: 0, maximum: 31 } }, ['button']),
        obj('mouse', { delta: { enum: ['x', 'y', 'wheel', 'move'] }, scale: { type: 'number' } }, ['delta']),
        obj('gamepad', { button: { type: 'integer', minimum: 0, maximum: 19 }, pad }, ['button']),
        obj('gamepad', { axis: { type: 'integer', minimum: 0, maximum: 7 }, pad, scale: { type: 'number' } }, ['axis']),
        obj('gamepad', { stick: { enum: ['left', 'right'] }, pad }, ['stick']),
        obj('touch', { control: str }, ['control']),
      ],
    },
  },
} as const;

const TYPES = ['button', 'axis1d', 'axis2d'];

/** Lightweight structural validation; returns human-readable errors (empty = valid). */
export function validateActionMap(json: unknown): string[] {
  const errs: string[] = [];
  const o = json as Partial<ActionMapJSON> | null;
  if (!o || typeof o !== 'object') return ['action map must be an object'];
  if (o.version !== ACTION_MAP_VERSION) errs.push(`version must be ${ACTION_MAP_VERSION}`);
  if (!o.actions || typeof o.actions !== 'object') return [...errs, 'actions must be an object'];
  for (const [name, a] of Object.entries(o.actions)) {
    if (!a || !TYPES.includes(a.type)) { errs.push(`${name}: invalid type`); continue; }
    if (!Array.isArray(a.bindings)) { errs.push(`${name}: bindings must be an array`); continue; }
    if (a.contexts !== undefined && !(Array.isArray(a.contexts) && a.contexts.every((c) => typeof c === 'string'))) errs.push(`${name}: contexts must be string[]`);
    a.bindings.forEach((b, i) => {
      const bb = b as unknown as Record<string, unknown>;
      if (!bb || !['key', 'mouse', 'gamepad', 'touch'].includes(bb.device as string)) errs.push(`${name}.bindings[${i}]: invalid device`);
      else if (Object.keys(bb).length < 2) errs.push(`${name}.bindings[${i}]: missing fields`);
    });
  }
  return errs;
}
