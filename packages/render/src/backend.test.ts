import { describe, expect, it } from 'vitest';
import { detectBackend } from './index';

describe('detectBackend', () => {
  it('picks WebGPU when gpu is present', () => {
    expect(detectBackend({ gpu: {} })).toBe('webgpu');
  });

  it('picks WebGL2 when gpu is absent', () => {
    expect(detectBackend({})).toBe('webgl2');
    expect(detectBackend({ userAgent: 'test' })).toBe('webgl2');
  });
});
