import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// One entry per sample: apps/samples/<name>/index.html
const root = __dirname;
const samples = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(resolve(root, e.name, 'index.html')))
  .map((e) => e.name);

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: { index: resolve(root, 'index.html'), ...Object.fromEntries(samples.map((s) => [s, resolve(root, s, 'index.html')])) },
    },
  },
});
