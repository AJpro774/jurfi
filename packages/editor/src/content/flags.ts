/** Editor-owned component. Missing means visible and unlocked. */
export const FLAGS_KEY = 'jurfi.flags';

export interface EntityFlags {
  visible: boolean;
  locked: boolean;
}

export function readFlags(components: Record<string, unknown>): EntityFlags {
  const raw = components[FLAGS_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { visible: true, locked: false };
  }
  const record = raw as Record<string, unknown>;
  return {
    visible: record.visible !== false,
    locked: record.locked === true,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
