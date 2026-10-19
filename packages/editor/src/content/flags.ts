import type { EditorContext } from '../context';

/** Editor metadata. Missing means visible and unlocked. Persisted as project section `hierarchy.flags`. */
export const FLAGS_KEY = 'jurfi.flags';

export interface EntityFlags {
  visible: boolean;
  locked: boolean;
}

interface FlagBook {
  read(id: string): EntityFlags;
  write(id: string, flags: EntityFlags): void;
  snapshot(): Record<string, { visible?: boolean; locked?: boolean }>;
  restore(data: unknown): void;
  subscribe(listener: () => void): () => void;
}

const books = new WeakMap<EditorContext, FlagBook>();

export function readFlags(ctx: EditorContext, id: string): EntityFlags {
  return book(ctx).read(id);
}

export function flagBook(ctx: EditorContext): FlagBook {
  return book(ctx);
}

export function exportFlags(ctx: EditorContext): Record<string, { visible?: boolean; locked?: boolean }> {
  return book(ctx).snapshot();
}

export function importFlags(ctx: EditorContext, data: unknown): void {
  book(ctx).restore(data);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function book(ctx: EditorContext): FlagBook {
  const existing = books.get(ctx);
  if (existing) return existing;
  const created = createBook();
  books.set(ctx, created);
  return created;
}

function createBook(): FlagBook {
  const flags = new Map<string, EntityFlags>();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    read(id) {
      return { ...(flags.get(id) ?? { visible: true, locked: false }) };
    },
    write(id, next) {
      if (next.visible && !next.locked) flags.delete(id);
      else flags.set(id, { visible: next.visible, locked: next.locked });
      emit();
    },
    snapshot() {
      const saved: Record<string, { visible?: boolean; locked?: boolean }> = {};
      for (const [id, value] of flags) {
        const row: { visible?: boolean; locked?: boolean } = {};
        if (!value.visible) row.visible = false;
        if (value.locked) row.locked = true;
        if (row.visible === false || row.locked === true) saved[id] = row;
      }
      return saved;
    },
    restore(data) {
      flags.clear();
      if (!isRecord(data)) {
        emit();
        return;
      }
      for (const [id, value] of Object.entries(data)) {
        if (!isRecord(value)) continue;
        const next = {
          visible: value.visible !== false,
          locked: value.locked === true,
        };
        if (!next.visible || next.locked) flags.set(id, next);
      }
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
