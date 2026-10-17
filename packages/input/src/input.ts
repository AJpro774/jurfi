import { Gamepads } from './gamepad';
import { Keyboard } from './keyboard';
import { Mouse } from './mouse';
import { PointerState } from './pointer';
import { validateActionMap } from './schema';
import { TouchControls } from './touch';
import type { ActionDef, ActionMapJSON, ActionState, Binding, InputOptions } from './types';

interface Entry extends ActionState {
  def: ActionDef;
  original: Binding[];
}

const EMPTY: never[] = [];

/**
 * Polled input state. Call `update()` once per frame, then query actions.
 * Action state objects are persistent, so queries and update() do not allocate.
 */
export class Input {
  readonly keyboard: Keyboard;
  readonly mouse: Mouse;
  readonly gamepads: Gamepads;
  readonly touch: TouchControls;
  /** Most recently used absolute pointer (mouse or touch): element-relative px and normalized 0..1. Refreshed in update(). */
  readonly pointer = new PointerState();
  buttonThreshold: number;
  private preventAuto = false;
  private readonly bound = new Set<string>();
  private readonly actions = new Map<string, Entry>();
  private readonly list: Entry[] = [];
  private readonly stack: string[] = ['gameplay'];
  private tx = 0;
  private ty = 0;

  constructor(opts: InputOptions = {}) {
    const target = opts.target ?? (globalThis as unknown as EventTarget);
    const doc = opts.document ?? (globalThis as { document?: InputOptions['document'] }).document;
    this.buttonThreshold = opts.buttonThreshold ?? 0.5;
    this.keyboard = new Keyboard(target);
    this.mouse = new Mouse(opts.element, doc, target);
    this.touch = new TouchControls(target, opts.element);
    const getPads = opts.getGamepads ?? (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : EMPTY));
    this.gamepads = new Gamepads(target, getPads, opts.deadzone ?? 0.15);
    if (opts.context) this.stack[0] = opts.context;
    if (opts.actionMap) this.loadActionMap(opts.actionMap);
    if (opts.preventDefaultKeys !== undefined) this.setPreventDefaultKeys(opts.preventDefaultKeys);
  }

  /** Change preventDefault behaviour at runtime: key code list, `true` (all bound keys) or `false`/empty (off). */
  setPreventDefaultKeys(v: string[] | boolean): void {
    this.preventAuto = v === true;
    if (v === true) { this.refreshBound(); this.keyboard.preventKeys = this.bound; }
    else if (v === false || v.length === 0) this.keyboard.preventKeys = null;
    else this.keyboard.preventKeys = new Set(v);
  }

  private refreshBound(): void {
    if (!this.preventAuto) return;
    this.bound.clear();
    for (const e of this.list) {
      for (const b of e.def.bindings) {
        if (b.device !== 'key') continue;
        if ('code' in b) this.bound.add(b.code);
        else if ('negative' in b) { this.bound.add(b.negative); this.bound.add(b.positive); }
        else { this.bound.add(b.up); this.bound.add(b.down); this.bound.add(b.left); this.bound.add(b.right); }
      }
    }
  }

  // ---- action map
  loadActionMap(map: ActionMapJSON): void {
    const errs = validateActionMap(map);
    if (errs.length) throw new Error(`Invalid action map: ${errs.join('; ')}`);
    for (const [name, def] of Object.entries(map.actions)) this.define(name, def);
  }

  define(name: string, def: ActionDef): void {
    const copy: ActionDef = { type: def.type, bindings: def.bindings.map((b) => ({ ...b })), ...(def.contexts ? { contexts: [...def.contexts] } : {}) };
    const existing = this.actions.get(name);
    if (existing && existing.type === def.type) {
      existing.def = copy;
      existing.original = copy.bindings.map((b) => ({ ...b }));
      this.refreshBound();
      return;
    }
    const e: Entry = { name, type: def.type, pressed: false, justPressed: false, justReleased: false, value: 0, x: 0, y: 0, def: copy, original: copy.bindings.map((b) => ({ ...b })) };
    this.actions.set(name, e);
    this.list.push(e);
    this.refreshBound();
  }

  toJSON(): ActionMapJSON {
    const actions: Record<string, ActionDef> = {};
    for (const e of this.list) actions[e.name] = { type: e.def.type, bindings: e.def.bindings.map((b) => ({ ...b })), ...(e.def.contexts ? { contexts: [...e.def.contexts] } : {}) };
    return { version: 1, actions };
  }

  // ---- runtime rebinding
  /** Replace all bindings of an action. */
  rebind(name: string, bindings: Binding[]): void {
    this.entry(name).def.bindings = bindings.map((b) => ({ ...b }));
    this.refreshBound();
  }
  addBinding(name: string, b: Binding): void {
    this.entry(name).def.bindings.push({ ...b });
    this.refreshBound();
  }
  removeBinding(name: string, index: number): void {
    this.entry(name).def.bindings.splice(index, 1);
    this.refreshBound();
  }
  getBindings(name: string): readonly Binding[] {
    return this.entry(name).def.bindings;
  }
  resetBindings(name?: string): void {
    for (const e of name ? [this.entry(name)] : this.list) e.def.bindings = e.original.map((b) => ({ ...b }));
    this.refreshBound();
  }
  private entry(name: string): Entry {
    const e = this.actions.get(name);
    if (!e) throw new Error(`Unknown action '${name}'`);
    return e;
  }

  // ---- contexts
  get context(): string {
    return this.stack[this.stack.length - 1] as string;
  }
  /** Replace the whole stack with a single context. */
  setContext(name: string): void {
    this.stack.length = 0;
    this.stack.push(name);
  }
  pushContext(name: string): void {
    this.stack.push(name);
  }
  popContext(): string | undefined {
    return this.stack.length > 1 ? this.stack.pop() : undefined;
  }

  // ---- queries
  private readonly missing = new Map<string, ActionState>();

  /** Persistent state of an action; unknown names yield an inert, never-pressed state. */
  action(name: string): ActionState {
    const e = this.actions.get(name);
    if (e) return e;
    let m = this.missing.get(name);
    if (!m) {
      m = { name, type: 'button', pressed: false, justPressed: false, justReleased: false, value: 0, x: 0, y: 0 };
      this.missing.set(name, m);
    }
    return m;
  }
  /** axis2d value as {x,y}; y is -1 for up/forward-on-stick (screen convention). The object is persistent. */
  axis2(name: string): { readonly x: number; readonly y: number } {
    return this.action(name);
  }
  axis1(name: string): number {
    return this.action(name).value;
  }

  // ---- frame update
  /** Poll devices and recompute every action. Call once per frame, before game logic. */
  update(): void {
    this.gamepads.poll();
    this.mouse.latch();
    const tp = this.touch.pointer, mp = this.mouse.pointer;
    if (tp.active && tp.stamp >= mp.stamp) this.pointer.copyFrom(tp);
    else if (mp.active) this.pointer.copyFrom(mp);
    else this.pointer.active = false;
    const ctx = this.context;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i] as Entry;
      const cs = e.def.contexts;
      const active = cs === undefined || cs.includes(ctx);
      const was = e.pressed;
      let v = 0;
      let x = 0;
      let y = 0;
      if (active) {
        const bs = e.def.bindings;
        const t = e.type;
        for (let k = 0; k < bs.length; k++) {
          const b = bs[k] as Binding;
          if (t === 'axis2d') {
            this.vec2(b);
            if (this.tx * this.tx + this.ty * this.ty > x * x + y * y) { x = this.tx; y = this.ty; }
          } else {
            const s = this.scalar(b);
            if (Math.abs(s) > Math.abs(v)) v = s;
          }
        }
      }
      if (e.type === 'button') {
        e.value = Math.abs(v);
        e.pressed = e.value >= this.buttonThreshold;
      } else if (e.type === 'axis1d') {
        e.value = v;
        e.pressed = Math.abs(v) >= this.buttonThreshold;
      } else {
        e.x = x; e.y = y;
        e.value = Math.sqrt(x * x + y * y);
        e.pressed = e.value >= this.buttonThreshold;
      }
      e.justPressed = e.pressed && !was;
      e.justReleased = !e.pressed && was;
    }
  }

  private scalar(b: Binding): number {
    switch (b.device) {
      case 'key':
        if ('code' in b) return this.keyboard.isDown(b.code) ? 1 : 0;
        if ('negative' in b) return (this.keyboard.isDown(b.positive) ? 1 : 0) - (this.keyboard.isDown(b.negative) ? 1 : 0);
        return 0;
      case 'mouse':
        if ('button' in b) return this.mouse.isDown(b.button) ? 1 : 0;
        if (b.delta === 'x') return this.mouse.frameDx * (b.scale ?? 1);
        if (b.delta === 'y') return this.mouse.frameDy * (b.scale ?? 1);
        if (b.delta === 'wheel') return this.mouse.frameWheel * (b.scale ?? 1);
        return 0;
      case 'gamepad': {
        const p = b.pad ?? 0;
        if ('button' in b) return this.gamepads.button(p, b.button);
        if ('axis' in b) return this.gamepads.axis(p, b.axis) * (b.scale ?? 1);
        return 0;
      }
      case 'touch': {
        const btn = this.touch.getButton(b.control);
        if (btn) return btn.pressed ? 1 : 0;
        const st = this.touch.getStick(b.control);
        return st ? st.x : 0;
      }
    }
  }

  private vec2(b: Binding): void {
    this.tx = 0; this.ty = 0;
    switch (b.device) {
      case 'key':
        if ('up' in b) {
          const kb = this.keyboard;
          const x = (kb.isDown(b.right) ? 1 : 0) - (kb.isDown(b.left) ? 1 : 0);
          const y = (kb.isDown(b.down) ? 1 : 0) - (kb.isDown(b.up) ? 1 : 0);
          const m = x !== 0 && y !== 0 ? Math.SQRT1_2 : 1;
          this.tx = x * m; this.ty = y * m;
        }
        return;
      case 'mouse':
        if ('delta' in b && b.delta === 'move') {
          const s = b.scale ?? 1;
          this.tx = this.mouse.frameDx * s; this.ty = this.mouse.frameDy * s;
        }
        return;
      case 'gamepad':
        if ('stick' in b) {
          const i = this.gamepads.stick(b.pad ?? 0, b.stick);
          this.tx = this.gamepads.sticks[i] as number; this.ty = this.gamepads.sticks[i + 1] as number;
        }
        return;
      case 'touch': {
        const st = this.touch.getStick(b.control);
        if (st) { this.tx = st.x; this.ty = st.y; }
        return;
      }
    }
  }

  // ---- pointer lock / lifecycle
  requestPointerLock(): void { this.mouse.requestPointerLock(); }
  exitPointerLock(): void { this.mouse.exitPointerLock(); }
  get pointerLocked(): boolean { return this.mouse.locked; }

  dispose(): void {
    this.keyboard.detach(); this.mouse.detach(); this.gamepads.detach(); this.touch.detach();
  }
}
