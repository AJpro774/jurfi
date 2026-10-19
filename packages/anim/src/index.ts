export type { Easing } from './easing';
export { easeInOut, lerp, linear } from './easing';

export type {
  ApplyFn,
  Clip,
  ClipEvent,
  Interp,
  Key,
  KeyValue,
  LoopMode,
  SampledValue,
  Tangent,
  Track,
  TrackTarget,
  TrackType,
} from './types';

export { sampleClip, sampleTrack } from './sample';

export { ClipPlayer } from './player';
export type { ClipEventListener, ClipPlayerOptions, SeekOptions, TimeListener } from './player';

export { addKey, addTrack, moveKey, removeKey, setInterp, sortKeys, stripEditorData, validateClip } from './edit';
export type { TangentEdit } from './edit';
