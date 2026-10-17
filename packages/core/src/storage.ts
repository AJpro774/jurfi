import { EcsError } from './errors';
import type { FieldPath, NormalizedComponent, NormalizedField } from './schema';
import { defaultFieldValue } from './schema';

export interface ComponentStore {
  has(index: number): boolean;
  delete(index: number): boolean;
  read(index: number): Record<string, unknown> | undefined;
  write(index: number, data: Record<string, unknown>): void;
  readPath(index: number, path: FieldPath): unknown;
  writePath(index: number, path: FieldPath, value: unknown): void;
  clear(): void;
}

export function createComponentStore(model: NormalizedComponent): ComponentStore {
  return model.storage === 'soa' ? new SoaStore(model) : new SparseStore(model);
}

function growSparse(current: Int32Array<ArrayBufferLike>, min: number): Int32Array<ArrayBufferLike> {
  if (min <= current.length) return current;
  let capacity = Math.max(current.length, 8);
  while (capacity < min) capacity *= 2;
  const next = new Int32Array(capacity);
  next.fill(-1);
  next.set(current);
  return next;
}

function copyData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

function vectorOf(value: unknown): number[] {
  return Array.isArray(value) ? value.map((lane) => (typeof lane === 'number' ? lane : 0)) : [];
}

class SparseSet {
  sparse: Int32Array<ArrayBufferLike> = new Int32Array(0);
  dense: number[] = [];

  slot(index: number): number {
    if (index < 0 || index >= this.sparse.length) return -1;
    return this.sparse[index] ?? -1;
  }

  ensure(index: number): number {
    const existing = this.slot(index);
    if (existing >= 0) return existing;
    this.sparse = growSparse(this.sparse, index + 1);
    const slot = this.dense.length;
    this.dense.push(index);
    this.sparse[index] = slot;
    return slot;
  }

  /** Swap-removes `index`. Returns false when it was absent. */
  remove(index: number): number {
    const slot = this.slot(index);
    if (slot < 0) return -1;
    const last = this.dense.length - 1;
    const lastIndex = this.dense[last] ?? index;
    if (slot !== last) {
      this.dense[slot] = lastIndex;
      this.sparse[lastIndex] = slot;
    }
    this.dense.pop();
    this.sparse[index] = -1;
    return slot;
  }
}

class SparseStore implements ComponentStore {
  private readonly set = new SparseSet();
  private rows: Record<string, unknown>[] = [];

  constructor(private readonly model: NormalizedComponent) {}

  has(index: number): boolean {
    return this.set.slot(index) >= 0;
  }

  delete(index: number): boolean {
    const slot = this.set.remove(index);
    if (slot < 0) return false;
    const last = this.rows.length - 1;
    if (slot !== last) this.rows[slot] = this.rows[last] ?? {};
    this.rows.pop();
    return true;
  }

  read(index: number): Record<string, unknown> | undefined {
    const slot = this.set.slot(index);
    if (slot < 0) return undefined;
    const row = this.rows[slot];
    return row ? copyData(row) : undefined;
  }

  write(index: number, data: Record<string, unknown>): void {
    const slot = this.set.ensure(index);
    this.rows[slot] = copyData(data);
  }

  readPath(index: number, path: FieldPath): unknown {
    const row = this.read(index);
    if (!row) return undefined;
    if (path.kind === 'lane') {
      const vector = row[path.field.name];
      return Array.isArray(vector) ? vector[path.laneIndex] : undefined;
    }
    const value = row[path.field.name];
    return Array.isArray(value) ? [...value] : value;
  }

  writePath(index: number, path: FieldPath, value: unknown): void {
    const slot = this.set.slot(index);
    if (slot < 0) return;
    const row = this.rows[slot];
    if (!row) return;
    if (path.kind === 'lane') {
      const current = vectorOf(row[path.field.name]);
      const next = path.field.defaults.length > 0 ? [...path.field.defaults] : current;
      for (let lane = 0; lane < next.length; lane += 1) {
        if (current[lane] !== undefined) next[lane] = current[lane] as number;
      }
      next[path.laneIndex] = value as number;
      row[path.field.name] = next;
      return;
    }
    row[path.field.name] = Array.isArray(value) ? [...value] : value;
  }

  clear(): void {
    this.set.sparse = new Int32Array(0);
    this.set.dense = [];
    this.rows = [];
  }
}

class SoaStore implements ComponentStore {
  private readonly set = new SparseSet();
  private readonly floats = new Map<string, Float64Array>();
  private readonly bools = new Map<string, Uint8Array>();
  private readonly strings = new Map<string, string[]>();

  constructor(private readonly model: NormalizedComponent) {
    for (const field of model.fields) this.prepare(field);
  }

  has(index: number): boolean {
    return this.set.slot(index) >= 0;
  }

  delete(index: number): boolean {
    const slot = this.set.remove(index);
    if (slot < 0) return false;
    const last = this.set.dense.length;
    this.swapColumn(slot, last);
    return true;
  }

  read(index: number): Record<string, unknown> | undefined {
    const slot = this.set.slot(index);
    if (slot < 0) return undefined;
    const out: Record<string, unknown> = {};
    for (const field of this.model.fields) out[field.name] = this.readField(field, slot);
    return out;
  }

  write(index: number, data: Record<string, unknown>): void {
    const slot = this.set.ensure(index);
    this.grow(this.set.dense.length);
    for (const field of this.model.fields) this.writeField(field, slot, data[field.name]);
  }

