import { defineConfig, mergeConfig } from 'vitest/config';
export const base = { test: { environment: 'node', include: ['src/**/*.test.ts','test/**/*.test.ts'], passWithNoTests: true, coverage: { provider: 'v8', reporter: ['text','lcov'] } } };
export const defineJurfiConfig = (overrides = {}) => mergeConfig(defineConfig(base), defineConfig(overrides));
export default base;
