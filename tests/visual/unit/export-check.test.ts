import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// Reuse the repo's export guard.
// @ts-expect-error untyped .mjs
import { scan } from '../../tooling/export-guard/guard.mjs';

const dist = resolve(__dirname, '../../../apps/samples/dist');

describe('export check: built samples must not reference @jurfi/editor', () => {
  it('guard flags editor imports (self-test)', () => {
    const d = mkdtempSync(join(tmpdir(), 'ec-'));
    mkdirSync(join(d, 'pong'));
    writeFileSync(join(d, 'pong', 'a.js'), 'import"@jurfi/editor";');
    expect(scan(d)).toHaveLength(1);
  });
  it('guard passes clean bundles (self-test)', () => {
    const d = mkdtempSync(join(tmpdir(), 'ec-'));
    writeFileSync(join(d, 'a.js'), 'import"@jurfi/core";');
    expect(scan(d)).toHaveLength(0);
  });
  // Requires `pnpm --filter @jurfi/samples build`; skipped (not failed) when dist is absent unless REQUIRE_DIST=1.
  const real = existsSync(dist) || process.env.REQUIRE_DIST === '1' ? it : it.skip;
  real('real apps/samples/dist has no editor references', () => {
    expect(existsSync(dist), `build samples first: ${dist}`).toBe(true);
    expect(scan(dist)).toEqual([]);
  });
});
