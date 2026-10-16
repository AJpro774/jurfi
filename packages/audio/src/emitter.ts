import type { AudioEngine } from './engine';
import type { BusName, PlayOptions, SpatialOptions, Vec3Like } from './types';
import type { Voice } from './voice';

/** 3D sound source backed by an HRTF PannerNode. */
export class SpatialEmitter {
  readonly panner: PannerNode;
  /** @internal */
  readonly bus: Exclude<BusName, 'master'>;

  constructor(private readonly engine: AudioEngine, opts: SpatialOptions = {}) {
    const p = engine.context.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = opts.distanceModel ?? 'inverse';
    p.refDistance = opts.refDistance ?? 1;
    p.maxDistance = opts.maxDistance ?? 10000;
    p.rolloffFactor = opts.rolloffFactor ?? 1;
    p.coneInnerAngle = opts.coneInnerAngle ?? 360;
    p.coneOuterAngle = opts.coneOuterAngle ?? 360;
    p.coneOuterGain = opts.coneOuterGain ?? 0;
    this.bus = opts.bus ?? 'sfx';
    p.connect(engine.bus(this.bus));
    this.panner = p;
  }

  setPosition(x: number, y: number, z: number): void {
    const p = this.panner;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }

  setPositionFrom(v: Vec3Like): void {
    this.setPosition(v.x, v.y, v.z);
  }

  setOrientation(x: number, y: number, z: number): void {
    const p = this.panner;
    if (p.orientationX) {
      p.orientationX.value = x;
      p.orientationY.value = y;
      p.orientationZ.value = z;
    } else (p as unknown as { setOrientation(x: number, y: number, z: number): void }).setOrientation(x, y, z);
  }

  /** Play a cached buffer through this emitter. */
  play(assetId: string, opts: PlayOptions = {}): Voice | null {
    return this.engine.play(assetId, { ...opts, bus: this.bus }, this.panner);
  }

  dispose(): void {
    this.panner.disconnect();
  }
}
