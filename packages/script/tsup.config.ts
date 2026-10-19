import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/host.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  target: 'es2022',
});
