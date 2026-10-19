import { describe, expect, it } from 'vitest';
import { easeInOut, lerp } from './easing';
import {
  addKey,
  addTrack,
  ClipPlayer,
  moveKey,
  removeKey,
  sampleClip,
  sampleTrack,
  setInterp,
  sortKeys,
  stripEditorData,
  validateClip,
} from './index';
import type { Clip, ClipEvent, Key, Track } from './index';

function target(prop = 'position', channel?: number, component = 'transform') {
  return { entity: 'hero', component, prop, ...(channel === undefined ? {} : { channel }) };
}

function key(t: number, v: Key['v'], interp: Key['interp'] = 'linear', extra: Partial<Key> = {}): Key {
  return { t, v, interp, ...extra };
}

function track(partial: Partial<Track> & Pick<Track, 'keys'>): Track {
  return {
    id: partial.id ?? 'track',
    target: partial.target ?? target(),
    type: partial.type,
    keys: partial.keys,
  };
}

function make(partial: Partial<Clip> = {}, tracks: Track[] = []): Clip {
  return {
    version: 1,
    id: 'clip',
    name: 'Walk',
    duration: 1,
    fps: 60,
    loop: false,
    tracks,
    ...partial,
  };
}

const seamEvents: ClipEvent[] = [
  { t: 0, name: 'start' },
  { t: 0.25, name: 'a', data: { n: 1 } },
  { t: 0.75, name: 'b' },
  { t: 1, name: 'end' },
];

describe('easing', () => {
  it('keeps the scalar helpers', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(1)).toBe(1);
  });
});

