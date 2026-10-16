#!/usr/bin/env node
// Fails if any built sample bundle imports/references @jurfi/editor.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
export const FORBIDDEN = [/@jurfi\/editor(?!-app)/, /packages\/editor\//, /@jurfi[\\/_-]editor/];
const EXT = new Set(['.js','.mjs','.cjs','.html','.css','.map','.json','.wasm','.ts']);
export function* walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); if (e.isDirectory()) yield* walk(p); else if (EXT.has(path.extname(e.name))) yield p; } }
export function scan(dir){
  const hits=[];
  for (const f of walk(dir)) { const t=fs.readFileSync(f,'latin1'); for (const re of FORBIDDEN) { const m=re.exec(t); if (m) { hits.push({file:f,match:m[0]}); break; } } }
  return hits;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.cwd(), process.argv[2] ?? 'apps/samples/dist');
  if (!fs.existsSync(dir)) { console.error('export-guard: directory not found: '+dir+' (build samples first)'); process.exit(2); }
  const hits = scan(dir);
  if (hits.length) { console.error('export-guard FAILED: @jurfi/editor referenced in built samples:'); for (const h of hits) console.error('  '+h.file+'  ('+h.match+')'); process.exit(1); }
  console.log('export-guard OK: no @jurfi/editor references in '+dir);
}
