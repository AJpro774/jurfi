/** Shared monotonically increasing stamp used to find the most recently active pointer source. */
let stampCounter = 0;
export function nextStamp(): number { return ++stampCounter; }

export interface ElementLike {
  getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
}

/** Absolute pointer position. `x`/`y` are element-relative pixels, `nx`/`ny` are normalized 0..1 (unclamped outside the element). */
export class PointerState {
  active = false;
  source: 'none' | 'mouse' | 'touch' = 'none';
  x = 0;
  y = 0;
  nx = 0;
  ny = 0;
  /** @internal */
  stamp = 0;

  /** Set from client coordinates relative to `el` (or the viewport if no element/rect). Allocation-free apart from the browser's rect. */
  setClient(el: ElementLike | undefined, cx: number, cy: number): void {
    const r = el?.getBoundingClientRect?.();
    let w: number, h: number;
    if (r) {
      this.x = cx - r.left; this.y = cy - r.top; w = r.width; h = r.height;
    } else {
      this.x = cx; this.y = cy;
      const g = globalThis as { innerWidth?: number; innerHeight?: number };
      w = g.innerWidth ?? 0; h = g.innerHeight ?? 0;
    }
    this.nx = w > 0 ? this.x / w : 0;
    this.ny = h > 0 ? this.y / h : 0;
    this.stamp = nextStamp();
  }

  copyFrom(o: PointerState): void {
    this.active = o.active; this.source = o.source; this.x = o.x; this.y = o.y; this.nx = o.nx; this.ny = o.ny; this.stamp = o.stamp;
  }
}
