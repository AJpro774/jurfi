import { ClipPlayer, sampleClip, type Clip } from '@jurfi/anim';
import { World, createScriptWorld } from '@jurfi/core';
import { DEFAULT_FIXED_DT, DEFAULT_GRAVITY, PhysicsWorld } from '@jurfi/physics';
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
  step(dt?: number): Promise<void>;
  dispose(): void;
}

type PhysicsSim = Awaited<ReturnType<typeof PhysicsWorld.create>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coreWorld(world: EditorWorld): World | null {
  if (!('ecs' in world)) return null;
  const ecs = (world as { ecs?: unknown }).ecs;
  return ecs instanceof World ? ecs : null;
}

function scriptWorldFor(world: EditorWorld): ScriptWorld {
  const ecs = coreWorld(world);
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
  let disposed = false;
  let handle = 0;
  let lastTime: number | undefined;
  let physics: PhysicsSim | null = null;
  let pending: Promise<PhysicsSim | null> | null = null;
  let generation = 0;
  let missingLogged = false;
  let tail: Promise<void> = Promise.resolve();

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

  const releasePhysics = (): void => {
    generation += 1;
    const current = physics;
    physics = null;
    pending = null;
    current?.destroy();
  };

  const ensurePhysics = (): Promise<PhysicsSim | null> => {
    if (disposed) return Promise.resolve(null);
    const ecs = coreWorld(options.world);
    if (!ecs) {
      if (!missingLogged) {
        missingLogged = true;
        log({ level: 'warn', message: 'Physics needs a core ECS world', source: 'physics' });
      }
      return Promise.resolve(null);
    }
    if (physics) return Promise.resolve(physics);
    if (pending) return pending;
    const ticket = generation;
    const loading = PhysicsWorld.create({ gravity: DEFAULT_GRAVITY, fixedDt: DEFAULT_FIXED_DT })
      .then((created) => {
        if (pending === loading) pending = null;
        if (ticket !== generation || disposed) {
          created.destroy();
          return null;
        }
        const bound = coreWorld(options.world);
        if (!bound) {
          created.destroy();
          return null;
        }
        created.attach(bound);
        physics = created;
        return created;
      })
      .catch((error: unknown) => {
        if (pending === loading) pending = null;
        const message = error instanceof Error ? error.message : 'Physics world failed to start';
        log({ level: 'error', message, source: 'physics' });
        return null;
      });
    pending = loading;
    return loading;
  };

  const simulate = async (dt: number, ticket: number): Promise<void> => {
    if (ticket !== generation || disposed) return;
    if (runtime?.running) runtime.tick(dt);
    if (player) {
      player.update(dt);
      const clip = clipOf();
      if (clip) applyClip(options.world, clip, player.time);
    }
    if (ticket !== generation || disposed) return;
    const ecs = coreWorld(options.world);
    if (!ecs) {
      if (!missingLogged) {
        missingLogged = true;
        log({ level: 'warn', message: 'Physics needs a core ECS world', source: 'physics' });
      }
      return;
    }
    const sim = await ensurePhysics();
    if (!sim || ticket !== generation || disposed) return;
    ecs.time.tick(dt);
    if (ticket !== generation || disposed) return;
    sim.step(ecs.time.delta);
  };

  const enqueue = (dt: number): Promise<void> => {
    const ticket = generation;
    const run = tail.then(() => simulate(dt, ticket));
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const frame = (time: number): void => {
    if (!playing) return;
    const dt = lastTime === undefined ? 0 : Math.min(0.1, (time - lastTime) / 1000);
    lastTime = time;
    if (dt <= 0) {
      handle = schedule(frame);
      return;
    }
    void enqueue(dt).then(
      () => {
        if (playing) handle = schedule(frame);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Physics step failed';
        log({ level: 'error', message, source: 'physics' });
        if (playing) handle = schedule(frame);
      },
    );
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
      void ensurePhysics();
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
      releasePhysics();
    },
    step(dt = DEFAULT_FIXED_DT) {
      if (!runtime?.running && !player) boot();
      runtime?.resume();
      player?.play();
      playing = false;
      cancelFrame();
      return enqueue(dt).finally(() => {
        runtime?.pause();
        player?.pause();
      });
    },
    dispose() {
      disposed = true;
      playing = false;
      cancelFrame();
      runtime?.dispose();
      runtime = undefined;
      player = undefined;
      releasePhysics();
    },
  };
}
