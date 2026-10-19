import {
  EcsError,
  getComponentType,
  listComponentTypes,
  resolveEntityId,
  type FieldType,
  type World,
} from '@jurfi/core';
import { sampleTrack } from './sample';
import type { Clip, KeyValue, Track, TrackTarget } from './types';

/**
 * One sampled track that could not be written.
 * `applyClip` collects these and does not throw.
 */
export interface ApplyWarning {
  trackId: string;
  message: string;
}

export interface ApplyClipOptions {
  /** Track ids to leave untouched (muted timeline rows). */
  skip?: ReadonlySet<string>;
  /**
   * Receives each warning as it happens.
   * When omitted, warnings are also written with `console.warn`.
   */
  warn?: (warning: ApplyWarning) => void;
  /**
   * When `false`, writes skip the world undo stack (`World.withoutHistory`).
   * Playback should pass `false`. A one-shot apply records history by default.
   */
  recordHistory?: boolean;
}

const LANES: Partial<Record<FieldType, readonly string[]>> = {
  vec2: ['x', 'y'],
  vec3: ['x', 'y', 'z'],
  vec4: ['x', 'y', 'z', 'w'],
  quat: ['x', 'y', 'z', 'w'],
  color: ['r', 'g', 'b', 'a'],
};

/**
 * Sample `clip` at `t` and write each track onto `world`.
 *
 * `target.entity` is a stable alias (`World.setAlias`) or a decimal packed id.
 * `target.component` matches a registered component id, case-insensitively
 * (`transform` → `Transform`). `target.prop` is a schema field. `target.channel`
 * picks a lane (`x`, `y`, `z`, `w`, or `r`, `g`, `b`, `a`).
 *
 * Unknown entities, components, and fields become warnings. A registered
 * component that the entity does not have yet is created from defaults, which
 * is `World.setField`'s own behavior.
 *
 * When the entity also stores a JSON component under the track's component
 * name, or under the schema id with a lowercase first letter, the same value
 * is copied there. The editor viewport reads that object form (`transform.position.x`)
 * while the schema component stays the source of truth for exported games.
 */
export function applyClip(world: World, clip: Clip, t: number, options: ApplyClipOptions = {}): ApplyWarning[] {
  const run = (): ApplyWarning[] => {
    const warnings: ApplyWarning[] = [];
    const report = (trackId: string, message: string): void => {
      const warning = { trackId, message };
      warnings.push(warning);
      if (options.warn) options.warn(warning);
      else console.warn(`anim: ${trackId}: ${message}`);
    };
    world.batch(() => {
      for (const track of clip.tracks) {
        if (options.skip?.has(track.id)) continue;
        const value = sampleTrack(track, t);
        if (value === undefined) continue;
        applyTrack(world, track, value, report);
      }
    });
    return warnings;
  };
  if (options.recordHistory === false) return world.withoutHistory(run);
  return run();
}

function applyTrack(
  world: World,
  track: Track,
  value: KeyValue,
  report: (trackId: string, message: string) => void,
): void {
  const target = track.target;
  const entity = resolveEntityId(world, target.entity);
  if (!world.isAlive(entity)) {
    const message =
      entity !== 0 ? `Entity "${target.entity}" is not alive` : `Unknown entity "${target.entity}"`;
    report(track.id, message);
    return;
  }

  const schemaId = resolveSchemaId(target.component);
  if (schemaId) {
    writeSchema(world, entity, schemaId, track, value, report);
    return;
  }
  if (world.has(entity, target.component)) {
    writeJson(world, entity, track, value, report);
    return;
  }
  report(track.id, `Unknown component "${target.component}" on entity "${target.entity}"`);
}

function writeSchema(
  world: World,
  entity: number,
  schemaId: string,
  track: Track,
  value: KeyValue,
  report: (trackId: string, message: string) => void,
): void {
  const target = track.target;
  const fieldType = getComponentType(schemaId)?.schema[target.prop]?.type;
  if (!fieldType) {
    report(track.id, `Unknown field "${schemaId}.${target.prop}"`);
    return;
  }
  const lanes = LANES[fieldType] ?? [];
  const path = fieldPath(schemaId, target, lanes, value, report, track.id);
  if (!path) return;
  try {
    world.setField(entity, schemaId, path, storedValue(value));
  } catch (error) {
    report(track.id, errorText(error));
    return;
  }
  for (const alias of jsonMirrors(schemaId, target.component)) {
    if (!world.has(entity, alias)) continue;
    const bag = world.get(entity, alias);
    if (!isPlain(bag)) continue;
    try {
      mirrorField(world, entity, schemaId, alias, target.prop, fieldType, target.channel);
    } catch (error) {
      report(track.id, `Could not mirror "${alias}.${target.prop}": ${errorText(error)}`);
    }
  }
}

