/** Rendering backend selected by {@link detectBackend} and {@link createRenderer}. */
export type Backend = 'webgpu' | 'webgl2';

/**
 * Pick WebGPU when `nav` exposes a `gpu` object, otherwise WebGL2.
 *
 * This only checks that the WebGPU API exists. Creating a device can still
 * fail; {@link createRenderer} applies three.js's WebGL2 fallback while
 * `init()` runs when the chosen backend is `'webgpu'`.
 *
 * @param nav - Object to probe. Defaults to `globalThis.navigator`.
 * @returns `'webgpu'` when `gpu` is present, otherwise `'webgl2'`.
 */
export function detectBackend(nav: object = globalThis.navigator ?? {}): Backend {
  return 'gpu' in nav ? 'webgpu' : 'webgl2';
}
