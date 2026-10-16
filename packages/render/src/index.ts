import { WebGLRenderer } from 'three';
import { WebGPURenderer } from 'three/webgpu';

export type Backend = 'webgpu' | 'webgl2';

/** Pick WebGPU when available, otherwise WebGL2. */
export function detectBackend(nav: object = globalThis.navigator ?? {}): Backend {
  return 'gpu' in nav ? 'webgpu' : 'webgl2';
}

export function createRenderer(canvas: HTMLCanvasElement, backend: Backend = detectBackend()): WebGLRenderer | WebGPURenderer {
  return backend === 'webgpu'
    ? new WebGPURenderer({ canvas, antialias: true })
    : new WebGLRenderer({ canvas, antialias: true });
}
