export type ActionType = 'button' | 'axis1d' | 'axis2d';

export type Binding =
  // keyboard (KeyboardEvent.code)
  | { device: 'key'; code: string }
  | { device: 'key'; negative: string; positive: string }
  | { device: 'key'; up: string; down: string; left: string; right: string }
  // mouse
  | { device: 'mouse'; button: number }
  | { device: 'mouse'; delta: 'x' | 'y' | 'wheel'; scale?: number }
  | { device: 'mouse'; delta: 'move'; scale?: number }
  // gamepad (standard mapping)
  | { device: 'gamepad'; button: number; pad?: number }
  | { device: 'gamepad'; axis: number; pad?: number; scale?: number }
  | { device: 'gamepad'; stick: 'left' | 'right'; pad?: number }
  // touch virtual controls (by id)
  | { device: 'touch'; control: string };

export interface ActionDef {
  type: ActionType;
  bindings: Binding[];
  /** Contexts in which the action is active. Omit = all contexts. */
  contexts?: string[];
}

export interface ActionMapJSON {
  version: 1;
  actions: Record<string, ActionDef>;
}

/** Persistent per-action state object (never reallocated; safe to retain). */
export interface ActionState {
  readonly name: string;
  readonly type: ActionType;
  /** button: held (or value>=threshold). */
  pressed: boolean;
  justPressed: boolean;
  justReleased: boolean;
  /** axis1d value, or button 0/1 (analog value for gamepad triggers). */
  value: number;
  /** axis2d components. */
  x: number;
  y: number;
}

export interface Vec2 { x: number; y: number }

export interface InputOptions {
  /** Target for key/touch/gamepad events. Default: window. */
  target?: EventTarget;
  /** Element for mouse events and pointer lock. */
  element?: Element & { requestPointerLock?: () => void | Promise<void> };
  /** Document used for pointerlockchange and exitPointerLock. */
  document?: Pick<Document, 'exitPointerLock'> & EventTarget & { pointerLockElement: Element | null };
  /** Override navigator.getGamepads (tests). */
  getGamepads?: () => ArrayLike<Gamepad | null>;
  /** Radial stick deadzone, default 0.15. */
  deadzone?: number;
  /** Analog value at which axis-as-button counts as pressed. Default 0.5. */
  buttonThreshold?: number;
  actionMap?: ActionMapJSON;
  context?: string;
  /**
   * Opt-in: call preventDefault() on keydown for these KeyboardEvent.code values (e.g. ['Space','ArrowUp']
   * to stop page scrolling). `true` = every key bound in the action map (tracks rebinding). Default off.
   */
  preventDefaultKeys?: string[] | boolean;
}
