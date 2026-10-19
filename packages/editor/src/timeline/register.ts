import type { Clip } from '@jurfi/anim';
import { PANEL } from '../layout';
import { setPlaybackClip } from '../playback';
import { registerPanel } from '../registry';
import { mountTimeline } from './panel';
import { createSampleClip } from './sample-clip';

/**
 * Replace the shell's Timeline placeholder.
 * The clip lives for the lifetime of this registration, including remounts when the tab is hidden.
 */
export function registerTimelinePanel(source?: Clip): () => void {
  const clip = source ? structuredClone(source) : createSampleClip();
  let time = 0;
  setPlaybackClip(() => clip);
  const unregister = registerPanel({
    id: PANEL.timeline,
    title: 'Timeline',
    mount(el, ctx) {
      const session = mountTimeline(el, ctx, clip, time);
      return () => {
        time = session.time();
        session.dispose();
      };
    },
  });
  return () => {
    setPlaybackClip(() => null);
    unregister();
  };
}
