import { applyClip, type ApplyWarning, type Clip } from '@jurfi/anim';
import type { World } from '@jurfi/core';
import type { EditorWorld } from '../world';

/**
 * Write the clip onto the ECS behind an editor world.
 * Worlds created without `@jurfi/core` have no `ecs` handle; those return no warnings
 * and leave the document unchanged. Playback does not record undo steps.
 */
export function applyTimelineClip(world: EditorWorld, clip: Clip, time: number, skip: ReadonlySet<string>): ApplyWarning[] {
  const ecs = ecsOf(world);
  if (!ecs) return [];
  return applyClip(ecs, clip, time, {
    skip,
    recordHistory: false,
    warn() {},
  });
}

function ecsOf(world: EditorWorld): World | undefined {
  if (!('ecs' in world)) return undefined;
  const ecs = (world as { ecs?: unknown }).ecs;
  if (!ecs || typeof ecs !== 'object') return undefined;
  const candidate = ecs as { setField?: unknown; isAlive?: unknown; batch?: unknown; withoutHistory?: unknown };
  if (
    typeof candidate.setField !== 'function' ||
    typeof candidate.isAlive !== 'function' ||
    typeof candidate.batch !== 'function' ||
    typeof candidate.withoutHistory !== 'function'
  ) {
    return undefined;
  }
  return ecs as World;
}
