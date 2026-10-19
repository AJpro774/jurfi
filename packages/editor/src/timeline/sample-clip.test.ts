import { applyClip, validateClip } from '@jurfi/anim';
import { createEditorWorld } from '@jurfi/core';
import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../content/demo';
import { createWorld } from '../world';
import { applyTimelineClip } from './apply';
import { createSampleClip } from './sample-clip';

function positionX(components: Record<string, unknown> | undefined): number {
  const transform = components?.transform;
  if (!transform || typeof transform !== 'object' || Array.isArray(transform)) return Number.NaN;
  const position = (transform as { position?: unknown }).position;
  if (!position || typeof position !== 'object' || Array.isArray(position)) return Number.NaN;
  const x = (position as { x?: unknown }).x;
  return typeof x === 'number' ? x : Number.NaN;
}

describe('sample clip', () => {
  it('matches the runtime clip schema', () => {
    const clip = createSampleClip();
    expect(validateClip(clip)).toEqual([]);
    const rot = clip.tracks.find((track) => track.id === 'rot');
    expect(rot?.type).toBe('quat');
    expect(rot?.target.entity).toBe('player');
    expect(rot?.target.component).toBe('Transform');
    expect(rot?.target.channel).toBeUndefined();
    expect(rot?.keys.every((key) => Array.isArray(key.v) && key.v.length === 4)).toBe(true);
    expect(clip.tracks.filter((track) => track.target.prop === 'position').every((track) => track.target.channel !== undefined)).toBe(true);
    expect(clip.tracks.some((track) => track.target.entity === 'hero' || track.target.component === 'sprite')).toBe(false);
    expect(clip.fps).toBeGreaterThan(0);
    expect(clip.loop).toBe(true);
  });

  it('moves the demo player box through the ECS binding', () => {
    const world = createEditorWorld();
    world.deserialize(createDemoSnapshot());
    const clip = createSampleClip();
    const before = positionX(world.get('player')?.components);
    const warnings = applyClip(world.ecs, clip, 1, { recordHistory: false, warn() {} });
    expect(warnings).toEqual([]);
    const after = positionX(world.get('player')?.components);
    expect(before).toBeCloseTo(0);
    expect(after).toBeCloseTo(1.5);
    const entity = world.ecs.resolveAlias('player');
    expect(entity).toBeDefined();
    expect(world.ecs.getField(entity ?? 0, 'Transform', 'position.x')).toBeCloseTo(1.5);
    expect(world.ecs.getField(world.ecs.resolveAlias('light') ?? 0, 'Light', 'color.g')).toBeLessThan(0.956);
  });

  it('does nothing to a document world that has no ECS', () => {
    const world = createWorld();
    const before = world.get('player')?.components;
    const warnings = applyTimelineClip(world, createSampleClip(), 1, new Set());
    expect(warnings).toEqual([]);
    expect(world.get('player')?.components).toEqual(before);
  });
});
