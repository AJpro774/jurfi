import { clamp } from '@jurfi/core';

export const LAYOUT_VERSION = 1 as const;
export const LAYOUT_STORAGE_KEY = 'jurfi.editor.layout';

export const ZONES = ['leftTop', 'leftBottom', 'center', 'right', 'bottom'] as const;
export type ZoneId = (typeof ZONES)[number];

/** Stable ids. Registering the same id replaces the placeholder. */
export const PANEL = {
  hierarchy: 'hierarchy',
  assets: 'assets',
  viewport: 'viewport',
  nodeGraph: 'nodegraph',
  timeline: 'timeline',
  inspector: 'inspector',
  console: 'console',
} as const;

export const STANDARD_PANELS: readonly string[] = [
  PANEL.hierarchy,
  PANEL.assets,
  PANEL.viewport,
  PANEL.nodeGraph,
  PANEL.timeline,
  PANEL.inspector,
  PANEL.console,
];

export interface ZoneState {
  tabs: string[];
  active: string | null;
  collapsed: boolean;
}

export interface LayoutSizes {
  left: number;
  right: number;
  /** Fraction of the left column given to the top zone, between 0.15 and 0.85. */
  leftSplit: number;
  dock: number;
}

export interface LayoutState {
  version: typeof LAYOUT_VERSION;
  zones: Record<ZoneId, ZoneState>;
  sizes: LayoutSizes;
}

const SIZE_LIMITS: Record<keyof LayoutSizes, readonly [number, number]> = {
  left: [160, 640],
  right: [160, 640],
  leftSplit: [0.15, 0.85],
  dock: [80, 640],
};

