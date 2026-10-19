import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./viewport.css', import.meta.url), 'utf8');

describe('viewport stylesheet', () => {
  it('uses design tokens and no raw colors', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
    expect(css).toContain('var(--surface-0)');
    expect(css).toContain('var(--accent)');
    expect(css).toContain('var(--danger)');
    expect(css).toContain('var(--text-1)');
    expect(css).toContain('var(--panel-header-bg)');
    expect(css).toContain('var(--focus-ring)');
  });
});
