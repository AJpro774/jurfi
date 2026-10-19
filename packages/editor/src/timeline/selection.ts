export interface KeyRef {
  trackId: string;
  /** Key time in seconds. */
  t: number;
  /**
   * Curve row within the key.
   * For a whole vector or color this is the component index.
   * For a quaternion it is an Euler axis (0..2), never a quat channel.
   * Omitted for a dopesheet selection of the whole key.
   */
  part?: number;
}

export function sameRef(a: KeyRef, b: KeyRef): boolean {
  return a.trackId === b.trackId && a.t === b.t && a.part === b.part;
}

export function hasRef(list: readonly KeyRef[], ref: KeyRef): boolean {
  return list.some((item) => sameRef(item, ref));
}

export function toggleRef(list: readonly KeyRef[], ref: KeyRef): KeyRef[] {
  return hasRef(list, ref) ? list.filter((item) => !sameRef(item, ref)) : [...list, ref];
}

export function addRef(list: readonly KeyRef[], ref: KeyRef): KeyRef[] {
  return hasRef(list, ref) ? [...list] : [...list, ref];
}

/** One entry per key, ignoring curve parts. */
export function uniqueKeyTimes(list: readonly KeyRef[]): { trackId: string; t: number }[] {
  const out: { trackId: string; t: number }[] = [];
  const seen = new Set<string>();
  for (const ref of list) {
    const id = `${ref.trackId}\0${ref.t}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ trackId: ref.trackId, t: ref.t });
  }
  return out;
}
