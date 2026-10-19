import { validateClip, type Clip } from '@jurfi/anim';
import { PANEL } from '../layout';
import { registerProjectSection } from '../project-sections';
import { registerPanel } from '../registry';
import { cloneClip, replaceClip } from './commands';
import { mountTimeline } from './panel';
import { createSampleClip } from './sample-clip';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTimelineSection(data: unknown): { clip: Clip; time: number } | null {
  if (!isRecord(data) || !isRecord(data.clip)) return null;
  const clip = data.clip as unknown as Clip;
  if (typeof clip.id !== 'string' || !Array.isArray(clip.tracks)) return null;
  if (validateClip(clip).length > 0) return null;
  const time = typeof data.time === 'number' && Number.isFinite(data.time) ? data.time : 0;
  return { clip, time };
}

/**
 * Replace the shell's Timeline placeholder.
 * The clip lives for the lifetime of this registration, including remounts when the tab is hidden.
 */
export function registerTimelinePanel(source?: Clip): () => void {
  const clip = source ? structuredClone(source) : createSampleClip();
  let time = 0;
  let readTime = (): number => time;
  const unregisterSection = registerProjectSection('timeline', {
    save: () => ({ clip: cloneClip(clip), time: readTime() }),
    load(data) {
      const parsed = parseTimelineSection(data);
      if (!parsed) {
        console.warn('Skipped project section "timeline": invalid clip');
        return;
      }
      replaceClip(clip, parsed.clip);
      time = parsed.time;
      readTime = () => time;
    },
  });
  const unregisterPanel = registerPanel({
    id: PANEL.timeline,
    title: 'Timeline',
    mount(el, ctx) {
      const session = mountTimeline(el, ctx, clip, time);
      readTime = () => session.time();
      return () => {
        time = session.time();
        readTime = () => time;
        session.dispose();
      };
    },
  });
  return () => {
    unregisterSection();
    unregisterPanel();
  };
}