describe('sampleTrack', () => {
  it('clamps outside the first and last keys and returns copies of vectors', () => {
    const pos = track({
      type: 'vec',
      keys: [key(0.25, [1, 2]), key(0.75, [3, 4])],
    });
    expect(sampleTrack(pos, -10)).toEqual([1, 2]);
    expect(sampleTrack(pos, 0)).toEqual([1, 2]);
    expect(sampleTrack(pos, 0.25)).toEqual([1, 2]);
    expect(sampleTrack(pos, 2)).toEqual([3, 4]);
    const sampled = sampleTrack(pos, 0.25) as number[];
    sampled[0] = 99;
    expect(pos.keys[0]?.v).toEqual([1, 2]);
    expect(sampleTrack(track({ keys: [] }), 0)).toBeUndefined();
  });

  it('holds a single key at every time', () => {
    expect(sampleTrack(track({ type: 'number', keys: [key(0.5, 7, 'step')] }), 0)).toBe(7);
    expect(sampleTrack(track({ type: 'number', keys: [key(0.5, 7, 'step')] }), 5)).toBe(7);
  });

  it('steps until the next key, using the left key interp', () => {
    const stepped = track({
      type: 'number',
      keys: [key(0, 1, 'step'), key(1, 5, 'linear'), key(2, 9, 'step')],
    });
    expect(sampleTrack(stepped, 0.99)).toBe(1);
    expect(sampleTrack(stepped, 1)).toBe(5);
    expect(sampleTrack(stepped, 1.5)).toBe(7);
  });

  it('lerps scalar channels and whole vectors, including color', () => {
    const x = track({ id: 'x', type: 'number', target: target('position', 0), keys: [key(0, 0), key(1, 10)] });
    const y = track({ id: 'y', type: 'number', target: target('position', 1), keys: [key(0, 10), key(1, 30)] });
    const vec = track({ id: 'v', type: 'vec', keys: [key(0, [0, 10]), key(1, [10, 30])] });
    const color = track({
      id: 'c',
      type: 'color',
      target: target('color', undefined, 'material'),
      keys: [key(0, [1, 0, 0, 1]), key(1, [0, 1, 0, 1])],
    });
    expect(sampleTrack(x, 0.5)).toBe(5);
    expect(sampleTrack(y, 0.5)).toBe(20);
    expect(sampleTrack(vec, 0.5)).toEqual([5, 20]);
    expect(sampleTrack(color, 0.5)).toEqual([0.5, 0.5, 0, 1]);
    // A 4-vector is not a quaternion unless type is quat.
    const vec4 = track({ type: 'vec', keys: [key(0, [1, 0, 0, 1]), key(1, [0, 1, 0, 1])] });
    expect(sampleTrack(vec4, 0.5)).toEqual([0.5, 0.5, 0, 1]);
  });

  it('slerps quaternions on the shortest path', () => {
    const s2 = Math.SQRT1_2;
    const q0 = [0, 0, 0, 1];
    const q90 = [0, s2, 0, s2];
    const quat = track({ type: 'quat', keys: [key(0, q0), key(1, q90)] });
    expect(sampleTrack(quat, 0)).toEqual(q0);
    expect(sampleTrack(quat, 1)).toEqual(q90);
    const mid = sampleTrack(quat, 0.5) as number[];
    expect(mid[0]).toBeCloseTo(0, 6);
    expect(mid[1]).toBeCloseTo(Math.sin(Math.PI / 8), 6);
    expect(mid[2]).toBeCloseTo(0, 6);
    expect(mid[3]).toBeCloseTo(Math.cos(Math.PI / 8), 6);

    const quarter = sampleTrack(quat, 0.25) as number[];
    expect(quarter[1]).toBeCloseTo(Math.sin(Math.PI / 16), 6);
    expect(quarter[3]).toBeCloseTo(Math.cos(Math.PI / 16), 6);
    const nY = 0.25 * s2;
    const nW = 1 + 0.25 * (s2 - 1);
    const nLen = Math.hypot(nY, nW);
    expect(Math.abs((quarter[1] ?? 0) - nY / nLen)).toBeGreaterThan(1e-3);

    const longWay = track({ type: 'quat', keys: [key(0, q0), key(1, [0, -s2, 0, -s2])] });
    const other = sampleTrack(longWay, 0.5) as number[];
    const dot = (mid[0] ?? 0) * (other[0] ?? 0) + (mid[1] ?? 0) * (other[1] ?? 0) + (mid[2] ?? 0) * (other[2] ?? 0) + (mid[3] ?? 0) * (other[3] ?? 0);
    expect(dot).toBeGreaterThan(0.999);

    // A single quat channel is a scalar, not a slerp.
    const w = track({ type: 'quat', target: target('rotation', 3), keys: [key(0, 0), key(1, 1)] });
    expect(sampleTrack(w, 0.5)).toBe(0.5);
  });

  it('bezier without tangents matches linear, and tangents are hermite control offsets', () => {
    const bare = track({
      type: 'number',
      keys: [key(0, 0, 'bezier'), key(1, 10, 'linear')],
    });
    expect(sampleTrack(bare, 0.3)).toBeCloseTo(3, 8);

    // Zero slopes: smoothstep. u = 0.25 → 0.15625.
    const smooth = track({
      type: 'number',
      keys: [
        key(0, 0, 'bezier', { outTan: { dt: 1 / 3, dv: 0 } }),
        key(1, 1, 'linear', { inTan: { dt: -1 / 3, dv: 0 } }),
      ],
    });
    expect(sampleTrack(smooth, 0)).toBe(0);
    expect(sampleTrack(smooth, 1)).toBe(1);
    expect(sampleTrack(smooth, 0.25)).toBeCloseTo(0.15625, 8);

    // Flat values, non-zero slopes. dv is the control offset, time stays uniform.
    const bowed = track({
      type: 'number',
      keys: [
        key(0, 0, 'bezier', { outTan: { dt: 1 / 3, dv: 1 } }),
        key(1, 0, 'linear', { inTan: { dt: -1 / 3, dv: -1 } }),
      ],
    });
    expect(sampleTrack(bowed, 0.25)).toBeCloseTo(0.28125, 8);
    expect(sampleTrack(bowed, 0.5)).toBeCloseTo(0, 8);

    // Non-uniform time controls. At u=0.25 the bezier time is 0.296875 and the value is 0.15625.
    const timed = track({
      type: 'number',
      keys: [
        key(0, 0, 'bezier', { outTan: { dt: 0.5, dv: 0 } }),
        key(1, 1, 'linear', { inTan: { dt: -0.5, dv: 0 } }),
      ],
    });
    expect(sampleTrack(timed, 0.296875)).toBeCloseTo(0.15625, 5);
  });

  it('bool and string tracks always step', () => {
    const flag = track({ type: 'bool', keys: [key(0, false, 'linear'), key(1, true, 'bezier')] });
    const label = track({ type: 'string', keys: [key(0, 'off', 'linear'), key(1, 'on', 'linear')] });
    expect(sampleTrack(flag, 0.9)).toBe(false);
    expect(sampleTrack(flag, 1)).toBe(true);
    expect(sampleTrack(label, 0.9)).toBe('off');
    const untyped = track({ keys: [key(0, false, 'linear'), key(1, true, 'linear')] });
    expect(sampleTrack(untyped, 0.9)).toBe(false);
  });
});

