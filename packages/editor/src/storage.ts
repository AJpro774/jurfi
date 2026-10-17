/** `localStorage`-shaped store so layout and autosave can be tested without a browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStore(seed: Record<string, string> = {}): KeyValueStore {
  const data = { ...seed };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] ?? null : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

export function browserStore(): KeyValueStore {
  if (typeof localStorage === 'undefined') return memoryStore();
  return localStorage;
}
