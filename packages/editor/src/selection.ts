export interface Selection {
  get(): readonly string[];
  set(ids: readonly string[]): void;
  subscribe(listener: (ids: readonly string[]) => void): () => void;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createSelection(): Selection {
  let ids: readonly string[] = [];
  const listeners = new Set<(ids: readonly string[]) => void>();

  return {
    get: () => ids,
    set(next) {
      const copy = [...next];
      if (sameIds(ids, copy)) return;
      ids = copy;
      for (const listener of [...listeners]) listener(ids);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
