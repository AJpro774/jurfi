import { describe, expect, it } from 'vitest';
import { GRAPH_TYPES_STUB, GRAPH_VERSION } from './index';

describe('graph schema stub', () => {
  it('publishes the provisional contract the editor imports', () => {
    expect(GRAPH_TYPES_STUB).toBe(true);
    expect(GRAPH_VERSION).toBe(1);
  });
});