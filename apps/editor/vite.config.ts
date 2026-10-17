import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  resolve: {
    alias: {
      '@jurfi/editor': resolve(__dirname, '../../packages/editor/src/index.ts'),
      '@jurfi/script': resolve(__dirname, '../../packages/script/src/index.ts'),
    },
  },
  build: { target: 'esnext' },
});