  readPath(index: number, path: FieldPath): unknown {
    const slot = this.set.slot(index);
    if (slot < 0) return undefined;
    if (path.kind === 'lane') return this.floatColumn(path.field, path.laneIndex)[slot];
    return this.readField(path.field, slot);
  }

  writePath(index: number, path: FieldPath, value: unknown): void {
    const slot = this.set.slot(index);
    if (slot < 0) return;
    if (path.kind === 'lane') {
      this.floatColumn(path.field, path.laneIndex)[slot] = value as number;
      return;
    }
    this.writeField(path.field, slot, value);
  }

  clear(): void {
    this.set.sparse = new Int32Array(0);
    this.set.dense = [];
    for (const column of this.floats.values()) column.fill(0);
    for (const column of this.bools.values()) column.fill(0);
    for (const column of this.strings.values()) column.length = 0;
  }

  private prepare(field: NormalizedField): void {
    if (field.type === 'boolean') this.bools.set(field.name, new Uint8Array(8));
    else if (field.type === 'string') this.strings.set(field.name, []);
    else if (field.lanes.length === 0) this.floats.set(field.name, new Float64Array(8));
    else {
      for (const lane of field.lanes) this.floats.set(`${field.name}.${lane}`, new Float64Array(8));
    }
  }

  private floatColumn(field: NormalizedField, laneIndex: number): Float64Array {
    const key = field.lanes.length === 0 ? field.name : `${field.name}.${field.lanes[laneIndex] ?? laneIndex}`;
    return this.floats.get(key) ?? new Float64Array(0);
  }

  private readField(field: NormalizedField, slot: number): unknown {
    if (field.type === 'boolean') return (this.bools.get(field.name)?.[slot] ?? 0) === 1;
    if (field.type === 'string') return this.strings.get(field.name)?.[slot] ?? field.defaultString;
    if (field.lanes.length === 0) return this.floatColumn(field, 0)[slot] ?? defaultFieldValue(field);
    return field.lanes.map((_, lane) => this.floatColumn(field, lane)[slot] ?? 0);
  }

  private writeField(field: NormalizedField, slot: number, value: unknown): void {
    if (field.type === 'boolean') {
      const column = this.bools.get(field.name);
      if (column) column[slot] = value === true ? 1 : 0;
      return;
    }
    if (field.type === 'string') {
      const column = this.strings.get(field.name);
      if (column) column[slot] = typeof value === 'string' ? value : field.defaultString;
      return;
    }
    if (field.lanes.length === 0) {
      this.floatColumn(field, 0)[slot] = typeof value === 'number' ? value : 0;
      return;
    }
    const lanes = vectorOf(value);
    for (let lane = 0; lane < field.lanes.length; lane += 1) {
      this.floatColumn(field, lane)[slot] = lanes[lane] ?? 0;
    }
  }

  private grow(size: number): void {
    for (const [key, column] of this.floats) {
      if (column.length >= size) continue;
      const next = new Float64Array(Math.max(size, column.length * 2));
      next.set(column);
      this.floats.set(key, next);
    }
    for (const [key, column] of this.bools) {
      if (column.length >= size) continue;
      const next = new Uint8Array(Math.max(size, column.length * 2));
      next.set(column);
      this.bools.set(key, next);
    }
    for (const column of this.strings.values()) {
      while (column.length < size) column.push('');
    }
  }

  private swapColumn(slot: number, last: number): void {
    if (slot === last) return;
    for (const column of this.floats.values()) column[slot] = column[last] ?? 0;
    for (const column of this.bools.values()) column[slot] = column[last] ?? 0;
    for (const column of this.strings.values()) column[slot] = column[last] ?? '';
  }
}

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

export class JsonStore {
  private values: Array<Map<string, unknown> | undefined> = [];

  has(index: number, key: string): boolean {
    return this.values[index]?.has(key) ?? false;
  }

  get(index: number, key: string): unknown {
    const value = this.values[index]?.get(key);
    if (value === undefined) return undefined;
    return cloneJson(value);
  }

  keys(index: number): string[] {
    const map = this.values[index];
    return map ? [...map.keys()] : [];
  }

  set(index: number, key: string, value: unknown): void {
    let map = this.values[index];
    if (!map) {
      map = new Map();
      this.values[index] = map;
    }
    map.set(key, cloneJson(value));
  }

  delete(index: number, key: string): boolean {
    return this.values[index]?.delete(key) ?? false;
  }

  deleteEntity(index: number): void {
    this.values[index] = undefined;
  }

  clear(): void {
    this.values = [];
  }
}

export function readJsonPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split('.')) {
    if (forbidden.has(part)) return undefined;
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function writeJsonPath(root: unknown, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.').filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => forbidden.has(part))) {
    throw new EcsError('unknown-field', `Refusing field path "${path}"`);
  }
  const base = isBag(root) ? { ...root } : {};
  if (parts.length === 1) {
    base[parts[0] as string] = value;
    return base;
  }
  const head = parts[0] as string;
  base[head] = writeJsonPath(base[head], parts.slice(1).join('.'), value);
  return base;
}

export function cloneJson(value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new EcsError('invalid-value', 'Value must be JSON-serializable');
  }
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    throw new EcsError('invalid-value', 'Value must be JSON-serializable');
  }
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
