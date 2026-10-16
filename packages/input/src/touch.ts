/** Virtual on-screen stick. Coordinates are in client pixels. */
export class VirtualStick {
  x = 0;
  y = 0;
  active = false;
  /** Pointer/touch identifier currently driving this stick (-1 = none). */
  touchId = -1;
  originX = 0;
  originY = 0;
  constructor(
    public readonly id: string,
    /** Hit region: left, top, width, height. */
    public left: number, public top: number, public width: number, public height: number,
    /** Pixel radius mapping to full deflection. */
    public radius = 60,
    /** Fraction of radius ignored. */
    public deadzone = 0.1,
  ) {}
  contains(px: number, py: number): boolean {
    return px >= this.left && px < this.left + this.width && py >= this.top && py < this.top + this.height;
  }
  begin(touchId: number, px: number, py: number): void {
    this.active = true; this.touchId = touchId; this.originX = px; this.originY = py; this.x = 0; this.y = 0;
  }
  move(px: number, py: number): void {
    let dx = (px - this.originX) / this.radius;
    let dy = (py - this.originY) / this.radius;
    const m = Math.sqrt(dx * dx + dy * dy);
    if (m > 1) { dx /= m; dy /= m; }
    if (m < this.deadzone) { dx = 0; dy = 0; }
    this.x = dx; this.y = dy;
  }
  end(): void {
    this.active = false; this.touchId = -1; this.x = 0; this.y = 0;
  }
}

export class VirtualButton {
  pressed = false;
  touchId = -1;
  constructor(public readonly id: string, public left: number, public top: number, public width: number, public height: number) {}
  contains(px: number, py: number): boolean {
    return px >= this.left && px < this.left + this.width && py >= this.top && py < this.top + this.height;
  }
}

/** Dispatches touch events to registered virtual sticks/buttons. Iterates without allocating. */
export class TouchControls {
  readonly sticks: VirtualStick[] = [];
  readonly buttons: VirtualButton[] = [];
  readonly detach: () => void;

  constructor(target: EventTarget) {
    const s = this.onStart as EventListener, m = this.onMove as EventListener, e = this.onEnd as EventListener;
    target.addEventListener('touchstart', s);
    target.addEventListener('touchmove', m);
    target.addEventListener('touchend', e);
    target.addEventListener('touchcancel', e);
    this.detach = () => {
      target.removeEventListener('touchstart', s);
      target.removeEventListener('touchmove', m);
      target.removeEventListener('touchend', e);
      target.removeEventListener('touchcancel', e);
    };
  }

  addStick(stick: VirtualStick): VirtualStick { this.sticks.push(stick); return stick; }
  addButton(button: VirtualButton): VirtualButton { this.buttons.push(button); return button; }
  getStick(id: string): VirtualStick | undefined { return this.sticks.find((s) => s.id === id); }
  getButton(id: string): VirtualButton | undefined { return this.buttons.find((b) => b.id === id); }

  private readonly onStart = (ev: TouchEvent): void => {
    const list = ev.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Touch;
      for (let k = 0; k < this.sticks.length; k++) {
        const st = this.sticks[k] as VirtualStick;
        if (!st.active && st.contains(t.clientX, t.clientY)) { st.begin(t.identifier, t.clientX, t.clientY); break; }
      }
      for (let k = 0; k < this.buttons.length; k++) {
        const b = this.buttons[k] as VirtualButton;
        if (b.touchId === -1 && b.contains(t.clientX, t.clientY)) { b.pressed = true; b.touchId = t.identifier; }
      }
    }
  };
  private readonly onMove = (ev: TouchEvent): void => {
    const list = ev.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Touch;
      for (let k = 0; k < this.sticks.length; k++) {
        const st = this.sticks[k] as VirtualStick;
        if (st.touchId === t.identifier) st.move(t.clientX, t.clientY);
      }
    }
  };
  private readonly onEnd = (ev: TouchEvent): void => {
    const list = ev.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Touch;
      for (let k = 0; k < this.sticks.length; k++) {
        const st = this.sticks[k] as VirtualStick;
        if (st.touchId === t.identifier) st.end();
      }
      for (let k = 0; k < this.buttons.length; k++) {
        const b = this.buttons[k] as VirtualButton;
        if (b.touchId === t.identifier) { b.pressed = false; b.touchId = -1; }
      }
    }
  };
}
