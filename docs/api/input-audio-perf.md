# @jurfi/input, @jurfi/audio, @jurfi/perf

Browser-only ESM packages. Hot paths (`Input.update`, `Input.action`, `Input.axis2`, `AudioEngine.syncListener`,
`Profiler.beginFrame/begin/end/endFrame`) do not allocate once set up. Web Audio node creation per `play()` and
`navigator.getGamepads()` are browser-side allocations we cannot avoid.

## @jurfi/input

```ts
class Input {
  constructor(opts?: InputOptions);          // { target, element, document, getGamepads, deadzone=0.15, buttonThreshold=0.5, actionMap, context, preventDefaultKeys }
  update(): void;                            // once per frame
  action(name: string): ActionState;         // persistent: pressed, justPressed, justReleased, value, x, y
  axis2(name: string): { readonly x: number; readonly y: number };
  axis1(name: string): number;
  setContext(name: string): void;            // replaces stack; also pushContext / popContext, `context` getter
  loadActionMap(map: ActionMapJSON): void;   // validates
  define(name: string, def: ActionDef): void;
  rebind(name: string, bindings: Binding[]): void;  // also addBinding, removeBinding, getBindings, resetBindings(name?)
  toJSON(): ActionMapJSON;                   // persist user rebinds
  setPreventDefaultKeys(v: string[] | boolean): void;
  readonly pointer: PointerState;            // absolute mouse/touch position, refreshed in update()
  requestPointerLock(): void; exitPointerLock(): void; readonly pointerLocked: boolean;
  readonly keyboard: Keyboard; mouse: Mouse; gamepads: Gamepads; touch: TouchControls;
  dispose(): void;
}
type ActionType = 'button' | 'axis1d' | 'axis2d';
```

Press latching: a key/mouse/touch-button press that starts and ends between two `update()` calls is not lost. Any down since the
previous `update()` makes the action (and `VirtualButton.pressed`) read pressed/justPressed through the next poll; it clears on the
following `update()`. Holds are unchanged. Auto-repeat keydowns are ignored, and gamepad buttons and axis-type bindings are sampled
state, so they are not latched.

Bindings (`device` = `key` | `mouse` | `gamepad` | `touch`): `{device:'key', code}`, `{device:'key', negative, positive}`,
`{device:'key', up, down, left, right}`, `{device:'mouse', button}`, `{device:'mouse', delta:'x'|'y'|'wheel'|'move', scale?}`,
`{device:'gamepad', button|axis|stick, pad?}`, `{device:'touch', control}`. 2D convention: up is `y = -1`.
An action with `contexts` is only live while the current context is in that list; otherwise it reads as released.

```ts
const input = new Input({
  element: canvas,
  actionMap: {
    version: 1,
    actions: {
      jump: { type: 'button', contexts: ['gameplay'], bindings: [{ device: 'key', code: 'Space' }, { device: 'gamepad', button: 0 }] },
      move: { type: 'axis2d', contexts: ['gameplay'], bindings: [
        { device: 'key', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
        { device: 'gamepad', stick: 'left' }, { device: 'touch', control: 'move' } ] },
    },
  },
});
input.touch.addStick(new VirtualStick('move', 0, 0, 300, innerHeight));
function frame() {
  input.update();
  if (input.action('jump').justPressed) player.jump();
  const m = input.axis2('move');
  player.move(m.x, m.y);
}
input.setContext('ui');                      // pause menu
input.rebind('jump', [{ device: 'key', code: 'KeyJ' }]);
```

Gamepads: `input.gamepads.onConnect/onDisconnect = (index, id) => ...`. Standard mapping, radial deadzone with rescale.
Touch: `VirtualStick(id, left, top, width, height, radius=60, deadzone=0.1)`, `VirtualButton(id, left, top, width, height)`.

### Preventing browser defaults (opt-in)

`preventDefaultKeys?: string[] | boolean` (default off). Pass `KeyboardEvent.code` values (e.g. `['Space','ArrowUp','ArrowDown']`)
and `Input` calls `preventDefault()` on `keydown` for them (stops page scrolling). `true` means every key bound in the action
map (incl. composite `negative/positive/up/down/left/right` keys) and follows `define/rebind/addBinding/removeBinding/resetBindings`;
bound keys are collected regardless of context. Change later with `input.setPreventDefaultKeys(v)`. Lookup is a `Set.has`; no per-frame allocation.

