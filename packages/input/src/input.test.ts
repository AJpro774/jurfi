import { describe, expect, it } from 'vitest';
import schemaFile from '../schema/action-map.schema.json';
import docsSchema from '../../../docs/api/action-map.schema.json';
import { ACTION_MAP_SCHEMA, Input, validateActionMap, VirtualButton, VirtualStick } from './index';
import type { ActionMapJSON } from './index';

const map: ActionMapJSON = {
  version: 1,
  actions: {
    jump: { type: 'button', contexts: ['gameplay'], bindings: [{ device: 'key', code: 'Space' }, { device: 'gamepad', button: 0 }] },
    move: { type: 'axis2d', contexts: ['gameplay'], bindings: [{ device: 'key', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }, { device: 'gamepad', stick: 'left' }, { device: 'touch', control: 'stick' }] },
    look: { type: 'axis2d', bindings: [{ device: 'mouse', delta: 'move', scale: 0.5 }] },
    zoom: { type: 'axis1d', bindings: [{ device: 'mouse', delta: 'wheel', scale: 0.1 }, { device: 'key', negative: 'KeyQ', positive: 'KeyE' }] },
    confirm: { type: 'button', contexts: ['ui'], bindings: [{ device: 'key', code: 'Enter' }] },
  },
};

function pad(over: Partial<{ buttons: number[]; axes: number[]; connected: boolean }> = {}) {
  return {
    connected: over.connected ?? true,
    id: 'fake',
    index: 0,
    buttons: (over.buttons ?? []).map((v) => ({ value: v, pressed: v > 0.5, touched: v > 0 })),
    axes: over.axes ?? [0, 0, 0, 0],
  } as unknown as Gamepad;
}

function setup() {
  const target = new EventTarget();
  const el = new EventTarget();
  let pads: (Gamepad | null)[] = [];
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as Element | null, exitPointerLock() {} });
  const input = new Input({ target, element: el as unknown as Element, document: doc as never, getGamepads: () => pads, actionMap: map });
  const key = (type: 'keydown' | 'keyup', code: string) => target.dispatchEvent(Object.assign(new Event(type), { code }));
  return { input, target, el, doc, key, setPads: (p: (Gamepad | null)[]) => { pads = p; } };
}

describe('keyboard actions', () => {
  it('pressed / justPressed / justReleased edges', () => {
    const { input, key } = setup();
    const jump = input.action('jump');
    input.update();
    expect(jump.pressed).toBe(false);
    key('keydown', 'Space');
    input.update();
    expect([jump.pressed, jump.justPressed, jump.justReleased]).toEqual([true, true, false]);
    input.update();
    expect([jump.pressed, jump.justPressed]).toEqual([true, false]);
    key('keyup', 'Space');
    input.update();
    expect([jump.pressed, jump.justReleased]).toEqual([false, true]);
    input.update();
    expect(jump.justReleased).toBe(false);
  });

  it('axis2 from WASD is normalized on diagonals; returns persistent object', () => {
    const { input, key } = setup();
    const a = input.axis2('move');
    key('keydown', 'KeyW'); key('keydown', 'KeyD');
    input.update();
    expect(a.x).toBeCloseTo(Math.SQRT1_2);
    expect(a.y).toBeCloseTo(-Math.SQRT1_2);
    expect(input.axis2('move')).toBe(a);
  });

  it('axis1d from key pair and unknown actions are inert', () => {
    const { input, key } = setup();
    key('keydown', 'KeyQ');
    input.update();
    expect(input.axis1('zoom')).toBe(-1);
    expect(input.action('nope').pressed).toBe(false);
  });
});

describe('contexts', () => {
  it('only actions of the active context fire', () => {
    const { input, key } = setup();
    key('keydown', 'Space'); key('keydown', 'Enter');
    input.update();
    expect(input.action('jump').pressed).toBe(true);
    expect(input.action('confirm').pressed).toBe(false);
    input.setContext('ui');
    input.update();
    expect(input.action('jump').pressed).toBe(false);
    expect(input.action('jump').justReleased).toBe(true);
    expect(input.action('confirm').justPressed).toBe(true);
  });
  it('push/pop', () => {
    const { input } = setup();
    input.pushContext('ui');
    expect(input.context).toBe('ui');
    expect(input.popContext()).toBe('ui');
    expect(input.context).toBe('gameplay');
    expect(input.popContext()).toBeUndefined();
  });
});

describe('rebinding', () => {
  it('rebinds, adds, resets, and serializes', () => {
    const { input, key } = setup();
    input.rebind('jump', [{ device: 'key', code: 'KeyJ' }]);
    key('keydown', 'Space');
    input.update();
    expect(input.action('jump').pressed).toBe(false);
    key('keydown', 'KeyJ');
    input.update();
    expect(input.action('jump').pressed).toBe(true);
    expect((input.toJSON().actions.jump?.bindings[0] as { code: string }).code).toBe('KeyJ');
    input.resetBindings('jump');
    input.update();
    expect(input.action('jump').pressed).toBe(true); // Space still held
    expect(() => input.rebind('x', [])).toThrow();
  });
});