describe('sampleClip', () => {
  it('applies in track order and returns a map keyed by track id', () => {
    const clip = make({}, [
      track({ id: 'x', type: 'number', target: target('position', 0), keys: [key(0, 0), key(1, 10)] }),
      track({ id: 'empty', type: 'number', keys: [] }),
      track({ id: 'y', type: 'number', target: target('position', 1), keys: [key(0, 2), key(1, 4)] }),
    ]);
    const seen: Array<[string, number]> = [];
    sampleClip(clip, 0.5, (tgt, value) => {
      seen.push([`${tgt.prop}:${tgt.channel}`, value as number]);
    });
    expect(seen).toEqual([
      ['position:0', 5],
      ['position:1', 3],
    ]);
    const map = sampleClip(clip, 0.5);
    expect([...map.keys()]).toEqual(['x', 'y']);
    expect(map.get('x')).toEqual({ target: clip.tracks[0]?.target, value: 5 });
    expect(map.get('y')?.value).toBe(3);
  });
});

describe('ClipPlayer', () => {
  function player(partial: Partial<Clip> = {}, time = 0) {
    const clip = make({ events: seamEvents, ...partial });
    const p = new ClipPlayer(clip);
    p.time = time;
    p.play();
    return p;
  }

  it('plays once, clamps, and does not wrap', () => {
    const p = player({}, 0.5);
    expect(p.update(1).map((e) => e.name)).toEqual(['b', 'end']);
    expect(p.time).toBe(1);
    expect(p.playing).toBe(false);
    const times: number[] = [];
    p.onTime((t) => times.push(t));
    expect(p.update(1)).toEqual([]);
    expect(times).toEqual([]);
    expect(p.time).toBe(1);
  });

  it('does not fire an event the playhead is already on', () => {
    const p = player();
    expect(p.update(0.5).map((e) => e.name)).toEqual(['a']);
    expect(p.time).toBe(0.5);
    expect(p.update(1).map((e) => e.name)).toEqual(['b', 'end']);
    expect(p.playing).toBe(false);
    expect(p.time).toBe(1);
  });

  it('fires loop wraps in order, including a full cycle back to the start', () => {
    const p = player({ loop: true }, 0.5);
    expect(p.update(2).map((e) => e.name)).toEqual(['b', 'end', 'start', 'a', 'b', 'end', 'start', 'a']);
    expect(p.time).toBeCloseTo(0.5, 8);
    expect(p.playing).toBe(true);
    const seen: number[] = [];
    p.onEvent(() => seen.push(p.time));
    p.onTime((t) => seen.push(t));
    p.time = 0;
    p.update(0.25);
    // Crossing callback observes the event time, then onTime observes the final time.
    expect(seen).toEqual([0.25, 0.25]);
  });

  it('defaults loopMode to wrap and honors pingpong', () => {
    const wrapping = player({ loop: true });
    wrapping.update(1.25);
    expect(wrapping.time).toBeCloseTo(0.25, 8);

    const bouncing = player({ loop: true, loopMode: 'pingpong' });
    bouncing.update(1.25);
    expect(bouncing.time).toBeCloseTo(0.75, 8);

    const overridden = new ClipPlayer(make({ loop: false, events: seamEvents }), { loop: true, loopMode: 'pingpong' });
    overridden.play();
    overridden.update(1.25);
    expect(overridden.time).toBeCloseTo(0.75, 8);
  });

  it('ping-pongs without firing the endpoint twice, and keeps direction across updates', () => {
    const p = player({ loop: true, loopMode: 'pingpong' }, 0.5);
    expect(p.update(1).map((e) => e.name)).toEqual(['b', 'end', 'b']);
    expect(p.time).toBeCloseTo(0.5, 8);
    expect(p.update(0.5).map((e) => e.name)).toEqual(['a', 'start']);
    expect(p.time).toBeCloseTo(0, 8);
    expect(p.playing).toBe(true);
    p.update(0.25);
    expect(p.time).toBeCloseTo(0.25, 8);
  });

  it('fires reverse playback, including the loop seam', () => {
    const once = player({}, 0.25);
    once.speed = -1;
    expect(once.update(1).map((e) => e.name)).toEqual(['start']);
    expect(once.time).toBe(0);
    expect(once.playing).toBe(false);

    const looped = player({ loop: true }, 0.5);
    looped.speed = -1;
    expect(looped.update(1.5).map((e) => e.name)).toEqual(['a', 'start', 'end', 'b', 'a', 'start', 'end']);
    expect(looped.time).toBeCloseTo(1, 8);

    const fromStart = player({ loop: true });
    fromStart.speed = -1;
    expect(fromStart.update(1).map((e) => e.name)).toEqual(['b', 'a', 'start', 'end']);
    expect(fromStart.time).toBeCloseTo(1, 8);

    const lap = player({ loop: true });
    expect(lap.update(1).map((e) => e.name)).toEqual(['a', 'b', 'end', 'start']);
    expect(lap.time).toBeCloseTo(0, 8);
    expect(lap.playing).toBe(true);
  });

  it('orders same-time events with the clip going forward and against it going backward', () => {
    const clip = make({
      events: [
        { t: 0.5, name: 'a' },
        { t: 0.5, name: 'b' },
      ],
    });
    const forward = new ClipPlayer(clip);
    forward.play();
    expect(forward.update(0.5).map((e) => e.name)).toEqual(['a', 'b']);
    const backward = new ClipPlayer(clip);
    backward.time = 1;
    backward.speed = -1;
    backward.play();
    expect(backward.update(0.5).map((e) => e.name)).toEqual(['b', 'a']);
  });

  it('passes event payloads and scales by speed', () => {
    const p = player();
    p.speed = 2;
    const fired = p.update(0.125);
    expect(fired.map((e) => e.name)).toEqual(['a']);
    expect(fired[0]?.data).toEqual({ n: 1 });
    expect(p.time).toBeCloseTo(0.25, 8);
  });

  it('seek jumps without events unless fire is set, and does not wrap', () => {
    const p = player();
    const heard: string[] = [];
    const times: number[] = [];
    p.onEvent((e) => heard.push(e.name));
    p.onTime((t) => times.push(t));
    expect(p.seek(0.8)).toEqual([]);
    expect(heard).toEqual([]);
    expect(p.time).toBe(0.8);
    expect(p.seek(1, { fire: true }).map((e) => e.name)).toEqual(['end']);
    expect(heard).toEqual(['end']);
    expect(p.seek(0.1, { fire: true }).map((e) => e.name)).toEqual(['b', 'a']);
    expect(heard).toEqual(['end', 'b', 'a']);
    expect(p.time).toBe(0.1);
    expect(p.seek(-5)).toEqual([]);
    expect(p.time).toBe(0);
    expect(p.seek(4)).toEqual([]);
    expect(p.time).toBe(1);
    expect(times[0]).toBe(0.8);
    expect(p.playing).toBe(true);
  });

  it('restarts once-mode playback from the end without firing events', () => {
    const p = player({}, 0.5);
    p.update(1);
    const heard: string[] = [];
    const times: number[] = [];
    p.onEvent((e) => heard.push(e.name));
    p.onTime((t) => times.push(t));
    p.play();
    expect(p.playing).toBe(true);
    expect(p.time).toBe(0);
    expect(heard).toEqual([]);
    expect(times).toEqual([0]);
    expect(p.update(0.25).map((e) => e.name)).toEqual(['a']);
  });

  it('pause holds, stop resets direction, and unsubscribe removes a listener', () => {
    const p = player({ loop: true, loopMode: 'pingpong' }, 0.5);
    p.update(1);
    expect(p.time).toBeCloseTo(0.5, 8);
    p.pause();
    expect(p.update(1)).toEqual([]);
    expect(p.time).toBeCloseTo(0.5, 8);
    p.play();
    p.update(0.25);
    expect(p.time).toBeCloseTo(0.25, 8);

    p.stop();
    expect(p.playing).toBe(false);
    expect(p.time).toBe(0);
    p.time = 0.5;
    p.play();
    p.update(0.25);
    expect(p.time).toBeCloseTo(0.75, 8);

    const heard: string[] = [];
    const off = p.onEvent((e) => heard.push(e.name));
    p.seek(1, { fire: true });
    off();
    p.seek(0, { fire: true });
    expect(heard).toEqual(['end']);
  });

  it('ignores a non-positive dt and a zero speed', () => {
    const p = player({}, 0.25);
    p.update(0);
    p.update(Number.NaN);
    expect(p.time).toBe(0.25);
    p.speed = 0;
    expect(p.update(1)).toEqual([]);
    expect(p.time).toBe(0.25);
    expect(p.playing).toBe(true);
  });
});