function writeJson(
  world: World,
  entity: number,
  track: Track,
  value: KeyValue,
  report: (trackId: string, message: string) => void,
): void {
  const target = track.target;
  const bag = world.get(entity, target.component);
  if (!isPlain(bag)) {
    report(track.id, `Component "${target.component}" is not an object`);
    return;
  }
  try {
    if (target.channel === undefined) {
      world.setField(entity, target.component, target.prop, storedValue(value));
      return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      report(track.id, `Value for "${target.component}.${target.prop}" channel ${target.channel} must be a finite number`);
      return;
    }
    const current = bag[target.prop];
    if (Array.isArray(current)) {
      if (target.channel < 0 || target.channel >= current.length || !Number.isInteger(target.channel)) {
        report(track.id, `Channel ${target.channel} is out of range for "${target.component}.${target.prop}"`);
        return;
      }
      const next = current.slice();
      next[target.channel] = value;
      world.setField(entity, target.component, target.prop, next);
      return;
    }
    const lane = jsonLane(track, target.channel);
    if (!lane) {
      report(track.id, `Channel ${target.channel} is out of range for "${target.component}.${target.prop}"`);
      return;
    }
    world.setField(entity, target.component, `${target.prop}.${lane}`, value);
  } catch (error) {
    report(track.id, errorText(error));
  }
}

function fieldPath(
  schemaId: string,
  target: TrackTarget,
  lanes: readonly string[],
  value: KeyValue,
  report: (trackId: string, message: string) => void,
  trackId: string,
): string | undefined {
  const where = `${schemaId}.${target.prop}`;
  if (target.channel !== undefined) {
    if (!Number.isInteger(target.channel) || target.channel < 0 || target.channel >= lanes.length) {
      report(trackId, `Channel ${target.channel} is out of range for "${where}"`);
      return undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      report(trackId, `Value for "${where}" channel ${target.channel} must be a finite number`);
      return undefined;
    }
    const lane = lanes[target.channel];
    if (!lane) {
      report(trackId, `Channel ${target.channel} is out of range for "${where}"`);
      return undefined;
    }
    return `${target.prop}.${lane}`;
  }
  if (lanes.length === 0) {
    if (!scalarMatches(value)) {
      report(trackId, `Value for "${where}" must be a finite number, boolean, or string`);
      return undefined;
    }
    return target.prop;
  }
  if (!Array.isArray(value) || value.length !== lanes.length || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    report(trackId, `Value for "${where}" must be ${lanes.length} finite numbers`);
    return undefined;
  }
  return target.prop;
}

function mirrorField(
  world: World,
  entity: number,
  schemaId: string,
  alias: string,
  prop: string,
  fieldType: FieldType,
  channel: number | undefined,
): void {
  const bag = world.get(entity, alias);
  const current = isPlain(bag) ? bag[prop] : undefined;
  const lanes = LANES[fieldType] ?? [];
  if (Array.isArray(current) || lanes.length === 0) {
    world.setField(entity, alias, prop, world.getField(entity, schemaId, prop));
    return;
  }
  if (channel !== undefined) {
    const lane = lanes[channel];
    if (!lane) return;
    world.setField(entity, alias, `${prop}.${lane}`, world.getField(entity, schemaId, `${prop}.${lane}`));
    return;
  }
  const whole = world.getField(entity, schemaId, prop);
  if (!Array.isArray(whole)) return;
  const obj: Record<string, number> = {};
  for (let index = 0; index < lanes.length; index += 1) {
    const lane = lanes[index];
    const item = whole[index];
    if (!lane || typeof item !== 'number') continue;
    obj[lane] = item;
  }
  world.setField(entity, alias, prop, obj);
}

function jsonMirrors(schemaId: string, requested: string): string[] {
  const out: string[] = [];
  if (requested !== schemaId) out.push(requested);
  const lower = schemaId.charAt(0).toLowerCase() + schemaId.slice(1);
  if (lower !== schemaId && lower !== requested) out.push(lower);
  return out;
}

function resolveSchemaId(name: string): string | undefined {
  if (getComponentType(name)) return name;
  const lower = name.toLowerCase();
  const hits = listComponentTypes().filter((type) => type.id.toLowerCase() === lower);
  return hits.length === 1 ? hits[0]?.id : undefined;
}

function jsonLane(track: Track, channel: number): string | undefined {
  const lanes = track.type === 'color' ? LANES.color : ['x', 'y', 'z', 'w'];
  return lanes?.[channel];
}

function storedValue(value: KeyValue): KeyValue {
  return Array.isArray(value) ? value.slice() : value;
}

function scalarMatches(value: KeyValue): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'boolean' || typeof value === 'string';
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  if (error instanceof EcsError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Write failed';
}
