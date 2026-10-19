import { defineJurfiConfig } from '@jurfi/vitest-config';

export default defineJurfiConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
