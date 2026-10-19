import type { EditorCommand } from './commands';
import type { EditorContext } from './context';
import { createEditorContext } from './context';
import {
  LAYOUT_STORAGE_KEY,
  PANEL,
  ZONES,
  defaultLayout,
  focusPanel,
  movePanel,
  serializeLayout,
  setSizes,
  setZoneCollapsed,
  tryParseLayout,
  type LayoutState,
  type ZoneId,
} from './layout';
import { registerConsolePanel } from './console';
import { ensurePlaceholderPanels } from './panels';
import { AUTOSAVE_STORAGE_KEY, applyWorldSnapshot, downloadText, readProject, writeProject } from './project';
import { getPanel, listPanels, subscribePanels } from './registry';
import { eventToShortcut, formatShortcut } from './shortcuts';
import { browserStore, type KeyValueStore } from './storage';
import { editorTitle } from './title';
import { createDefaultSnapshot } from './world';
import type { EditorWorld } from './world';

const PANEL_DRAG = 'application/x-jurfi-panel';

export interface Editor {
  readonly ctx: EditorContext;
  getLayout(): LayoutState;
  resetLayout(): void;
  dispose(): void;
}

export interface CreateEditorOptions {
  root: HTMLElement;
  world?: EditorWorld;
  storage?: KeyValueStore;
  restoreAutosave?: boolean;
  layoutKey?: string;
  autosaveKey?: string;
}

interface ZoneView {
  id: ZoneId;
  root: HTMLElement;
  tabs: HTMLElement;
  body: HTMLElement;
}

interface MenuItem {
  command?: string;
  separator?: boolean;
}

