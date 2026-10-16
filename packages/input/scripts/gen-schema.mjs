// Regenerates schema/action-map.schema.json and docs/api/action-map.schema.json from src/schema.ts.
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['src/schema.ts'], bundle: true, format: 'esm', write: false });
const code = r.outputFiles[0].text;
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const out = JSON.stringify(mod.ACTION_MAP_SCHEMA, null, 2) + '\n';
writeFileSync(new URL('../schema/action-map.schema.json', import.meta.url), out);
writeFileSync(new URL('../../../docs/api/action-map.schema.json', import.meta.url), out);
