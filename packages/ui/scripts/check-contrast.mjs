#!/usr/bin/env node
// WCAG contrast check over resolved token values. No dependencies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/tokens');
const css = (f) => readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(src) {
  const out = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
    out.push({ sel: m[1].split(',').map((s) => s.trim().replace(/"/g, "'")), decls });
  }
  return out;
}
const prim = Object.assign({}, ...blocks(css('primitives.css')).map((b) => b.decls));
const sem = blocks(css('semantic.css'));

function themeVars(theme) {
  const vars = {};
  for (const b of sem) {
    const hit = b.sel.some((s) => s === `[data-theme='${theme}']` || (theme === 'dark' && s === ':root'));
    if (hit) Object.assign(vars, b.decls);
  }
  return vars;
}
function resolve(name, vars, depth = 0) {
  let v = vars[name] ?? prim[name];
  if (v === undefined || depth > 10) throw new Error(`unresolved ${name}`);
  const m = v.match(/^var\((--[\w-]+)\)$/);
  return m ? resolve(m[1], vars, depth + 1) : v;
}
function hex(h) {
  h = h.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) h = '#' + [...h.slice(1)].map((c) => c + c).join('');
  if (!/^#[0-9a-f]{6}$/.test(h)) throw new Error(`not a hex colour: ${h}`);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const checks = [
  ['--text-1', ['--surface-0', '--surface-1', '--surface-2', '--surface-3'], 4.5],
  ['--text-2', ['--surface-0', '--surface-1', '--surface-2', '--surface-3'], 4.5],
  ['--text-3', ['--surface-0', '--surface-1', '--surface-2', '--surface-3'], 4.5],
  ['--accent', ['--surface-0'], 3],
  ['--border-strong', ['--surface-0', '--surface-1', '--surface-2', '--surface-3'], 3],
];
// Colour tokens do not vary by density, so both densities share these results.
const densities = ['cozy', 'compact'];
let fail = 0;
console.log('theme  fg               bg           fg-hex   bg-hex   ratio  min   result  (densities: ' + densities.join(', ') + ')');
for (const theme of ['dark', 'light', 'hc']) {
  const vars = themeVars(theme);
  for (const [fg, bgs, min] of checks) for (const bg of bgs) {
    const f = resolve(fg, vars), b = resolve(bg, vars), r = ratio(f, b);
    const ok = r >= min; if (!ok) fail++;
    console.log(`${theme.padEnd(6)} ${fg.padEnd(16)} ${bg.padEnd(12)} ${f} ${b} ${r.toFixed(2).padStart(5)}  ${String(min).padEnd(4)}  ${ok ? 'ok' : 'FAIL'}`);
  }
}
console.log(fail ? `\n${fail} contrast check(s) failed` : '\nAll contrast checks passed');
process.exit(fail ? 1 : 0);
