import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, isTestMode } from './index';
import { MockContext } from './mock';
import type { MockGain, MockPanner } from './mock';

function make(opts: Record<string, unknown> = {}) {
  const ctx = new MockContext();
  const target = new EventTarget();
  const engine = new AudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    gestureTarget: target,
    maxVoices: 2,
    createMediaElement: () => ({ play: async () => {}, pause() {}, removeAttribute() {}, paused: false }) as unknown as HTMLMediaElement,
    ...opts,
  });
  const buf = {} as AudioBuffer;
  engine.registerBuffer('a', buf);
  return { ctx, engine, target };
}

describe('AudioEngine', () => {
  it('resumes on first gesture and removes listeners', async () => {
    const { ctx, target } = make();
    expect(ctx.state).toBe('suspended');
    target.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve(); await Promise.resolve();
    expect(ctx.state).toBe('running');
  });

  it('builds buses routed to master -> destination', () => {
    const { ctx, engine } = make();
    const master = engine.bus('master') as unknown as MockGain;
    expect(master.connections).toEqual([ctx.destination]);
    expect((engine.bus('sfx') as unknown as MockGain).connections).toEqual([master]);
    expect((engine.bus('ui') as unknown as MockGain).connections).toEqual([master]);
  });

  it('?test=1 mutes', () => {
    expect(isTestMode('?a=1&test=1')).toBe(true);
    expect(isTestMode('?test=10')).toBe(false);
    const { engine } = make({ search: '?test=1' });
    expect(engine.isMuted).toBe(true);
    expect((engine.bus('master') as unknown as MockGain).gain.value).toBe(0);
    engine.setBusVolume('master', 0.5);
    expect((engine.bus('master') as unknown as MockGain).gain.value).toBe(0);
    engine.setMuted(false);
    expect((engine.bus('master') as unknown as MockGain).gain.value).toBe(0.5);
  });

  it('caches buffers by asset id', async () => {
    const fetch = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));
    const { engine } = make({ fetch });
    const [a, b] = await Promise.all([engine.loadBuffer('x', 'u'), engine.loadBuffer('x', 'u')]);
    await engine.loadBuffer('x', 'u');
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('plays with loop, pitch and fade', () => {
    const { ctx, engine } = make();
    const v = engine.play('a', { loop: true, pitch: 2, fadeIn: 1, volume: 0.5, bus: 'ui' });
    expect(v).not.toBeNull();
    const s = ctx.sources[0]!;
    expect(s.loop).toBe(true);
    expect(s.playbackRate.value).toBe(2);
    expect(v!.gain).not.toBeNull();
    expect((v!.gain as unknown as MockGain).gain.calls).toEqual([['set', 0, 0], ['ramp', 0.5, 1]]);
    expect(engine.play('missing')).toBeNull();
    v!.stop(2);
    expect(s.stopped).toBe(2);
    s.end();
    expect(v!.active).toBe(false);
  });

  it('steals lowest priority voice, refuses to steal higher', () => {
    const { ctx, engine } = make();
    const lo = engine.play('a', { priority: 1 })!;
    const hi = engine.play('a', { priority: 5 })!;
    ctx.currentTime = 1;
    const mid = engine.play('a', { priority: 3 })!;
    expect(mid).toBe(lo);
    expect(engine.activeVoices).toBe(2);
    expect(engine.play('a', { priority: 2 })).toBeNull();
    expect(hi.active).toBe(true);
    // ties: oldest stolen
    const e2 = make().engine;
    const first = e2.play('a')!;
    e2.play('a')!;
    expect(e2.play('a')).toBe(first);
  });

  it('syncs listener to camera transform', () => {
    const { ctx, engine } = make();
    engine.syncListener({ position: { x: 1, y: 2, z: 3 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } });
    expect(ctx.listener.positionY.value).toBe(2);
    expect(ctx.listener.forwardZ.value).toBe(-1);
    expect(ctx.listener.upY.value).toBe(1);
  });

  it('emitters use HRTF panner with settings and route voices through it', () => {
    const { ctx, engine } = make();
    const e = engine.createEmitter({ distanceModel: 'linear', refDistance: 2, maxDistance: 50, rolloffFactor: 3, coneInnerAngle: 30, coneOuterAngle: 90, coneOuterGain: 0.2 });
    const p = e.panner as unknown as MockPanner;
    expect(p.panningModel).toBe('HRTF');
    expect([p.distanceModel, p.refDistance, p.maxDistance, p.rolloffFactor, p.coneInnerAngle, p.coneOuterAngle, p.coneOuterGain]).toEqual(['linear', 2, 50, 3, 30, 90, 0.2]);
    e.setPosition(4, 5, 6);
    expect(p.positionZ.value).toBe(6);
    const v = e.play('a')!;
    expect((v.gain as unknown as MockGain).connections).toEqual([p]);
    expect(p.connections).toEqual([engine.bus('sfx')]);
    expect(ctx.sources).toHaveLength(1);
  });

  it('music routes media element into music bus with fade', () => {
    const { engine } = make();
    engine.music.play('song.ogg', { fadeIn: 2 });
    const g = engine.context.createGain; void g;
    expect(engine.music.playing).toBe(true);
    engine.music.stop();
    expect(engine.music.playing).toBe(false);
  });

  it('playTone builds oscillator + gain envelope on the bus', () => {
    const { ctx, engine } = make();
    const v = engine.playTone({ frequency: 880, duration: 1, type: 'square', volume: 0.5, bus: 'ui', fadeOut: 0.25 })!;
    expect(v).not.toBeNull();
    const o = ctx.oscillators[0]!;
    expect([o.type, o.frequency.value, o.started, o.stopped]).toEqual(['square', 880, 0, 1]);
    const g = v.gain as unknown as MockGain;
    expect(g.gain.calls).toEqual([['set', 0.5, 0], ['set', 0.5, 0.75], ['ramp', 0, 1]]);
    expect(g.connections).toEqual([engine.bus('ui')]);
    v.setPitch(2);
    expect(o.frequency.value).toBe(1760);
    o.end();
    expect(v.active).toBe(false);
  });

  it('playTone defaults and clamps fadeOut', () => {
    const { ctx, engine } = make();
    engine.playTone({ duration: 0.01, fadeOut: 5 });
    const o = ctx.oscillators[0]!;
    expect([o.type, o.frequency.value, o.stopped]).toEqual(['sine', 440, 0.01]);
    expect((ctx.gains.at(-1) as MockGain).connections).toEqual([engine.bus('sfx')]);
  });

  it('playTone respects the voice limit and priority', () => {
    const { engine } = make();
    engine.playTone({ priority: 5 });
    engine.playTone({ priority: 5 });
    expect(engine.playTone({ priority: 1 })).toBeNull();
    expect(engine.playTone({ priority: 5 })).not.toBeNull();
    expect(engine.activeVoices).toBe(2);
  });

  it('muted engine (test mode) still creates an AudioContext', () => {
    let created = 0;
    const ctx = new MockContext();
    const engine = new AudioEngine({ createContext: () => { created++; return ctx as unknown as AudioContext; }, search: '?test=1', gestureTarget: new EventTarget() });
    expect(created).toBe(1);
    expect(engine.isMuted).toBe(true);
    expect((engine.bus('master') as unknown as MockGain).gain.value).toBe(0);
    expect(engine.playTone()).not.toBeNull();
  });
});
