import { fileURLToPath } from 'node:url';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  resolve: {
    alias: [
      {
        // Exact match so `@jurfi/editor/shell.css` still uses the package export.
        find: /^@jurfi\/editor$/,
        replacement: fileURLToPath(new URL('../../packages/editor/src/index.ts', import.meta.url)),
      },
    ],
  },
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
});
