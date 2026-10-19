import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Options } from 'tsup';

const cssRaw: NonNullable<Options['esbuildPlugins']>[number] = {
  name: 'css-raw',
  setup(build) {
    build.onResolve({ filter: /\.css\?raw$/ }, (args) => ({
      path: `${path.resolve(args.resolveDir, args.path.replace(/\?raw$/, ''))}.raw`,
      namespace: 'css-raw',
    }));
    build.onLoad({ filter: /\.css\.raw$/, namespace: 'css-raw' }, (args) => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(args.path.replace(/\.raw$/, ''), 'utf8'))}`,
      loader: 'js',
    }));
  },
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  injectStyle: true,
  esbuildPlugins: [cssRaw],
});
