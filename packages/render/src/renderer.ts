import { WebGPURenderer } from 'three/webgpu';
import type { Backend } from './backend';
import { detectBackend } from './backend';

/**
 * Create a three.js renderer and wait until its backend is initialized.
 *
 * three.js r186 throws from `WebGPURenderer.render()`, `hasFeature()`,
 * `clear()`, and `initTexture()` until `await renderer.init()` resolves.
 * `setAnimationLoop()` initializes on its own, but Jurfi samples draw from
 * their own frame loop, so this function finishes init before returning.
 *
 * Both backends use `WebGPURenderer`. `'webgl2'` sets `forceWebGL` so three
 * initializes its WebGL 2 backend, which still requires `init()`. That is
 * also the renderer that compiles {@link createStandardMaterial}.
 *
 * When `backend` is `'webgpu'` and a device cannot be created, three.js
 * switches to WebGL 2 inside `init()` and this promise still resolves with
 * that renderer. The promise rejects when neither backend can start.
 *
 * @param canvas - Drawing surface passed through to the renderer.
 * @param backend - `'webgpu'` or `'webgl2'`. Defaults to {@link detectBackend}.
 * @returns The renderer after `init()` has resolved. `renderer.initialized` is true.
 */
export async function createRenderer(canvas: HTMLCanvasElement, backend: Backend = detectBackend()): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: backend === 'webgl2',
  });
  await renderer.init();
  return renderer;
}
