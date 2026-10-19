import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // Rapier is its own WASM module. Keep the dynamic import external so a game
  // that only uses overlaps does not bundle or instantiate it.
  external: ['@dimforge/rapier3d-compat'],
});
