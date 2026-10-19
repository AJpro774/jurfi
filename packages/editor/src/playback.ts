import type { Clip } from '@jurfi/anim';
import type { GraphDoc } from '@jurfi/script';

let graph: () => GraphDoc | null = () => null;
let clip: () => Clip | null = () => null;

/** Node graph registration publishes the document Play mode ticks. */
export function setPlaybackGraph(read: () => GraphDoc | null): void {
  graph = read;
}

export function playbackGraph(): GraphDoc | null {
  return graph();
}

/** Timeline registration publishes the clip Play mode samples. */
export function setPlaybackClip(read: () => Clip | null): void {
  clip = read;
}

export function playbackClip(): Clip | null {
  return clip();
}
