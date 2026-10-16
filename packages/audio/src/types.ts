export type BusName = 'master' | 'sfx' | 'music' | 'ui';
export const BUS_NAMES: readonly BusName[] = ['master', 'sfx', 'music', 'ui'];

export interface Vec3Like { x: number; y: number; z: number }

/** Camera transform used to sync the AudioListener. */
export interface ListenerTransform {
  position: Vec3Like;
  /** Unit forward vector (direction the camera looks). */
  forward: Vec3Like;
  /** Unit up vector. */
  up: Vec3Like;
}

export interface PlayOptions {
  bus?: Exclude<BusName, 'master'>;
  volume?: number;
  loop?: boolean;
  /** playbackRate multiplier (1 = normal). */
  pitch?: number;
  /** Fade-in seconds. */
  fadeIn?: number;
  /** Higher survives voice stealing. Default 0. */
  priority?: number;
}

export interface SpatialOptions {
  distanceModel?: 'linear' | 'inverse' | 'exponential';
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
  /** Bus the emitter outputs to. Default 'sfx'. */
  bus?: Exclude<BusName, 'master'>;
}

export interface AudioEngineOptions {
  /** Factory for the context (default: new AudioContext). Used for tests. */
  createContext?: () => AudioContext;
  /** Mute everything (master gain 0). Default: true if the URL has ?test=1. */
  muted?: boolean;
  /** Query string to inspect for test mode. Default: globalThis.location?.search. */
  search?: string;
  /** Element receiving first-gesture listeners. Default: globalThis (window). */
  gestureTarget?: EventTarget;
  maxVoices?: number;
  /** Factory for music elements. Default: new Audio(). */
  createMediaElement?: () => HTMLMediaElement;
  /** fetch override for loadBuffer. */
  fetch?: (url: string) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}