### Absolute pointer and touches

```ts
class PointerState { active: boolean; source: 'none'|'mouse'|'touch'; x: number; y: number; nx: number; ny: number }
input.pointer;        // most recently used of mouse/touch; px relative to `element` (viewport if none), nx/ny = 0..1 (not clamped)
input.mouse.pointer;  // mouse only (active after first mousemove over the element)
input.touch.pointer;  // most recent live touch
input.touch.touches;  // TouchPoint[10] pool, never reallocated: { active, id, x, y, nx, ny, clientX, clientY }
input.touch.touchCount; input.touch.getTouch(id): TouchPoint | null;
for (const t of input.touch.touches) if (t.active) aim(t.nx, t.ny);
```

Positions are written in event handlers into preallocated objects; `Input.update` only copies fields. (`getBoundingClientRect`
is called per event, a browser-side allocation.) Note: there is no type named `InputState`; the `Input` class itself carries `pointer`.

`VirtualStick` absolute mode: `stick.setAbsolute(true, anchorX?, anchorY?)` (client px; anchor defaults to the centre of the hit
region). Instead of measuring from where the touch began, deflection is measured from the fixed anchor, so touching the
stick at its edge immediately gives that deflection. Fields: `absolute`, `anchorX`, `anchorY`. Default stays relative.

Action map JSON Schema (versioned, `version: 1`): [`action-map.schema.json`](./action-map.schema.json), also exported as
`@jurfi/input/action-map.schema.json`. Regenerate with `pnpm --filter @jurfi/input schema` (a test checks it stays in sync).
`validateActionMap(json): string[]` gives runtime errors.

## @jurfi/audio

```ts
type BusName = 'master' | 'sfx' | 'music' | 'ui';
class AudioEngine {
  constructor(opts?: AudioEngineOptions);    // { createContext, muted, search, gestureTarget, maxVoices=32, createMediaElement, fetch }
  readonly context: AudioContext; readonly music: MusicPlayer; readonly voices: Voice[];
  resume(): Promise<void>;                   // auto-called on first pointerdown/keydown/touchend/mousedown
  bus(name: BusName): GainNode;
  setBusVolume(name: BusName, v: number): void; getBusVolume(name): number;
  setMuted(m: boolean): void; readonly isMuted: boolean;   // muted by default when URL has ?test=1
  registerBuffer(id: string, b: AudioBuffer): void; getBuffer(id): AudioBuffer | undefined;
  loadBuffer(id: string, url: string): Promise<AudioBuffer>;   // cached by asset id, de-duplicated
  releaseBuffer(id: string): void;
  syncListener(t: { position: Vec3Like; forward: Vec3Like; up: Vec3Like }): void;
  createEmitter(opts?: SpatialOptions): SpatialEmitter;
  play(assetId: string, opts?: PlayOptions): Voice | null;
  playTone(opts?: ToneOptions): Voice | null;   // synthesized OscillatorNode tone
  readonly activeVoices: number;
  stopAll(fade?: number): void; dispose(): void;
}
interface PlayOptions { bus?: 'sfx'|'music'|'ui'; volume?: number; loop?: boolean; pitch?: number; fadeIn?: number; priority?: number }
interface SpatialOptions { distanceModel?: 'linear'|'inverse'|'exponential'; refDistance?; maxDistance?; rolloffFactor?;
  coneInnerAngle?; coneOuterAngle?; coneOuterGain?; bus? }
class SpatialEmitter { panner: PannerNode /* HRTF */; setPosition(x,y,z); setPositionFrom(v); setOrientation(x,y,z); play(id, opts?): Voice | null; dispose() }
class Voice { active: boolean; id: number; priority: number; setVolume(v); setPitch(rate); stop(fade?: number) }  // pooled: re-check `active`/`id`
class MusicPlayer { play(url, {loop?, volume?, fadeIn?, pitch?}); pause(); resume(); stop(fadeOut?); setVolume(v); setPitch(r); readonly playing }
function isTestMode(search?: string): boolean;
```

### Tones and muted mode

