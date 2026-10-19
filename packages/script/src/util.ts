/** JSON-compatible values that can be stored in a graph document or compiled program. */
export function isJsonValue(value: unknown): boolean {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return true;
  if (kind === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (kind === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function propString(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  return typeof value === 'string' ? value : '';
}

function entityId(value: unknown): string | number | undefined {
  if (!value || typeof value !== 'object' || !('id' in value)) return undefined;
  const id = (value as { id: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
}

/** Object.is, or matching entity ids when both values carry an id. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  const left = entityId(a);
  const right = entityId(b);
  return left !== undefined && right !== undefined && Object.is(left, right);
}
