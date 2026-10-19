// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorContext } from './context';
import { defaultLayout } from './layout';
import { GRAPH_AUTOSAVE_KEY } from './node-graph/mount';
import { createEmptyGraph, serializeGraph } from './node-graph/serialize';
import { applyProjectSections, readProject, writeProject } from './project';
import { registerNodeGraphPanel } from './node-graph';
import { registerTimelinePanel } from './timeline/register';
import { readCameraDocument, replaceCameraDocument } from './viewport/camera-document';
import { registerViewportPanel } from './viewport/register';
import { createWorld } from './world';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('project file sections', () => {
  it('saves the node graph, timeline, and camera, and migrates the legacy graph key', () => {
    const legacy = createEmptyGraph();
    localStorage.setItem(GRAPH_AUTOSAVE_KEY, serializeGraph(legacy));
    cleanups.push(registerNodeGraphPanel(), registerTimelinePanel(), registerViewportPanel());
    const project = readProject(writeProject(createWorld(), defaultLayout()));
    expect(project?.sections.nodegraph).toMatchObject({ nodes: [], edges: [] });
    expect(project?.sections.timeline).toMatchObject({ clip: { id: 'hero-intro' }, time: 0 });
    expect(project?.sections.camera).toMatchObject({ view: '3d' });

    const camera = readCameraDocument();
    camera.orbit.yaw = 1.25;
    camera.view = '2d';
    const warnings = applyProjectSections({
      nodegraph: project?.sections.nodegraph,
      timeline: { clip: { id: 'nope' } },
      camera,
    });
    expect(warnings.map((warning) => warning.id)).toEqual([]);
    expect(readCameraDocument().view).toBe('2d');
    expect(readCameraDocument().orbit.yaw).toBe(1.25);
    expect(localStorage.getItem(GRAPH_AUTOSAVE_KEY)).toBeNull();
    const saved = readProject(writeProject(createWorld(), defaultLayout()));
    expect(saved?.sections.camera).toMatchObject({ view: '2d', orbit: { yaw: 1.25 } });
    expect(saved?.sections.timeline).toMatchObject({ clip: { id: 'hero-intro' } });
  });

  it('marks the project dirty when the camera document changes', () => {
    cleanups.push(registerViewportPanel());
    const ctx = createEditorContext();
    let dirty = 0;
    ctx.bus.on('project:dirty', () => { dirty += 1; });
    const next = readCameraDocument();
    next.orbit.distance = 12;
    replaceCameraDocument(next);
    ctx.project.markDirty();
    expect(dirty).toBe(1);
    expect(readProject(writeProject(ctx.world, defaultLayout()))?.sections.camera).toMatchObject({
      orbit: { distance: 12 },
    });
  });
});
