import { ClipPlayer, sampleClip, type Clip } from '@jurfi/anim';
import { createScriptWorld, type World } from '@jurfi/core';
import { clampPos, overlaps, type Aabb } from '@jurfi/physics';
import {
  createBuiltinRegistry,
  createScriptRuntime,
  type GraphDoc,
  type NodeRegistry,
  type ScriptRuntime,
  type ScriptWorld,
} from '@jurfi/script';
import type { EditorWorld } from './world';

export interface PlayLog {
  level: 'info' | 'warn' | 'error';
  message: string;
  source: 'script' | 'anim' | 'physics';
}

export interface PlaySessionOptions {
  world: EditorWorld;
  graph?: () => GraphDoc | null;
  clip?: () => Clip | null;
  registry?: NodeRegistry;
  onLog?: (entry: PlayLog) => void;
  schedule?: (frame: (time: number) => void) => number;
  cancel?: (handle: number) => void;
}

export interface PlaySession {
  play(): void;
  pause(): void;
  stop(): void;
  step(dt?: number): void;
  dispose(): void;
}

const PHYSICS_KEY = 'physics';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scriptWorldFor(world: EditorWorld): ScriptWorld {
  const ecs = (world as { ecs?: World }).ecs;
  if (ecs) return createScriptWorld(ecs, ecs.entities()[0]);
  const selfId = world.entities()[0]?.id ?? 'scene';
  return {
    self: { id: selfId },
    getComponent(entity, component) {
      return world.get(String(entity.id))?.components[component];
    },
    setComponent(entity, component, value) {
      const id = String(entity.id);
      const current = world.get(id);
      if (!current) return;
      world.update(id, { components: { ...current.components, [component]: value } });
    },
    hasComponent(entity, component) {
      const value = world.get(String(entity.id))?.components[component];
      return value !== undefined;
    },
    getField(entity, component, field) {
      const value = world.get(String(entity.id))?.components[component];
      return isRecord(value) ? value[field] : undefined;
    },
    setField(entity, component, field, value) {
      const id = String(entity.id);
      const current = world.get(id);
      if (!current) return;
      const bag = current.components[component];
      const next = isRecord(bag) ? { ...bag, [field]: value } : { [field]: value };
      world.update(id, { components: { ...current.components, [component]: next } });
    },
  };
}

function readAabb(components: Record<string, unknown>): Aabb | null {
  const raw = components[PHYSICS_KEY];
  if (!isRecord(raw)) return null;
  const x = raw.x;
  const y = raw.y;
  const w = raw.w;
  const h = raw.h;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') return null;
  return { x, y, w, h };
}

/**
 * Separate overlapping `components.physics` boxes along X.
 * `@jurfi/physics` exposes `overlaps` and `clampPos` only, so this is the whole step.
 */
function stepPhysics(world: EditorWorld): void {
  const bodies: { id: string; box: Aabb; components: Record<string, unknown> }[] = [];
  for (const entity of world.entities()) {
    const box = readAabb(entity.components);
    if (box) bodies.push({ id: entity.id, box, components: entity.components });
  }
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const a = bodies[i];
      const b = bodies[j];
      if (!a || !b || !overlaps(a.box, b.box)) continue;
      const push = a.box.x + a.box.w - b.box.x;
      b.box = { ...b.box, x: clampPos(b.box.x + push, -10_000, 10_000) };
    }
  }
  for (const body of bodies) {
    world.update(body.id, {
      components: { ...body.components, [PHYSICS_KEY]: { ...body.box } },
    });
  }
}

function applyChannel(current: unknown, channel: number, value: unknown): unknown {
  if (Array.isArray(current)) {
    const next = current.slice();
    next[channel] = value;
    return next;
  }
  if (isRecord(current)) {
    const key = (['x', 'y', 'z', 'w'] as const)[channel];
    if (!key) return current;
    return { ...current, [key]: value };
  }
  const next: unknown[] = [];
  next[channel] = value;
  return next;
}

function applyClip(world: EditorWorld, clip: Clip, time: number): void {
  sampleClip(clip, time, (target, value) => {
    const entity = world.get(target.entity);
    if (!entity) return;
    const components = { ...entity.components };
    const bag = components[target.component];
    const record = isRecord(bag) ? { ...bag } : {};
    record[target.prop] = target.channel === undefined ? value : applyChannel(record[target.prop], target.channel, value);
    components[target.component] = record;
    world.update(entity.id, { components });
  });
}

function browserSchedule(frame: (time: number) => void): number {
  if (typeof requestAnimationFrame !== 'function') return 0;
  return requestAnimationFrame(frame);
}

function browserCancel(handle: number): void {
  if (typeof cancelAnimationFrame === 'function' && handle !== 0) cancelAnimationFrame(handle);
}

export function createPlaySession(options: PlaySessionOptions): PlaySession {
  const graph = options.graph ?? (() => null);
  const clipOf = options.clip ?? (() => null);
  const schedule = options.schedule ?? browserSchedule;
  const cancel = options.cancel ?? browserCancel;
  let runtime: ScriptRuntime | undefined;
  let player: ClipPlayer | undefined;
  let playing = false;
  let handle = 0;
  let lastTime: number | undefined;

  const log = (entry: PlayLog): void => {
    options.onLog?.(entry);
  };

  const ensureRuntime = (): ScriptRuntime => {
    runtime ??= createScriptRuntime({
      world: scriptWorldFor(options.world),
      registry: options.registry ?? createBuiltinRegistry(),
      onNodeError(fault) {
        log({ level: 'error', message: `${fault.nodeId}: ${fault.message}`, source: 'script' });
      },
    });
    return runtime;
  };

  const boot = (): void => {
    const doc = graph();
    if (doc) {
      const loaded = ensureRuntime().load(doc);
      if (!loaded.ok) {
        const message = loaded.diagnostics[0]?.message ?? 'Graph did not compile';
        log({ level: 'error', message, source: 'script' });
      } else {
        ensureRuntime().start();
      }
    }
    const clip = clipOf();
    player = clip ? new ClipPlayer(clip) : undefined;
    player?.play();
  };

  const simulate = (dt: number): void => {
    if (runtime?.running) runtime.tick(dt);
    if (player) {
      player.update(dt);
      const clip = clipOf();
      if (clip) applyClip(options.world, clip, player.time);
    }
    stepPhysics(options.world);
  };

  const frame = (time: number): void => {
    if (!playing) return;
    const dt = lastTime === undefined ? 0 : Math.min(0.1, (time - lastTime) / 1000);
    lastTime = time;
    if (dt > 0) simulate(dt);
    handle = schedule(frame);
  };

  const cancelFrame = (): void => {
    if (handle !== 0) cancel(handle);
    handle = 0;
    lastTime = undefined;
  };

  return {
    play() {
      if (playing) {
        runtime?.resume();
        player?.play();
        if (handle === 0) handle = schedule(frame);
        return;
      }
      playing = true;
      boot();
      handle = schedule(frame);
    },
    pause() {
      playing = false;
      cancelFrame();
      runtime?.pause();
      player?.pause();
    },
    stop() {
      playing = false;
      cancelFrame();
      runtime?.stop();
      player = undefined;
    },
    step(dt = 1 / 60) {
      if (!runtime?.running && !player) boot();
      runtime?.resume();
      player?.play();
      simulate(dt);
      runtime?.pause();
      player?.pause();
      playing = false;
      cancelFrame();
    },
    dispose() {
      playing = false;
      cancelFrame();
      runtime?.dispose();
      runtime = undefined;
      player = undefined;
    },
  };
}
