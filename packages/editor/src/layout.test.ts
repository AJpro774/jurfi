import { describe, expect, it } from 'vitest';
import { createEditorContext, createWorld } from './index';
import {
  defaultLayout,
  focusPanel,
  movePanel,
  PANEL,
  serializeLayout,
  setSizes,
  setZoneCollapsed,
  tryParseLayout,
  ZONES,
} from './layout';
import { readProject, writeProject } from './project';

describe('layout serialization', () => {
  it('round-trips the default layout', () => {
    const layout = defaultLayout();
    const parsed = tryParseLayout(serializeLayout(layout));
    expect(parsed).toEqual(layout);
  });

  it('places every standard panel and appends unknown ids to the dock', () => {
    const layout = defaultLayout(['shader-graph']);
    const tabs = ZONES.flatMap((zone) => layout.zones[zone].tabs);
    expect(tabs).toEqual([
      PANEL.hierarchy,
      PANEL.assets,
      PANEL.viewport,
      PANEL.nodeGraph,
      PANEL.timeline,
      PANEL.inspector,
      PANEL.console,
      'shader-graph',
    ]);
    expect(layout.zones.center.active).toBe(PANEL.viewport);
  });

  it('rejects invalid json, the wrong version, and a missing zone', () => {
    expect(tryParseLayout('not json')).toBeNull();
    expect(tryParseLayout(JSON.stringify({ version: 2 }))).toBeNull();
    const broken = defaultLayout();
    const raw = JSON.parse(serializeLayout(broken)) as { zones: Record<string, unknown> };
    delete raw.zones.bottom;
    expect(tryParseLayout(JSON.stringify(raw))).toBeNull();
  });

  it('clamps sizes and drops duplicate tabs while parsing', () => {
    const layout = defaultLayout();
    layout.sizes.left = 9999;
    layout.sizes.leftSplit = 0;
    layout.zones.bottom.tabs.push(PANEL.viewport);
    layout.zones.center.active = 'missing';
    const parsed = tryParseLayout(serializeLayout(layout));
    expect(parsed?.sizes.left).toBe(640);
    expect(parsed?.sizes.leftSplit).toBe(0.15);
    expect(parsed?.zones.bottom.tabs).toEqual([PANEL.console]);
    expect(parsed?.zones.center.active).toBe(PANEL.viewport);
  });

  it('moves tabs between zones and repairs the source selection', () => {
    const layout = movePanel(defaultLayout(), PANEL.timeline, 'bottom', 0);
    expect(layout.zones.center.tabs).toEqual([PANEL.viewport, PANEL.nodeGraph]);
    expect(layout.zones.center.active).toBe(PANEL.viewport);
    expect(layout.zones.bottom.tabs).toEqual([PANEL.timeline, PANEL.console]);
    expect(layout.zones.bottom.active).toBe(PANEL.timeline);
    expect(layout.zones.bottom.collapsed).toBe(false);
  });

  it('reorders a tab inside one zone using the pre-removal index', () => {
    const layout = movePanel(defaultLayout(), PANEL.viewport, 'center', 2);
    expect(layout.zones.center.tabs).toEqual([PANEL.nodeGraph, PANEL.viewport, PANEL.timeline]);
    expect(layout.zones.center.active).toBe(PANEL.viewport);
  });

  it('focuses a panel by expanding its zone and clamps a resize', () => {
    const collapsed = setZoneCollapsed(defaultLayout(), 'right', true);
    const focused = focusPanel(collapsed, PANEL.inspector);
    expect(focused.zones.right.collapsed).toBe(false);
    expect(focused.zones.right.active).toBe(PANEL.inspector);
    expect(setSizes(focused, { dock: 10, right: Number.NaN }).sizes).toMatchObject({
      dock: 80,
      right: focused.sizes.right,
    });
  });
});

describe('project serialization', () => {
  it('writes the world and layout and reads them back', () => {
    const ctx = createEditorContext();
    ctx.world.update('player', { name: 'Hero' });
    const layout = movePanel(defaultLayout(), PANEL.inspector, 'bottom', 1);
    const json = writeProject(ctx.world, layout);
    const project = readProject(json);
    expect(project?.world.entities.find((entity) => entity.id === 'player')?.name).toBe('Hero');
    expect(project?.layout).toEqual(layout);
    expect(project?.sections).toEqual({});
    const restored = createWorld(project?.world);
    expect(restored.get('camera')?.parentId).toBe('scene');
  });

  it('rejects a project with a bad world or layout', () => {
    expect(readProject('{}')).toBeNull();
    const ctx = createEditorContext();
    const parsed = JSON.parse(writeProject(ctx.world, defaultLayout())) as { world: { entities: unknown } };
    parsed.world.entities = [{ id: 'x' }];
    expect(readProject(JSON.stringify(parsed))).toBeNull();
  });
});
