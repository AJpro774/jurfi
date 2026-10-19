import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectBackend, createRenderer } from './index';

const harness = vi.hoisted(() => ({
  instances: [] as Array<{
    params: { canvas?: unknown; antialias?: boolean; forceWebGL?: boolean };
    init: ReturnType<typeof vi.fn>;
  }>,
  initImpl: (): Promise<void> => Promise.resolve(),
}));

vi.mock('three/webgpu', () => {
  class WebGPURenderer {
    params: { canvas?: unknown; antialias?: boolean; forceWebGL?: boolean };
    init: ReturnType<typeof vi.fn>;
    constructor(params: { canvas?: unknown; antialias?: boolean; forceWebGL?: boolean } = {}) {
      this.params = params;
      this.init = vi.fn(() => harness.initImpl());
      harness.instances.push(this);
    }
  }
  class MeshStandardNodeMaterial {}
  return { WebGPURenderer, MeshStandardNodeMaterial };
});

const canvas = {} as HTMLCanvasElement;

describe('createRenderer', () => {
  beforeEach(() => {
    harness.instances.length = 0;
    harness.initImpl = () => Promise.resolve();
  });

  it('awaits init() before resolving on the WebGPU path', async () => {
    let release: () => void = () => {};
    harness.initImpl = () => new Promise<void>((resolve) => { release = resolve; });
    let settled = false;
    const pending = createRenderer(canvas, 'webgpu');
    void pending.then(() => { settled = true; });

    await vi.waitFor(() => expect(harness.instances).toHaveLength(1));
    const created = harness.instances[0]!;
    expect(created.init).toHaveBeenCalledOnce();
    expect(created.params).toEqual({ canvas, antialias: true, forceWebGL: false });
    expect(settled).toBe(false);

    release();
    await expect(pending).resolves.toBe(created);
    expect(settled).toBe(true);
  });

  it('awaits init() and forces the WebGL2 backend', async () => {
    const renderer = await createRenderer(canvas, 'webgl2');
    const created = harness.instances[0]!;
    expect(renderer).toBe(created);
    expect(created.params.forceWebGL).toBe(true);
    expect(created.params.antialias).toBe(true);
    expect(created.init).toHaveBeenCalledOnce();
  });

  it('uses detectBackend() when no backend is passed', async () => {
    await createRenderer(canvas);
    expect(harness.instances[0]!.params.forceWebGL).toBe(detectBackend() === 'webgl2');
  });

  it('rejects when init() fails and does not return the renderer', async () => {
    harness.initImpl = () => Promise.reject(new Error('no adapter'));
    await expect(createRenderer(canvas, 'webgpu')).rejects.toThrow('no adapter');
  });
});
