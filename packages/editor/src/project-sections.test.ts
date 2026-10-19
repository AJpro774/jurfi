// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorContext } from './context';
import { defaultLayout } from './layout';
import {
  AUTOSAVE_STORAGE_KEY,
  applyProjectSections,
  readProject,
  writeProject,
} from './project';
import { registerProjectSection, type ProjectSection } from './project-sections';
import { createEditor } from './shell';
import { memoryStore } from './storage';
import { createWorld } from './world';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
  vi.restoreAllMocks();
});

function track(section: ProjectSection, id: string): void {
  cleanups.push(registerProjectSection(id, section));
}

describe('project sections', () => {
  it('stores each section under its id and round-trips JSON', () => {
    track({ save: () => ({ yaw: 1, pitch: 0 }), load() {} }, 'camera');
    track({ save: () => ['clip'], load() {} }, 'timeline');
    const project = readProject(writeProject(createWorld(), defaultLayout()));
    expect(project?.sections).toEqual({
      camera: { yaw: 1, pitch: 0 },
      timeline: ['clip'],
    });
  });

  it('stores undefined as null and omits a value that is not JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    track({ save: () => undefined, load() {} }, 'empty');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    track({ save: () => cycle, load() {} }, 'bad');
    const project = readProject(writeProject(createWorld(), defaultLayout()));
    expect(project?.sections.empty).toBeNull();
    expect(project?.sections.bad).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('skips an unknown section and a missing section without calling load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let loaded: unknown = 'unset';
    let missingLoads = 0;
    track({
      save: () => ({ yaw: 0 }),
      load(data) { loaded = data; },
    }, 'camera');
    track({
      save: () => ({}),
      load() { missingLoads += 1; },
    }, 'timeline');
    const warnings = applyProjectSections({ camera: { yaw: 2 }, ghost: true });
    expect(loaded).toEqual({ yaw: 2 });
    expect(missingLoads).toBe(0);
    expect(warnings.map((warning) => warning.reason).sort()).toEqual(['missing', 'unknown']);
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      'Skipped unknown project section "ghost"',
      'Skipped missing project section "timeline"',
    ]);
  });

  it('keeps a replaced section when the previous unregister runs', () => {
    const first = registerProjectSection('camera', { save: () => 1, load() {} });
    const second = registerProjectSection('camera', { save: () => 2, load() {} });
    cleanups.push(second);
    first();
    expect(readProject(writeProject(createWorld(), defaultLayout()))?.sections.camera).toBe(2);
  });

  it('rejects an empty id and a project whose sections bag is not an object', () => {
    expect(() => registerProjectSection('  ', { save: () => null, load() {} })).toThrow(/non-empty/);
    const parsed = JSON.parse(writeProject(createWorld(), defaultLayout())) as { sections: unknown };
    delete parsed.sections;
    expect(readProject(JSON.stringify(parsed))?.sections).toEqual({});
    parsed.sections = [];
    expect(readProject(JSON.stringify(parsed))).toBeNull();
  });

  it('emits project:dirty from markDirty', () => {
    const ctx = createEditorContext();
    let dirty = 0;
    ctx.bus.on('project:dirty', () => { dirty += 1; });
    ctx.project.markDirty();
    expect(dirty).toBe(1);
  });

  it('autosaves after markDirty and restores registered sections', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let yaw = 1;
    let restored: unknown;
    track({
      save: () => ({ yaw }),
      load(data) { restored = data; },
    }, 'camera');
    track({ save: () => ({ clips: [] }), load() {} }, 'timeline');
    const seeded = JSON.parse(writeProject(createWorld(), defaultLayout())) as {
      sections: Record<string, unknown>;
    };
    seeded.sections = { camera: { yaw: 9 }, ghost: { nope: true } };
    const storage = memoryStore({ [AUTOSAVE_STORAGE_KEY]: JSON.stringify(seeded) });
    const root = document.createElement('div');
    document.body.append(root);
    cleanups.push(() => root.remove());
    const editor = createEditor({ root, storage });
    cleanups.push(() => editor.dispose());
    expect(restored).toEqual({ yaw: 9 });
    expect(root.querySelector('.je-status')?.textContent).toContain('Skipped unknown project section "ghost"');
    expect(root.querySelector('.je-status')?.textContent).toContain('Skipped missing project section "timeline"');
    yaw = 4;
    editor.ctx.project.markDirty();
    editor.dispose();
    expect(readProject(storage.getItem(AUTOSAVE_STORAGE_KEY) ?? '')?.sections).toEqual({
      camera: { yaw: 4 },
      timeline: { clips: [] },
    });
    expect(warn).toHaveBeenCalled();
  });
});