describe('mouse', () => {
  it('accumulates deltas per frame, buttons, wheel, pointer lock', () => {
    const { input, el, doc } = setup();
    el.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 5, clientY: 6, movementX: 4, movementY: -2 }));
    el.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 5, clientY: 6, movementX: 4, movementY: -2 }));
    input.update();
    expect(input.axis2('look').x).toBe(4);
    expect(input.axis2('look').y).toBe(-2);
    input.update();
    expect(input.axis2('look').x).toBe(0);
    el.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100 }));
    input.update();
    expect(input.axis1('zoom')).toBeCloseTo(10);
    el.dispatchEvent(Object.assign(new Event('mousedown'), { button: 2 }));
    expect(input.mouse.isDown(2)).toBe(true);
    doc.pointerLockElement = {} as Element;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(input.pointerLocked).toBe(true);
  });
});

describe('gamepad', () => {
  it('applies radial deadzone and button values', () => {
    const { input, setPads } = setup();
    setPads([pad({ axes: [0.1, 0.05, 0, 0], buttons: [1] })]);
    input.update();
    expect(input.axis2('move').x).toBe(0);
    expect(input.action('jump').pressed).toBe(true);
    setPads([pad({ axes: [1, 0, 0, 0] })]);
    input.update();
    expect(input.axis2('move').x).toBeCloseTo(1);
    setPads([pad({ axes: [0.575, 0, 0, 0] })]);
    input.update();
    expect(input.axis2('move').x).toBeCloseTo(0.5);
  });

  it('fires connect/disconnect and clears state', () => {
    const { input, target, setPads } = setup();
    const log: string[] = [];
    input.gamepads.onConnect = (i) => log.push(`c${i}`);
    input.gamepads.onDisconnect = (i) => log.push(`d${i}`);
    setPads([pad({ buttons: [1] })]);
    target.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: { index: 0, id: 'fake' } }));
    input.update();
    expect(input.gamepads.connected[0]).toBe(1);
    expect(input.action('jump').pressed).toBe(true);
    setPads([null]);
    target.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 0, id: 'fake' } }));
    input.update();
    expect(input.action('jump').pressed).toBe(false);
    expect(log).toEqual(['c0', 'd0']);
  });
});

describe('touch', () => {
  it('virtual stick and button', () => {
    const { input, target } = setup();
    const stick = input.touch.addStick(new VirtualStick('stick', 0, 0, 200, 400, 50));
    const btn = input.touch.addButton(new VirtualButton('fire', 300, 0, 100, 100));
    const touch = (type: string, id: number, x: number, y: number) =>
      target.dispatchEvent(Object.assign(new Event(type), { changedTouches: [{ identifier: id, clientX: x, clientY: y }] }));
    touch('touchstart', 1, 100, 100);
    touch('touchmove', 1, 125, 100);
    input.update();
    expect(stick.active).toBe(true);
    expect(input.axis2('move').x).toBeCloseTo(0.5);
    touch('touchstart', 2, 320, 50);
    expect(btn.pressed).toBe(true);
    touch('touchend', 2, 320, 50);
    expect(btn.pressed).toBe(false);
    touch('touchend', 1, 125, 100);
    input.update();
    expect(input.axis2('move').x).toBe(0);
  });
});

const mem = (): number => (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process.memoryUsage().heapUsed;

describe('zero allocation', () => {
  it('update() does not grow the heap noticeably', () => {
    const { input, key } = setup();
    key('keydown', 'KeyW');
    for (let i = 0; i < 1000; i++) input.update();
    const g = globalThis as { gc?: () => void };
    g.gc?.();
    const before = mem();
    for (let i = 0; i < 100000; i++) input.update();
    const after = mem();
    expect(after - before).toBeLessThan(2_000_000);
  });
});

describe('schema', () => {
  it('validates the sample map and rejects bad ones', () => {
    expect(validateActionMap(map)).toEqual([]);
    expect(validateActionMap({ version: 2, actions: {} })).not.toEqual([]);
    expect(validateActionMap({ version: 1, actions: { a: { type: 'wat', bindings: [] } } })).not.toEqual([]);
  });
  it('schema files are in sync with ACTION_MAP_SCHEMA (run `pnpm --filter @jurfi/input schema`)', () => {
    expect(schemaFile).toEqual(JSON.parse(JSON.stringify(ACTION_MAP_SCHEMA)));
    expect(docsSchema).toEqual(schemaFile);
  });
});