```ts
interface ToneOptions { frequency?=440; duration?=0.2; type?: OscillatorType='sine'; volume?=1; bus?: 'sfx'|'music'|'ui'='sfx'; fadeOut?=0.02; priority?=0 }
const v = audio.playTone({ frequency: 880, duration: 0.15, type: 'square', volume: 0.3, bus: 'ui', fadeOut: 0.05 });
```

`playTone` creates an `OscillatorNode` into a gain envelope (peak `volume`, linear ramp to 0 over the last `fadeOut` seconds, clamped to
`duration`) connected to the bus, and stops automatically. It uses the same voice pool and stealing rules as `play`, so it returns `null`
when all voices are busy with higher-priority sounds. `voice.setPitch(r)` multiplies the base frequency. Works with the test mock (`MockContext.oscillators`).

**Muted mode still creates an AudioContext.** `?test=1` (or `muted: true`) only sets the master bus gain to 0; the engine still constructs
the `AudioContext`, buses, voices and nodes, and `play`/`playTone` still return voices. Autoplay policy still applies (context stays
`suspended` until a gesture). Pass `createContext` to inject a fake if you must avoid a real context.

Voice limit: when all voices are busy, the lowest-priority voice (oldest on ties) is stolen if its priority is `<=` the new
sound's; otherwise `play` returns `null`.

```ts
const audio = new AudioEngine();
await audio.loadBuffer('step', '/sfx/step.ogg');
audio.setBusVolume('music', 0.6);
audio.music.play('/music/theme.ogg', { fadeIn: 2 });
const e = audio.createEmitter({ refDistance: 2, rolloffFactor: 1.5, coneInnerAngle: 60, coneOuterAngle: 180, coneOuterGain: 0.3 });
e.setPosition(10, 0, -4);
e.play('step', { pitch: 0.9 + Math.random() * 0.2, priority: 1 });
// each frame:
audio.syncListener({ position: cam.position, forward: cam.forward, up: cam.up });
```

## @jurfi/perf

```ts
class Profiler {
  constructor(opts?: { maxSystems=32; now; budgets?: Partial<PerfBudgets>; target?: EventTarget; gpuSource?: () => number | null; heapSource?: () => number | null });
  register(name: string): number;
  beginFrame(): void; begin(system: number | string): void; end(system: number | string): number; endFrame(): PerfFrame;
  on(type: 'perf:frame', fn: (f: PerfFrame) => void): () => void;   // frame object is reused; copy to keep
  dump(): PerfDump; toJSON(): PerfDump; checkBudgets(): BudgetBreach[]; heapGrowth(): HeapGrowth | null; reset(): void;
}
interface PerfFrame { cpuMs: number; gpuMs: number | null; systems: Record<string, number> }
interface PerfDump { schemaVersion: 1; frames: PerfFrame[]; budgets: PerfBudgets }   // last 600 frames, oldest first
interface PerfBudgets { cpuFrameMs: 8; gpuFrameMs: 8; gcSpikeMs: 4; heapGrowthMBPerSec: 1 }  // defaults
interface BudgetBreach { kind: keyof PerfBudgets; value: number; limit: number; frameIndex: number; system?: string }
function checkBudgets(dump: { frames: PerfFrame[]; budgets?: PerfBudgets }, budgets?: PerfBudgets, heap?: HeapGrowth | null): BudgetBreach[];
class GpuTimer { constructor(device); timestampWrites; resolve(encoder): boolean; readback(): Promise<void>; lastMs: number | null }
```

Frames live in typed-array ring buffers. `perf:frame` is emitted via `profiler.on` and, if `target` is given, as a
`CustomEvent('perf:frame', { detail: frame })` (the latter allocates; intended for the editor overlay only).
`gcSpikeMs` is a heuristic: a frame whose `cpuMs` exceeds the dump median by more than the limit. Heap growth uses
`performance.memory` (Chromium) when available.

```ts
const perf = new Profiler({ gpuSource: () => gpuTimer.lastMs });
const physics = perf.register('physics');
function frame() {
  perf.beginFrame();
  perf.begin(physics); stepPhysics(); perf.end(physics);
  perf.endFrame();
}
console.log(JSON.stringify(perf), perf.checkBudgets());
```