const DEFAULT_SIZES: LayoutSizes = {
  left: 240,
  right: 280,
  leftSplit: 0.5,
  dock: 200,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneZone(zone: ZoneState): ZoneState {
  return { tabs: [...zone.tabs], active: zone.active, collapsed: zone.collapsed };
}

export function cloneLayout(state: LayoutState): LayoutState {
  return {
    version: LAYOUT_VERSION,
    sizes: { ...state.sizes },
    zones: {
      leftTop: cloneZone(state.zones.leftTop),
      leftBottom: cloneZone(state.zones.leftBottom),
      center: cloneZone(state.zones.center),
      right: cloneZone(state.zones.right),
      bottom: cloneZone(state.zones.bottom),
    },
  };
}

function zone(tabs: string[], active = tabs[0] ?? null): ZoneState {
  return { tabs, active, collapsed: false };
}

export function defaultLayout(extraPanelIds: readonly string[] = []): LayoutState {
  const zones: Record<ZoneId, ZoneState> = {
    leftTop: zone([PANEL.hierarchy]),
    leftBottom: zone([PANEL.assets]),
    center: zone([PANEL.viewport, PANEL.nodeGraph, PANEL.timeline], PANEL.viewport),
    right: zone([PANEL.inspector]),
    bottom: zone([PANEL.console]),
  };
  const placed = new Set<string>(STANDARD_PANELS);
  for (const id of extraPanelIds) {
    if (placed.has(id)) continue;
    zones.bottom.tabs.push(id);
    placed.add(id);
  }
  return { version: LAYOUT_VERSION, sizes: { ...DEFAULT_SIZES }, zones };
}

function clampSize(key: keyof LayoutSizes, value: number): number {
  const limits = SIZE_LIMITS[key];
  return clamp(value, limits[0], limits[1]);
}

export function setSizes(state: LayoutState, patch: Partial<LayoutSizes>): LayoutState {
  const next = cloneLayout(state);
  (Object.keys(patch) as (keyof LayoutSizes)[]).forEach((key) => {
    const value = patch[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    next.sizes[key] = clampSize(key, value);
  });
  return next;
}

export function setActiveTab(state: LayoutState, zoneId: ZoneId, panelId: string): LayoutState {
  if (!state.zones[zoneId].tabs.includes(panelId)) return state;
  const next = cloneLayout(state);
  next.zones[zoneId].active = panelId;
  return next;
}

export function setZoneCollapsed(state: LayoutState, zoneId: ZoneId, collapsed: boolean): LayoutState {
  if (state.zones[zoneId].collapsed === collapsed) return state;
  const next = cloneLayout(state);
  next.zones[zoneId].collapsed = collapsed;
  return next;
}

export function focusPanel(state: LayoutState, panelId: string): LayoutState {
  const zoneId = ZONES.find((id) => state.zones[id].tabs.includes(panelId));
  if (!zoneId) return state;
  return setZoneCollapsed(setActiveTab(state, zoneId, panelId), zoneId, false);
}

/**
 * Move a tab into `toZone`. `index` is the destination index before the removal
 * (drop-on-tab). Omit it to append. The moved tab becomes active and the
 * destination zone expands.
 */
export function movePanel(state: LayoutState, panelId: string, toZone: ZoneId, index?: number): LayoutState {
  const next = cloneLayout(state);
  let from: ZoneId | null = null;
  let fromIndex = -1;
  for (const zoneId of ZONES) {
    const at = next.zones[zoneId].tabs.indexOf(panelId);
    if (at < 0) continue;
    next.zones[zoneId].tabs.splice(at, 1);
    if (next.zones[zoneId].active === panelId) {
      const tabs = next.zones[zoneId].tabs;
      next.zones[zoneId].active = tabs[Math.min(at, tabs.length - 1)] ?? null;
    }
    from = zoneId;
    fromIndex = at;
  }
  const dest = next.zones[toZone];
  let insertAt = index === undefined ? dest.tabs.length : Math.max(0, Math.min(index, dest.tabs.length));
  if (from === toZone && fromIndex >= 0 && fromIndex < insertAt) insertAt -= 1;
  dest.tabs.splice(insertAt, 0, panelId);
  dest.active = panelId;
  dest.collapsed = false;
  return next;
}

function dedupe(state: LayoutState): void {
  const seen = new Set<string>();
  for (const zoneId of ZONES) {
    const zoneState = state.zones[zoneId];
    zoneState.tabs = zoneState.tabs.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (zoneState.active === null || !zoneState.tabs.includes(zoneState.active)) {
      zoneState.active = zoneState.tabs[0] ?? null;
    }
  }
}

function parseZone(value: unknown): ZoneState | null {
  if (!isRecord(value) || !Array.isArray(value.tabs) || typeof value.collapsed !== 'boolean') return null;
  const tabs = value.tabs.filter((tab): tab is string => typeof tab === 'string' && tab.length > 0);
  const active = typeof value.active === 'string' ? value.active : null;
  return { tabs, active, collapsed: value.collapsed };
}

function parseSizes(value: unknown): LayoutSizes | null {
  if (!isRecord(value)) return null;
  const sizes = { ...DEFAULT_SIZES };
  for (const key of Object.keys(SIZE_LIMITS) as (keyof LayoutSizes)[]) {
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    sizes[key] = clampSize(key, raw);
  }
  return sizes;
}

export function parseLayout(value: unknown): LayoutState | null {
  if (!isRecord(value) || value.version !== LAYOUT_VERSION || !isRecord(value.zones)) return null;
  const zones = {} as Record<ZoneId, ZoneState>;
  for (const zoneId of ZONES) {
    const parsed = parseZone(value.zones[zoneId]);
    if (!parsed) return null;
    zones[zoneId] = parsed;
  }
  const sizes = parseSizes(value.sizes);
  if (!sizes) return null;
  const state: LayoutState = { version: LAYOUT_VERSION, zones, sizes };
  dedupe(state);
  return state;
}

export function serializeLayout(state: LayoutState): string {
  return JSON.stringify(state);
}

export function tryParseLayout(json: string): LayoutState | null {
  try {
    return parseLayout(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}
