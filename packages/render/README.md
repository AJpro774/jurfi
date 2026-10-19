# @jurfi/render

three.js rendering for Jurfi. WebGPU is the primary backend. WebGL2 is the same `WebGPURenderer` with `forceWebGL`.

`createRenderer(canvas, backend?)` is async. It builds the renderer and waits for `renderer.init()` before resolving. three.js r186 throws from `render()`, `hasFeature()`, and `clear()` until that promise settles, on both backends. When `'webgpu'` cannot create a device, three.js falls back to WebGL 2 inside `init()`.

Scene helpers (`createScene`, `createPerspectiveCamera`, `createOrthographicCamera`, `createBoxMesh`, `createSphereMesh`, `createPlaneMesh`, `createMesh`) return ordinary three.js objects and do not need a GPU. Meshes use `MeshStandardNodeMaterial`, the node-material form of the standard PBR material. Those materials compile on `WebGPURenderer` for WebGPU and WebGL 2.

```ts
const renderer = await createRenderer(canvas); // or createRenderer(canvas, 'webgl2')
const scene = createScene({ background: '#111111' });
const camera = createPerspectiveCamera({ fov: 50, aspect: width / height, position: [0, 5, 8], lookAt: [0, 0, 0] });
scene.add(createMesh({ kind: 'sphere', radius: 0.4, roughness: 0.3 }));
renderer.render(scene, camera);
```
