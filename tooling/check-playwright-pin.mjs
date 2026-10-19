#!/usr/bin/env node
// Fails if the Playwright image tag used in workflows differs from the pinned @playwright/test version.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const errors = [];

// 1. Pinned @playwright/test version: tests/visual/package.json, else the lockfile importer entry.
let pinned;
const pkgPath = 'tests/visual/package.json';
if (existsSync(resolve(root, pkgPath))) {
  const pkg = JSON.parse(read(pkgPath));
  pinned = { ...pkg.dependencies, ...pkg.devDependencies }['@playwright/test'];
}
if (!pinned) {
  const m = read('pnpm-lock.yaml').match(/^ {2}tests\/visual:\n(?:(?: {4,}.*)?\n)*?\s+'?@playwright\/test'?:\n\s+specifier: (\S+)/m);
  pinned = m?.[1];
}
if (!pinned || !/^\d+\.\d+\.\d+$/.test(pinned)) {
  errors.push(`@playwright/test must be pinned to an exact version (found: ${pinned ?? 'none'})`);
}

// 2. Image tags in every workflow that references the Playwright image (visual.yml required).
const files = ['.github/workflows/visual.yml', '.github/workflows/update-baselines.yml'];
for (const f of files) {
  const tags = [...read(f).matchAll(/mcr\.microsoft\.com\/playwright:v([\w.\-]+)/g)].map((m) => m[1]);
  if (tags.length === 0) errors.push(`${f}: no Playwright image reference found`);
  for (const tag of tags) {
    const version = tag.split('-')[0];
    if (version !== pinned) errors.push(`${f}: image tag v${tag} (version ${version}) != pinned @playwright/test ${pinned}`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => `check-playwright-pin: ${e}`).join('\n'));
  process.exit(1);
}
console.log(`check-playwright-pin: OK (${pinned})`);
