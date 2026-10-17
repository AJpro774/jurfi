export interface WorldEventMap {
  created: { entity: number };
  destroyed: { entity: number };
  added: { entity: number; component: string };
  removed: { entity: number; component: string };
  changed: { entity: number; component: string; field?: string };
}

export type WorldEventName = keyof WorldEventMap;

type Listener<K extends WorldEventName> = (event: WorldEventMap[K]) => void;

export class WorldEventBus {
  private readonly listeners = new Map<WorldEventName, Set<(event: WorldEventMap[WorldEventName]) => void>>();

  on<K extends WorldEventName>(type: K, listener: Listener<K>): () => void {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    const wrapped = listener as (event: WorldEventMap[WorldEventName]) => void;
    bucket.add(wrapped);
    return () => {
      bucket.delete(wrapped);
    };
  }

  emit<K extends WorldEventName>(type: K, event: WorldEventMap[K]): void {
    const bucket = this.listeners.get(type);
    if (!bucket) return;
    for (const listener of [...bucket]) listener(event);
  }
}