describe('mutation helpers', () => {
  function editable(): Clip {
    return make({}, [track({ id: 'x', type: 'number', target: target('position', 0), keys: [key(0, 0), key(1, 10)] })]);
  }

  it('adds, replaces, moves, retimes, and removes keys', () => {
    const clip = editable();
    const inserted = track({ id: 'v', type: 'vec', keys: [key(0, [1, 2, 3])] });
    addTrack(clip, inserted);
    expect(clip.tracks[1]).toBe(inserted);
    const authored = [4, 5, 6];
    addKey(clip, 'v', key(0.5, authored, 'linear'));
    authored[0] = 0;
    expect(clip.tracks[1]?.keys.find((k) => k.t === 0.5)?.v).toEqual([4, 5, 6]);
    expect(() => addTrack(clip, track({ id: 'v', keys: [] }))).toThrow(/already exists/);

    addKey(clip, 'x', key(0.25, 4, 'step'));
    addKey(clip, 'x', key(0.25, 5, 'linear'));
    expect(clip.tracks[0]?.keys.map((k) => k.t)).toEqual([0, 0.25, 1]);
    expect(clip.tracks[0]?.keys[1]?.v).toBe(5);

    moveKey(clip, 'x', 0.25, 0.5);
    expect(clip.tracks[0]?.keys.map((k) => k.t)).toEqual([0, 0.5, 1]);
    expect(() => moveKey(clip, 'x', 0.5, 1)).toThrow(/already exists/);
    expect(() => moveKey(clip, 'x', 0.2, 0.3)).toThrow(/no key/);
    expect(removeKey(clip, 'x', 0.5)).toBe(true);
    expect(removeKey(clip, 'x', 0.5)).toBe(false);
    expect(clip.tracks[0]?.keys).toHaveLength(2);
  });

  it('forces step on discrete tracks and edits tangents', () => {
    const clip = make({}, [track({ id: 'flag', type: 'bool', keys: [key(0, false, 'step')] })]);
    addKey(clip, 'flag', key(1, true, 'bezier'));
    expect(clip.tracks[0]?.keys[1]?.interp).toBe('step');
    setInterp(clip, 'flag', 0, 'linear');
    expect(clip.tracks[0]?.keys[0]?.interp).toBe('step');

    const num = editable();
    setInterp(num, 'x', 0, 'bezier', { outTan: { dt: 1 / 3, dv: 0 }, inTan: { dt: 0, dv: 0 } });
    expect(num.tracks[0]?.keys[0]?.outTan).toEqual({ dt: 1 / 3, dv: 0 });
    setInterp(num, 'x', 0, 'bezier', { outTan: null });
    expect(num.tracks[0]?.keys[0]?.outTan).toBeUndefined();
    expect(num.tracks[0]?.keys[0]?.inTan).toEqual({ dt: 0, dv: 0 });
  });

  it('sorts keys on a track and across a clip', () => {
    const clip = make({}, [
      track({ id: 'a', type: 'number', keys: [key(1, 2), key(0, 1)] }),
      track({ id: 'b', type: 'number', keys: [key(0.5, 1), key(0.25, 0)] }),
    ]);
    expect(validateClip(clip).some((e) => e.includes('not sorted'))).toBe(true);
    sortKeys(clip.tracks[0] as Track);
    sortKeys(clip);
    expect(clip.tracks[0]?.keys.map((k) => k.t)).toEqual([0, 1]);
    expect(clip.tracks[1]?.keys.map((k) => k.t)).toEqual([0.25, 0.5]);
    expect(validateClip(clip)).toEqual([]);
  });

  it('reports structural errors and accepts a valid clip', () => {
    const clip = editable();
    clip.events = seamEvents;
    clip.loopMode = 'pingpong';
    clip.editor = { selection: 'x' };
    expect(validateClip(clip)).toEqual([]);

    const broken = make({
      version: 2 as 1,
      id: '',
      name: '',
      duration: -1,
      fps: 0,
      loop: 'yes' as unknown as boolean,
      loopMode: 'bounce' as unknown as 'loop',
      editor: [] as unknown as Record<string, unknown>,
      events: [{ t: 2, name: '' }],
    }, [
      track({ id: 'x', type: 'quat', keys: [key(0, [1, 0, 0], 'linear'), key(-0.2, [0, 0, 0, 1])] }),
      track({ id: 'x', type: 'bool', target: target('flag', -1, ''), keys: [key(0, 1, 'linear')] }),
      track({ id: '', type: 'nope' as unknown as 'number', keys: [key(Number.NaN, 1, 'smooth' as unknown as 'step')] }),
    ]);
    const errors = validateClip(broken);
    expect(errors).toEqual(expect.arrayContaining([
      'version must be 1',
      'id must be a non-empty string',
      'name must be a non-empty string',
      'duration must be a finite number >= 0',
      'fps must be a finite number > 0',
      'loop must be a boolean',
      'loopMode must be "loop" or "pingpong"',
      'editor must be a plain object',
      'duplicate track id "x"',
      'track "x" key time -0.2 is outside [0, duration]',
      'track "x" keys are not sorted by time',
      'track "x" key 0 value does not match type "quat"',
      'track "x" channel must be an integer >= 0',
      'track "x" target.component must be a non-empty string',
      'track "x" key 0 must use step interpolation',
      'track "x" key 0 value does not match type "bool"',
      'track id must be a non-empty string',
      'track "(missing id)" type "nope" is invalid',
      'track "(missing id)" key 0 time is not finite',
      'event 0 time is outside [0, duration]',
      'event 0 name must be a non-empty string',
    ]));
  });

  it('strips editor data into an independent JSON clone', () => {
    const hook = () => 1;
    const clip = editable();
    clip.editor = { label: 'draft', hook: hook as unknown as never };
    clip.events = [{ t: 0.5, name: 'step', data: { ok: true } }];
    const exported = stripEditorData(clip);
    expect('editor' in exported).toBe(false);
    expect(exported.events).toEqual(clip.events);
    expect(exported).not.toBe(clip);
    const exportedKey = exported.tracks[0]?.keys[0];
    if (exportedKey) exportedKey.v = 99;
    expect(clip.tracks[0]?.keys[0]?.v).toBe(0);
    clip.tracks[0]!.keys[0]!.v = 4;
    expect(exported.tracks[0]?.keys[0]?.v).toBe(99);
    expect(clip.editor?.hook).toBe(hook);
    const round = JSON.parse(JSON.stringify(exported)) as Clip;
    expect(sampleTrack(round.tracks[0] as Track, 1)).toBe(10);
    expect(validateClip(exported)).toEqual([]);
  });
});

describe('listeners', () => {
  it('notifies every time listener and isolates event delivery', () => {
    const p = new ClipPlayer(make({ events: seamEvents }));
    const times: number[] = [];
    p.onTime((t) => times.push(t));
    p.onTime((t) => times.push(t + 10));
    p.play();
    p.update(0.25);
    expect(times).toEqual([0.25, 10.25]);

    const failing = new ClipPlayer(make({ events: seamEvents }));
    failing.onEvent(() => {
      throw new Error('listener failed');
    });
    failing.play();
    expect(() => failing.update(0.5)).toThrow(/listener failed/);
    expect(failing.time).toBeCloseTo(0.5, 8);
  });

  it('keeps a seek made from an event listener', () => {
    const p = new ClipPlayer(make({ events: seamEvents }));
    const heard: string[] = [];
    p.onEvent((event) => {
      heard.push(event.name);
      if (event.name === 'a') p.seek(0.9);
    });
    p.play();
    p.update(0.5);
    expect(heard).toEqual(['a']);
    expect(p.time).toBe(0.9);
    expect(p.playing).toBe(true);
  });
});
