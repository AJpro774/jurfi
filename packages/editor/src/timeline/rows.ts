import type { Clip, Track } from '@jurfi/anim';
import { componentCount, isDiscrete, isWholeQuat, partLabel } from './values';

export type ViewMode = 'dopesheet' | 'curves';

export interface TimelineRow {
  id: string;
  depth: number;
  label: string;
  kind: 'group' | 'track' | 'curve' | 'events';
  trackId?: string;
  /** Curve component, or Euler axis when `quat` is set. */
  part?: number;
  quat?: boolean;
}

function propertyKey(track: Track): string {
  return `${track.target.component}.${track.target.prop}`;
}

function trackLabel(track: Track, grouped: boolean): string {
  if (grouped) return partLabel(track, track.target.channel ?? 0);
  return propertyKey(track);
}

/**
 * Track list for the current view.
 * Whole quaternions expand to three Euler rows in the curve editor, never to x/y/z/w channels.
 */
export function buildRows(clip: Clip, collapsed: ReadonlySet<string>, mode: ViewMode): TimelineRow[] {
  const entities = new Map<string, Map<string, Track[]>>();
  for (const track of clip.tracks) {
    let props = entities.get(track.target.entity);
    if (!props) {
      props = new Map();
      entities.set(track.target.entity, props);
    }
    const prop = propertyKey(track);
    const list = props.get(prop) ?? [];
    list.push(track);
    props.set(prop, list);
  }

  const rows: TimelineRow[] = [];
  for (const [entity, props] of entities) {
    const entityId = `e:${entity}`;
    rows.push({ id: entityId, depth: 0, kind: 'group', label: entity });
    if (collapsed.has(entityId)) continue;
    for (const [prop, tracks] of props) {
      const grouped = tracks.length > 1;
      const propId = `p:${entity}:${prop}`;
      if (grouped) {
        rows.push({ id: propId, depth: 1, kind: 'group', label: prop });
        if (collapsed.has(propId)) continue;
      }
      for (const track of tracks) {
        const depth = grouped ? 2 : 1;
        const label = trackLabel(track, grouped);
        const quat = isWholeQuat(track);
        const parts = componentCount(track);
        const split = mode === 'curves' && !isDiscrete(track) && (quat || (parts > 1 && track.target.channel === undefined && track.type !== 'number'));
        if (!split) {
          rows.push({ id: `t:${track.id}`, depth, kind: 'track', label, trackId: track.id, quat });
          continue;
        }
        const parentId = `t:${track.id}`;
        rows.push({ id: parentId, depth, kind: 'group', label, trackId: track.id, quat });
        if (collapsed.has(parentId)) continue;
        for (let part = 0; part < parts; part++) {
          rows.push({
            id: `t:${track.id}:${part}`,
            depth: depth + 1,
            kind: 'curve',
            label: partLabel(track, part),
            trackId: track.id,
            part,
            quat,
          });
        }
      }
    }
  }
  rows.push({ id: 'events', depth: 0, kind: 'events', label: 'Events' });
  return rows;
}