export function createEditor(options: CreateEditorOptions): Editor {
  if (!getPanel(PANEL.console)) registerConsolePanel();
  ensurePlaceholderPanels();
  const ctx = createEditorContext({ world: options.world });
  const storage = options.storage ?? browserStore();
  const layoutKey = options.layoutKey ?? LAYOUT_STORAGE_KEY;
  const autosaveKey = options.autosaveKey ?? AUTOSAVE_STORAGE_KEY;
  const cleanups: (() => void)[] = [];
  const zones = new Map<ZoneId, ZoneView>();
  const mounted = new Map<ZoneId, { id: string | null; dispose: () => void }>();
  let layout = loadLayout();
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let draggingId: string | null = null;
  let paletteIndex = 0;

  if (!document.documentElement.dataset.theme) document.documentElement.dataset.theme = 'dark';
  if (!document.documentElement.dataset.density) document.documentElement.dataset.density = 'cozy';

  const app = document.createElement('div');
  app.className = 'je-app';
  const menubar = document.createElement('nav');
  menubar.className = 'je-bar je-menubar';
  menubar.setAttribute('aria-label', 'Menu');
  const toolbar = document.createElement('div');
  toolbar.className = 'je-bar je-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Toolbar');
  const workspace = document.createElement('main');
  workspace.className = 'je-workspace';
  const left = document.createElement('div');
  left.className = 'je-left';
  const center = document.createElement('div');
  center.className = 'je-center';
  const splitLeft = splitter('vertical', 'Resize left column');
  const splitRight = splitter('vertical', 'Resize right column');
  const splitHier = splitter('horizontal', 'Resize hierarchy');
  const splitDock = splitter('horizontal', 'Resize dock');
  splitLeft.classList.add('je-split-left');
  splitRight.classList.add('je-split-right');
  splitDock.classList.add('je-dock-splitter');
  const dockHandle = document.createElement('button');
  dockHandle.type = 'button';
  dockHandle.className = 'je-dock-handle';
  const status = document.createElement('footer');
  status.className = 'je-status';
  const statusMessage = document.createElement('span');
  const statusPlay = document.createElement('span');
  const statusSelection = document.createElement('span');
  statusSelection.className = 'je-status-end';
  status.append(statusMessage, statusPlay, statusSelection);
  const palette = document.createElement('div');
  palette.className = 'je-palette';
  palette.setAttribute('role', 'dialog');
  palette.setAttribute('aria-modal', 'true');
  palette.setAttribute('aria-label', 'Command palette');
  palette.hidden = true;
  const paletteInput = document.createElement('input');
  paletteInput.className = 'je-field';
  paletteInput.type = 'text';
  paletteInput.placeholder = 'Type a command';
  paletteInput.setAttribute('aria-label', 'Filter commands');
  const paletteList = document.createElement('div');
  paletteList.className = 'je-palette-list';
  paletteList.setAttribute('role', 'listbox');
  palette.append(paletteInput, paletteList);
  const about = document.createElement('div');
  about.className = 'je-about';
  about.setAttribute('role', 'dialog');
  about.setAttribute('aria-modal', 'true');
  about.setAttribute('aria-label', 'About Jurfi');
  about.hidden = true;
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;

  const zoneIds: ZoneId[] = ['leftTop', 'leftBottom', 'center', 'right', 'bottom'];
  for (const id of zoneIds) {
    const view = createZone(id);
    zones.set(id, view);
  }
  const leftTop = zones.get('leftTop');
  const leftBottom = zones.get('leftBottom');
  const centerZone = zones.get('center');
  const rightZone = zones.get('right');
  const bottomZone = zones.get('bottom');
  if (!leftTop || !leftBottom || !centerZone || !rightZone || !bottomZone) {
    throw new Error('Editor zones failed to build');
  }
  left.append(leftTop.root, splitHier, leftBottom.root);
  center.append(centerZone.root);
  workspace.append(left, splitLeft, center, splitRight, rightZone.root, splitDock, dockHandle, bottomZone.root);
  app.append(menubar, toolbar, workspace, status, palette, about, fileInput);
  options.root.replaceChildren(app);

  bindDrag(splitLeft, (dx, origin) => {
    if (layout.zones.leftTop.collapsed && layout.zones.leftBottom.collapsed) return;
    layout = setSizes(layout, { left: origin.left + dx });
    applyMetrics();
  });
  bindDrag(splitRight, (dx, origin) => {
    layout = setZoneCollapsed(layout, 'right', false);
    layout = setSizes(layout, { right: origin.right - dx });
    applyMetrics();
  });
  bindDrag(splitHier, (_dx, origin, dy) => {
    const height = Math.max(1, left.getBoundingClientRect().height);
    layout = setZoneCollapsed(layout, 'leftTop', false);
    layout = setZoneCollapsed(layout, 'leftBottom', false);
    layout = setSizes(layout, { leftSplit: origin.leftSplit + dy / height });
    applyMetrics();
  });
  bindDrag(splitDock, (_dx, origin, dy) => {
    layout = setZoneCollapsed(layout, 'bottom', false);
    layout = setSizes(layout, { dock: origin.dock - dy });
    applyMetrics();
  });
  dockHandle.addEventListener('click', () => {
    commit(setZoneCollapsed(layout, 'bottom', !layout.zones.bottom.collapsed));
  });

  registerCommands();
  buildMenus();
  buildToolbar();
  buildAbout();
  paint(true);
  persist();
  statusMessage.textContent = 'Ready';
  syncChrome();

  cleanups.push(subscribePanels((id) => {
    const hits = ZONES.filter((zone) => layout.zones[zone].tabs.includes(id));
    if (hits.length === 0 && getPanel(id)) {
      commit(movePanel(layout, id, 'bottom'));
      return;
    }
    for (const zone of hits) {
      renderTabs(zone);
      mountActive(zone, true);
    }
  }));
  cleanups.push(ctx.bus.on('status', (event) => {
    statusMessage.textContent = event.message;
  }));
  cleanups.push(ctx.bus.on('play:changed', syncChrome));
  cleanups.push(ctx.bus.on('gizmo:changed', syncChrome));
  cleanups.push(ctx.selection.subscribe(syncChrome));
  cleanups.push(ctx.undo.subscribe(syncChrome));
  cleanups.push(ctx.world.subscribe(() => scheduleAutosave()));
  cleanups.push(ctx.bus.on('command:executed', syncChrome));

  const onKey = (event: KeyboardEvent): void => {
    const shortcut = eventToShortcut(event);
    if (!shortcut) return;
    if (shortcut === 'Mod+K') {
      event.preventDefault();
      if (palette.hidden) openPalette();
      else closePalette();
      return;
    }
    if (shortcut === 'Escape') {
      if (!palette.hidden) closePalette();
      if (!about.hidden) closeAbout();
      closeMenus();
      return;
    }
    if (!palette.hidden || !about.hidden) return;
    const target = event.target;
    const typing = target instanceof HTMLElement
      && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable);
    const editorShortcut = shortcut === 'Mod+S' || shortcut === 'Mod+Z' || shortcut === 'Mod+Shift+Z' || shortcut === 'Mod+Y';
    if (typing && !editorShortcut) return;
    if (shortcut === 'Mod+Y' || shortcut === 'Mod+Shift+Z') {
      event.preventDefault();
      ctx.commands.execute('edit.redo');
      return;
    }
    const match = ctx.commands.list().find((command) => command.shortcut === shortcut);
    if (!match) return;
    event.preventDefault();
    ctx.commands.execute(match.id);
  };
  const onPointer = (event: PointerEvent): void => {
    if (!(event.target instanceof Node)) return;
    if (!menubar.contains(event.target)) closeMenus();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onPointer);
  cleanups.push(() => window.removeEventListener('keydown', onKey));
  cleanups.push(() => window.removeEventListener('pointerdown', onPointer));

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    void file.text().then((text) => openProject(text, file.name));
  });
  paletteInput.addEventListener('input', () => {
    paletteIndex = 0;
    renderPalette();
  });
  paletteInput.addEventListener('keydown', (event) => {
    const commands = filteredCommands();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (commands.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      paletteIndex = (paletteIndex + step + commands.length) % commands.length;
      renderPalette();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = commands[paletteIndex];
      if (command && (!command.when || command.when())) runPalette(command.id);
    }
  });

  return {
    ctx,
    getLayout: () => layout,
    resetLayout,
    dispose() {
      flushAutosave();
      for (const zone of ZONES) mounted.get(zone)?.dispose();
      mounted.clear();
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      app.remove();
    },
  };

  function loadLayout(): LayoutState {
    const autosave = options.restoreAutosave === false ? null : storage.getItem(autosaveKey);
    const project = autosave ? readProject(autosave) : null;
    let next: LayoutState;
    if (project && !options.world) {
      ctx.world.deserialize(project.world);
      next = project.layout;
    } else if (project) {
      next = project.layout;
    } else {
      next = tryParseLayout(storage.getItem(layoutKey) ?? '') ?? defaultLayout();
    }
    for (const panel of listPanels()) {
      const placed = ZONES.some((zone) => next.zones[zone].tabs.includes(panel.id));
      if (!placed) next = movePanel(next, panel.id, 'bottom');
    }
    return next;
  }

  function splitter(orientation: 'vertical' | 'horizontal', label: string): HTMLElement {
    const element = document.createElement('div');
    element.className = orientation === 'vertical' ? 'je-splitter je-splitter-col' : 'je-splitter je-splitter-row';
    element.setAttribute('role', 'separator');
    element.setAttribute('aria-orientation', orientation);
    element.setAttribute('aria-label', label);
    return element;
  }

  function createZone(id: ZoneId): ZoneView {
    const root = document.createElement('section');
    root.className = id === 'bottom' ? 'je-zone je-dock' : 'je-zone';
    root.dataset.zone = id;
    const tabs = document.createElement('div');
    tabs.className = 'je-tabs';
    tabs.setAttribute('role', 'tablist');
    const body = document.createElement('div');
    body.className = 'je-zone-body';
    root.append(tabs, body);
    root.addEventListener('dragover', (event) => {
      if (!draggingId) return;
      event.preventDefault();
      root.classList.add('is-drop-target');
    });
    root.addEventListener('dragleave', (event) => {
      if (event.target === root) root.classList.remove('is-drop-target');
    });
    root.addEventListener('drop', (event) => {
      const panelId = event.dataTransfer?.getData(PANEL_DRAG) || draggingId;
      root.classList.remove('is-drop-target');
      if (!panelId) return;
      event.preventDefault();
      commit(movePanel(layout, panelId, id));
    });
    return { id, root, tabs, body };
  }

  function bindDrag(
    element: HTMLElement,
    onMove: (dx: number, origin: { left: number; right: number; leftSplit: number; dock: number }, dy: number) => void,
  ): void {
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const origin = { ...layout.sizes };
      const move = (ev: PointerEvent): void => onMove(ev.clientX - event.clientX, origin, ev.clientY - event.clientY);
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        persist();
        ctx.bus.emit('layout:changed', { layout });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function applyMetrics(): void {
    app.style.setProperty('--split-left', `${layout.sizes.left}px`);
    app.style.setProperty('--split-right', `${layout.sizes.right}px`);
    app.style.setProperty('--split-hier-h', `${layout.sizes.leftSplit * 100}%`);
    app.style.setProperty('--dock-h', `${layout.sizes.dock}px`);
    workspace.dataset.rightCollapsed = String(layout.zones.right.collapsed);
    workspace.dataset.dockCollapsed = String(layout.zones.bottom.collapsed);
    left.dataset.topCollapsed = String(layout.zones.leftTop.collapsed);
    left.dataset.bottomCollapsed = String(layout.zones.leftBottom.collapsed);
    for (const zone of ZONES) {
      zones.get(zone)?.root.classList.toggle('is-collapsed', layout.zones[zone].collapsed);
    }
    const activeDock = layout.zones.bottom.active;
    const dockTitle = activeDock ? (getPanel(activeDock)?.title ?? activeDock) : 'Dock';
    dockHandle.replaceChildren();
    const handleText = document.createElement('span');
    handleText.textContent = layout.zones.bottom.collapsed ? `Show ${dockTitle}` : dockTitle;
    const chevron = document.createElement('span');
    chevron.className = 'je-dock-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    dockHandle.append(handleText, chevron);
    dockHandle.setAttribute('aria-expanded', layout.zones.bottom.collapsed ? 'false' : 'true');
  }

  function renderTabs(zoneId: ZoneId): void {
    const view = zones.get(zoneId);
    if (!view) return;
    const state = layout.zones[zoneId];
    view.tabs.replaceChildren();
    for (const panelId of state.tabs) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'je-tab';
      tab.role = 'tab';
      tab.draggable = true;
      tab.dataset.panel = panelId;
      tab.textContent = getPanel(panelId)?.title ?? panelId;
      tab.setAttribute('aria-selected', state.active === panelId ? 'true' : 'false');
      tab.addEventListener('click', () => commit(focusPanel(layout, panelId)));
      tab.addEventListener('dragstart', (event) => {
        draggingId = panelId;
        event.dataTransfer?.setData(PANEL_DRAG, panelId);
        event.dataTransfer?.setData('text/plain', panelId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      tab.addEventListener('dragend', () => {
        draggingId = null;
        view.root.classList.remove('is-drop-target');
      });
      tab.addEventListener('dragover', (event) => {
        if (!draggingId) return;
        event.preventDefault();
        event.stopPropagation();
      });
      tab.addEventListener('drop', (event) => {
        const panel = event.dataTransfer?.getData(PANEL_DRAG) || draggingId;
        if (!panel) return;
        event.preventDefault();
        event.stopPropagation();
        const index = state.tabs.indexOf(panelId);
        commit(movePanel(layout, panel, zoneId, index < 0 ? undefined : index));
      });
      view.tabs.append(tab);
    }
    if (zoneId !== 'center' && zoneId !== 'bottom') {
      const collapse = document.createElement('button');
      collapse.type = 'button';
      collapse.className = 'je-collapse';
      const title = state.active ? (getPanel(state.active)?.title ?? state.active) : 'panel';
      collapse.setAttribute('aria-label', state.collapsed ? `Expand ${title}` : `Collapse ${title}`);
      collapse.textContent = state.collapsed ? '+' : '–';
      collapse.addEventListener('click', () => commit(setZoneCollapsed(layout, zoneId, !state.collapsed)));
      view.tabs.append(collapse);
    }
    if (state.tabs.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'je-tab-empty';
      empty.textContent = 'Drop a tab';
      view.tabs.append(empty);
    }
  }

  function mountActive(zoneId: ZoneId, force: boolean): void {
    const view = zones.get(zoneId);
    if (!view) return;
    const active = layout.zones[zoneId].active;
    const previous = mounted.get(zoneId);
    if (!force && previous?.id === active) return;
    previous?.dispose();
    view.body.replaceChildren();
    if (!active) {
      const hint = document.createElement('p');
      hint.className = 'je-muted je-drop-hint';
      hint.textContent = 'Drag a tab here.';
      view.body.append(hint);
      mounted.set(zoneId, { id: null, dispose() {} });
      return;
    }
    const definition = getPanel(active);
    if (!definition) {
      const missing = document.createElement('p');
      missing.className = 'je-muted je-drop-hint';
      missing.textContent = `No panel registered for "${active}".`;
      view.body.append(missing);
      mounted.set(zoneId, { id: active, dispose() {} });
      return;
    }
    let dispose: (() => void) | undefined;
    try {
      const result = definition.mount(view.body, ctx);
      if (typeof result === 'function') dispose = result;
    } catch (error) {
      view.body.textContent = error instanceof Error ? error.message : 'Panel failed to mount.';
    }
    mounted.set(zoneId, { id: active, dispose: dispose ?? (() => {}) });
  }

  function paint(force: boolean): void {
    applyMetrics();
    for (const zone of ZONES) {
      renderTabs(zone);
      mountActive(zone, force);
    }
  }

  function changedZones(previous: LayoutState, next: LayoutState): ZoneId[] {
    return ZONES.filter((zone) => {
      const before = previous.zones[zone];
      const after = next.zones[zone];
      if (before.active !== after.active || before.tabs.length !== after.tabs.length) return true;
      return before.tabs.some((id, index) => id !== after.tabs[index]);
    });
  }

  function commit(next: LayoutState): void {
    const previous = layout;
    layout = next;
    applyMetrics();
    const dirty = changedZones(previous, next);
    for (const zone of ZONES) {
      if (dirty.includes(zone) || previous.zones[zone].collapsed !== layout.zones[zone].collapsed) renderTabs(zone);
    }
    for (const zone of dirty) mountActive(zone, true);
    persist();
    ctx.bus.emit('layout:changed', { layout });
  }

  function persist(): void {
    try {
      storage.setItem(layoutKey, serializeLayout(layout));
    } catch {
      ctx.bus.emit('status', { message: 'Could not store the layout locally', level: 'warn' });
    }
    scheduleAutosave();
  }

  function scheduleAutosave(): void {
    if (autosaveTimer !== undefined) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = undefined;
      flushAutosave();
    }, 300);
  }

  function flushAutosave(): void {
    if (autosaveTimer !== undefined) {
      clearTimeout(autosaveTimer);
      autosaveTimer = undefined;
    }
    try {
      storage.setItem(autosaveKey, writeProject(ctx.world, layout));
    } catch {
      ctx.bus.emit('status', { message: 'Could not autosave the project', level: 'warn' });
    }
  }

  function resetLayout(): void {
    storage.removeItem(layoutKey);
    layout = defaultLayout(listPanels().map((panel) => panel.id));
    paint(true);
    persist();
    ctx.bus.emit('layout:reset', { layout });
    ctx.bus.emit('layout:changed', { layout });
    ctx.bus.emit('status', { message: 'Layout reset', level: 'info' });
  }

  function openProject(text: string, name: string): void {
    const project = readProject(text);
    if (!project) {
      ctx.bus.emit('status', { message: 'Could not read that project file', level: 'error' });
      return;
    }
    applyWorldSnapshot(ctx, project.world);
    layout = project.layout;
    paint(true);
    flushAutosave();
    try {
      storage.setItem(layoutKey, serializeLayout(layout));
    } catch {
      /* autosave already reported */
    }
    ctx.bus.emit('project:loaded', { name });
    ctx.bus.emit('status', { message: `Opened ${name}`, level: 'info' });
  }

  function saveProject(): void {
    const json = writeProject(ctx.world, layout);
    downloadText('project.jurfi.json', json);
    flushAutosave();
    ctx.bus.emit('project:saved', { name: 'project.jurfi.json' });
    ctx.bus.emit('status', { message: 'Saved project.jurfi.json', level: 'info' });
  }

  function register(command: EditorCommand): void {
    cleanups.push(ctx.commands.register(command));
  }

  function registerCommands(): void {
    register({ id: 'file.new', title: 'New Project', group: 'File', run: () => {
      applyWorldSnapshot(ctx, createDefaultSnapshot());
      ctx.selection.set([]);
      ctx.bus.emit('status', { message: 'New project', level: 'info' });
    } });
    register({ id: 'file.open', title: 'Open Project…', group: 'File', run: () => fileInput.click() });
    register({
      id: 'file.save',
      title: 'Save Project',
      group: 'File',
      shortcut: 'Mod+S',
      run: saveProject,
    });
    register({
      id: 'edit.undo',
      title: 'Undo',
      group: 'Edit',
      shortcut: 'Mod+Z',
      when: () => ctx.undo.canUndo(),
      run: () => { ctx.undo.undo(); },
    });
    register({
      id: 'edit.redo',
      title: 'Redo',
      group: 'Edit',
      shortcut: 'Mod+Shift+Z',
      when: () => ctx.undo.canRedo(),
      run: () => { ctx.undo.redo(); },
    });
    register({ id: 'view.command-palette', title: 'Command Palette', group: 'View', shortcut: 'Mod+K', run: () => openPalette() });
    register({ id: 'view.reset-layout', title: 'Reset Layout', group: 'View', run: resetLayout });
    register({
      id: 'view.toggle-dock',
      title: 'Toggle Dock',
      group: 'View',
      run: () => commit(setZoneCollapsed(layout, 'bottom', !layout.zones.bottom.collapsed)),
    });
    const focus: [string, string, string][] = [
      ['view.focus.viewport', 'Show Viewport', PANEL.viewport],
      ['view.focus.hierarchy', 'Show Hierarchy', PANEL.hierarchy],
      ['view.focus.inspector', 'Show Inspector', PANEL.inspector],
      ['view.focus.assets', 'Show Asset Browser', PANEL.assets],
      ['view.focus.nodegraph', 'Show Node Graph', PANEL.nodeGraph],
      ['view.focus.timeline', 'Show Timeline', PANEL.timeline],
      ['view.focus.console', 'Show Console', PANEL.console],
    ];
    for (const [id, title, panelId] of focus) {
      register({ id, title, group: 'View', run: () => commit(focusPanel(layout, panelId)) });
    }
    register({
      id: 'play.play',
      title: 'Play',
      group: 'Play',
      when: () => ctx.getPlayState() !== 'playing',
      run: () => ctx.play(),
    });
    register({
      id: 'play.pause',
      title: 'Pause',
      group: 'Play',
      when: () => ctx.getPlayState() === 'playing',
      run: () => ctx.pause(),
    });
    register({
      id: 'play.stop',
      title: 'Stop',
      group: 'Play',
      when: () => ctx.getPlayState() !== 'editing',
      run: () => ctx.stop(),
    });
    register({ id: 'play.step', title: 'Step', group: 'Play', run: () => ctx.step() });
    register({ id: 'gizmo.translate', title: 'Move', group: 'Gizmo', run: () => ctx.setGizmoMode('translate') });
    register({ id: 'gizmo.rotate', title: 'Rotate', group: 'Gizmo', run: () => ctx.setGizmoMode('rotate') });
    register({ id: 'gizmo.scale', title: 'Scale', group: 'Gizmo', run: () => ctx.setGizmoMode('scale') });
    register({
      id: 'help.about',
      title: 'About Jurfi',
      group: 'Help',
      run: () => openAbout(),
    });
  }

  function buildMenus(): void {
    const menus: { label: string; items: MenuItem[] }[] = [
      { label: 'File', items: [{ command: 'file.new' }, { command: 'file.open' }, { command: 'file.save' }] },
      { label: 'Edit', items: [{ command: 'edit.undo' }, { command: 'edit.redo' }] },
      { label: 'Assets', items: [{ command: 'view.focus.assets' }] },
      { label: 'Node', items: [{ command: 'view.focus.nodegraph' }, { command: 'view.focus.timeline' }] },
      {
        label: 'View',
        items: [
          { command: 'view.command-palette' },
          { command: 'view.reset-layout' },
          { command: 'view.toggle-dock' },
          { separator: true },
          { command: 'view.focus.viewport' },
          { command: 'view.focus.hierarchy' },
          { command: 'view.focus.inspector' },
          { command: 'view.focus.console' },
        ],
      },
      { label: 'Help', items: [{ command: 'help.about' }] },
    ];
    for (const menu of menus) {
      const wrap = document.createElement('div');
      wrap.className = 'je-menu';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = menu.label;
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
      const list = document.createElement('div');
      list.className = 'je-menu-list';
      list.setAttribute('role', 'menu');
      button.addEventListener('click', () => {
        const willOpen = !wrap.classList.contains('is-open');
        closeMenus();
        if (!willOpen) return;
        fillMenu(list, menu.items);
        wrap.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
      });
      wrap.append(button, list);
      menubar.append(wrap);
    }
  }

  function fillMenu(list: HTMLElement, items: MenuItem[]): void {
    list.replaceChildren();
    for (const item of items) {
      if (item.separator) {
        const rule = document.createElement('div');
        rule.className = 'je-menu-sep';
        rule.setAttribute('role', 'separator');
        list.append(rule);
        continue;
      }
      if (!item.command) continue;
      const command = ctx.commands.get(item.command);
      if (!command) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'je-menu-item';
      button.setAttribute('role', 'menuitem');
      const label = document.createElement('span');
      label.textContent = menuLabel(command);
      button.append(label);
      if (command.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'je-menu-shortcut';
        shortcut.textContent = formatShortcut(command.shortcut);
        button.append(shortcut);
      }
      const enabled = !command.when || command.when();
      button.disabled = !enabled;
      button.addEventListener('click', () => {
        closeMenus();
        ctx.commands.execute(command.id);
      });
      list.append(button);
    }
  }

  function menuLabel(command: EditorCommand): string {
    if (command.id === 'edit.undo') {
      const label = ctx.undo.undoLabel();
      return label ? `Undo ${label}` : 'Undo';
    }
    if (command.id === 'edit.redo') {
      const label = ctx.undo.redoLabel();
      return label ? `Redo ${label}` : 'Redo';
    }
    return command.title;
  }

  function closeMenus(): void {
    for (const menu of menubar.querySelectorAll('.je-menu.is-open')) {
      menu.classList.remove('is-open');
      menu.querySelector('button')?.setAttribute('aria-expanded', 'false');
    }
  }

  function buildToolbar(): void {
    const groups: { id: string; label: string; primary?: boolean }[][] = [
      [
        { id: 'play.play', label: '▶ Play', primary: true },
        { id: 'play.pause', label: 'Pause' },
        { id: 'play.stop', label: 'Stop' },
        { id: 'play.step', label: 'Step' },
      ],
      [
        { id: 'gizmo.translate', label: 'Move' },
        { id: 'gizmo.rotate', label: 'Rotate' },
        { id: 'gizmo.scale', label: 'Scale' },
      ],
    ];
    groups.forEach((group, index) => {
      if (index > 0) {
        const gap = document.createElement('span');
        gap.className = 'je-toolbar-gap';
        toolbar.append(gap);
      }
      for (const item of group) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = item.id;
        button.textContent = item.label;
        if (item.primary) button.classList.add('is-primary');
        button.addEventListener('click', () => ctx.commands.execute(item.id));
        toolbar.append(button);
      }
    });
  }

  function syncChrome(): void {
    const play = ctx.getPlayState();
    statusPlay.textContent = play === 'editing' ? 'Editing' : play === 'playing' ? 'Playing' : 'Paused';
    const ids = ctx.selection.get();
    const primary = ids[0] ? ctx.world.get(ids[0]) : undefined;
    statusSelection.textContent = !primary
      ? 'No selection'
      : ids.length > 1
        ? `${primary.name} +${ids.length - 1}`
        : primary.name;
    for (const button of toolbar.querySelectorAll('button')) {
      const id = button.dataset.command;
      if (!id) continue;
      const command = ctx.commands.get(id);
      button.disabled = command?.when ? !command.when() : false;
      if (id === 'play.play') button.setAttribute('aria-pressed', play === 'playing' ? 'true' : 'false');
      if (id.startsWith('gizmo.')) {
        const mode = id.slice('gizmo.'.length);
        button.setAttribute('aria-pressed', ctx.getGizmoMode() === mode ? 'true' : 'false');
      }
    }
    const playButton = toolbar.querySelector('[data-command="play.play"]');
    if (playButton) playButton.classList.toggle('is-primary', play !== 'playing');
  }

  function filteredCommands(): EditorCommand[] {
    const query = paletteInput.value.trim().toLowerCase();
    return ctx.commands.list()
      .filter((command) => {
        if (!query) return true;
        return command.title.toLowerCase().includes(query) || command.id.toLowerCase().includes(query);
      })
      .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.title.localeCompare(b.title));
  }

  function renderPalette(): void {
    const commands = filteredCommands();
    if (paletteIndex >= commands.length) paletteIndex = Math.max(0, commands.length - 1);
    paletteList.replaceChildren();
    if (commands.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'je-muted';
      empty.textContent = 'No matching commands.';
      paletteList.append(empty);
      return;
    }
    let lastGroup = '';
    commands.forEach((command, index) => {
      const group = command.group ?? 'Other';
      if (group !== lastGroup) {
        lastGroup = group;
        const heading = document.createElement('div');
        heading.className = 'je-palette-group';
        heading.textContent = group;
        paletteList.append(heading);
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'je-palette-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === paletteIndex ? 'true' : 'false');
      const enabled = !command.when || command.when();
      if (!enabled) row.disabled = true;
      const label = document.createElement('span');
      label.textContent = command.title;
      row.append(label);
      if (command.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'je-menu-shortcut';
        shortcut.textContent = formatShortcut(command.shortcut);
        row.append(shortcut);
      }
      row.addEventListener('mouseenter', () => {
        if (paletteIndex === index) return;
        paletteIndex = index;
        for (const item of paletteList.querySelectorAll('.je-palette-item')) {
          item.setAttribute('aria-selected', item === row ? 'true' : 'false');
        }
      });
      row.addEventListener('click', () => runPalette(command.id));
      paletteList.append(row);
    });
  }

  function runPalette(id: string): void {
    closePalette();
    ctx.commands.execute(id);
  }

  function openPalette(): void {
    closeMenus();
    closeAbout();
    palette.hidden = false;
    paletteInput.value = '';
    paletteIndex = 0;
    renderPalette();
    paletteInput.focus();
  }

  function closePalette(): void {
    palette.hidden = true;
  }

  function buildAbout(): void {
    const card = document.createElement('div');
    card.className = 'je-about-card';
    const title = document.createElement('h2');
    title.textContent = editorTitle();
    const body = document.createElement('p');
    body.textContent = 'Panels marked Placeholder are stand-ins. Register the same id to replace one.';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'je-about-close';
    close.textContent = 'Close';
    close.addEventListener('click', closeAbout);
    card.append(title, body, close);
    about.append(card);
    about.addEventListener('click', (event) => {
      if (event.target === about) closeAbout();
    });
  }

  function openAbout(): void {
    closePalette();
    about.hidden = false;
  }

  function closeAbout(): void {
    about.hidden = true;
  }
}
