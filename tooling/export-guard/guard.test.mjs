import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { scan } from './guard.mjs';
test('detects editor import', () => { const d=fs.mkdtempSync(path.join(os.tmpdir(),'eg-')); fs.writeFileSync(path.join(d,'a.js'),'import "@jurfi/editor";'); assert.equal(scan(d).length,1); });
test('clean passes', () => { const d=fs.mkdtempSync(path.join(os.tmpdir(),'eg-')); fs.writeFileSync(path.join(d,'a.js'),'import "@jurfi/core";'); assert.equal(scan(d).length,0); });
