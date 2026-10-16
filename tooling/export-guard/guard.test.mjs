import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { scan } from './guard.mjs';
test('detects editor import', () => { const d=fs.mkdtempSync(path.join(os.tmpdir(),'eg-')); fs.writeFileSync(path.join(d,'a.js'),'import "@jurfi/editor";'); assert.equal(scan(d).length,1); });
test('clean passes', () => { const d=fs.mkdtempSync(path.join(os.tmpdir(),'eg-')); fs.writeFileSync(path.join(d,'a.js'),'import "@jurfi/core";'); assert.equal(scan(d).length,0); });

import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url'; import { requireDistProblem } from './guard.mjs';
const guardPath = fileURLToPath(new URL('./guard.mjs', import.meta.url));
const run = (dir, env) => spawnSync(process.execPath, [guardPath, dir], { env: { ...process.env, REQUIRE_DIST: '', ...env }, encoding: 'utf8' });
test('requireDistProblem is null when unset', () => { assert.equal(requireDistProblem('/nonexistent', {}), null); });
test('REQUIRE_DIST=1 fails on missing dir with exit 1', () => { const r = run(path.join(os.tmpdir(),'eg-missing-'+Date.now()), { REQUIRE_DIST: '1' }); assert.equal(r.status, 1); assert.match(r.stderr, /REQUIRE_DIST=1 but dist directory is missing/); });
test('REQUIRE_DIST=1 fails on empty dir with exit 1', () => { const d=fs.mkdtempSync(path.join(os.tmpdir(),'eg-')); const r = run(d, { REQUIRE_DIST: '1' }); assert.equal(r.status, 1); assert.match(r.stderr, /empty/); });
test('REQUIRE_DIST=1 passes on populated clean dir', () => { const d=fs.mkdtempSync(path.join(os.tmpdir(),'eg-')); fs.writeFileSync(path.join(d,'a.js'),'ok'); assert.equal(run(d, { REQUIRE_DIST: '1' }).status, 0); });
test('unset keeps legacy behavior: missing dir exit 2, empty dir exit 0', () => { assert.equal(run(path.join(os.tmpdir(),'eg-missing-'+Date.now()), {}).status, 2); assert.equal(run(fs.mkdtempSync(path.join(os.tmpdir(),'eg-')), {}).status, 0); });
