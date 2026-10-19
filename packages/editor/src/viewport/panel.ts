import './viewport.css';
import type { GizmoSpace } from './gizmo-math';
import { createPalette, readPalette } from './colors';
import type { IdBufferPicker } from './picking';
import { mountScene } from './scene';
import type { SceneHandle } from './scene';
import { shortcutFromKey } from './shortcuts';
import type { Shortcut } from './shortcuts';
import type { EditorContext } from '../context';
import type { GizmoMode, ShadingMode, ViewMode } from './types';

const scenes = new WeakMap<HTMLElement, SceneHandle>();

/** Attach an ID-buffer picker once @jurfi/render can resolve entity ids. Null keeps the raycast fallback. */
export function setViewportIdBuffer(host: HTMLElement, picker: IdBufferPicker | null): void {
  const panel = host.classList.contains('jurfi-viewport') ? host : host.querySelector('.jurfi-viewport');
  if (panel instanceof HTMLElement) scenes.get(panel)?.setIdBufferPicker(picker);
}

export function mountViewportPanel(host: HTMLElement, ctx: EditorContext): () => void {
  const doc = host.ownerDocument;
  const root = doc.createElement('section');
  root.className = 'jurfi-viewport';
  root.setAttribute('aria-label', 'Viewport');

  const toolbar = doc.createElement('div');
  toolbar.className = 'jurfi-viewport-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Viewport tools');

  const view2d = button(doc, '2D', 'Orthographic view (2)');
  const view3d = button(doc, '3D', 'Perspective view (3)');
  const move = button(doc, 'Move', 'Translate (W)');
  const rotate = button(doc, 'Rotate', 'Rotate (E)');
  const scale = button(doc, 'Scale', 'Scale (R)');
  const local = button(doc, 'Local', 'Local axes (L)');
  const world = button(doc, 'World', 'World axes (L)');
  const snapToggle = button(doc, 'Snap', 'Toggle snapping (M)');
  const snapInput = doc.createElement('input');
  snapInput.className = 'jurfi-viewport-snap';
  snapInput.type = 'number';
  snapInput.min = '0';
  snapInput.step = 'any';
  const lit = button(doc, 'Lit', 'Lit shading');
  const unlit = button(doc, 'Unlit', 'Unlit shading');
  const wire = button(doc, 'Wire', 'Wireframe shading');
  const grid = button(doc, 'Grid', 'Toggle grid (G)');
  const focus = button(doc, 'Focus', 'Frame selection (F)');
  const play = button(doc, 'Play', 'Enter play mode (P)');
  const pause = button(doc, 'Pause', 'Pause play mode (P)');

  toolbar.append(
    group(doc, view2d, view3d),
    sep(doc),
    group(doc, move, rotate, scale),
    sep(doc),
    group(doc, local, world),
    sep(doc),
    group(doc, snapToggle, snapInput),
    sep(doc),
    group(doc, lit, unlit, wire),
    sep(doc),
    group(doc, grid, focus),
    sep(doc),
    group(doc, play, pause),
  );

  const stage = doc.createElement('div');
  stage.className = 'jurfi-viewport-stage';
  stage.tabIndex = 0;
  stage.setAttribute('aria-label', 'Scene viewport. Alt-drag orbits, right-drag pans, wheel zooms.');
  const canvas = doc.createElement('canvas');
  canvas.className = 'jurfi-viewport-canvas';
  canvas.setAttribute('aria-label', 'Scene viewport');
  const hud = doc.createElement('div');
  hud.className = 'jurfi-viewport-hud';
  const message = doc.createElement('div');
  message.className = 'jurfi-viewport-message';
  message.hidden = true;
  stage.append(canvas, hud, message);
  root.append(toolbar, stage);
  host.append(root);

  const palette = createPalette();
  readPalette(root, palette);
  let view: ViewMode = '3d';
  let shading: ShadingMode = 'lit';
  let space: GizmoSpace = 'world';
  let snap = true;
  let gridOn = true;
  let translateStep = 1;
  let rotateDegrees = 15;
  let scaleStep = 0.25;

  const scene = mountScene({
    stage,
    canvas,
    ctx,
    palette,
    onChange: () => refreshHud(),
    onError: (text) => {
      message.hidden = false;
      message.textContent = text;
    },
  });
  scenes.set(root, scene);

  const gizmoButtons = [move, rotate, scale, local, world];

  function gizmo(): GizmoMode {
    return ctx.getGizmoMode();
  }

  function editing(): boolean {
    return ctx.getPlayState() === 'editing';
  }

  function currentStep(): number {
    if (gizmo() === 'rotate') return rotateDegrees;
    if (gizmo() === 'scale') return scaleStep;
    return translateStep;
  }

  function pushSnap(): void {
    scene.setSnap(snap, translateStep, (rotateDegrees * Math.PI) / 180, scaleStep);
  }

  function paint(): void {
    const mode = gizmo();
    const state = ctx.getPlayState();
    press(view2d, view === '2d');
    press(view3d, view === '3d');
    press(move, mode === 'translate');
    press(rotate, mode === 'rotate');
    press(scale, mode === 'scale');
    press(local, space === 'local');
    press(world, space === 'world');
    press(snapToggle, snap);
    press(lit, shading === 'lit');
    press(unlit, shading === 'unlit');
    press(wire, shading === 'wireframe');
    press(grid, gridOn);
    press(play, state === 'playing');
    press(pause, state === 'paused');
    for (const entry of gizmoButtons) entry.disabled = !editing();
    snapInput.disabled = !editing();
    if (doc.activeElement !== snapInput) snapInput.value = formatNumber(currentStep());
    snapInput.setAttribute(
      'aria-label',
      mode === 'rotate' ? 'Rotate snap in degrees' : mode === 'scale' ? 'Scale snap step' : 'Translate snap in world units',
    );
  }

  function refreshHud(): void {
    const names = ctx.selection.get().map((id) => ctx.world.get(id)?.name ?? id);
    const mode = gizmo();
    const state = ctx.getPlayState();
    hud.textContent = [
      view === '3d' ? '3D' : '2D',
      shading === 'wireframe' ? 'Wire' : shading === 'unlit' ? 'Unlit' : 'Lit',
      mode,
      space,
      snap ? `Snap ${formatNumber(currentStep())}${mode === 'rotate' ? ' deg' : ''}` : 'Snap off',
      names.length > 0 ? names.join(', ') : 'No selection',
      scene.backend(),
      state === 'playing' ? 'Playing' : state === 'paused' ? 'Paused' : 'Editing',
    ].join(' · ');
  }

  function setView(next: ViewMode): void {
    view = next;
    scene.setViewMode(next);
    paint();
    refreshHud();
  }

  function setGizmo(next: GizmoMode): void {
    if (!editing()) return;
    ctx.setGizmoMode(next);
  }

  function setSpace(next: GizmoSpace): void {
    if (!editing()) return;
    space = next;
    scene.setGizmoSpace(next);
    paint();
    refreshHud();
  }

  function setShading(next: ShadingMode): void {
    shading = next;
    scene.setShading(next);
    paint();
    refreshHud();
  }

  function applyShortcut(action: Shortcut): void {
    switch (action.kind) {
      case 'gizmo':
        setGizmo(action.mode);
        break;
      case 'view':
        setView(action.mode);
        break;
      case 'space':
        setSpace(space === 'local' ? 'world' : 'local');
        break;
      case 'grid':
        gridOn = !gridOn;
        scene.setGridVisible(gridOn);
        paint();
        refreshHud();
        break;
      case 'snap':
        snap = !snap;
        pushSnap();
        paint();
        refreshHud();
        break;
      case 'focus':
        scene.focusSelection();
        break;
      case 'playback':
        if (ctx.getPlayState() === 'playing') ctx.pause();
        else ctx.play();
        break;
      default:
        break;
    }
  }

  view2d.addEventListener('click', () => setView('2d'));
  view3d.addEventListener('click', () => setView('3d'));
  move.addEventListener('click', () => setGizmo('translate'));
  rotate.addEventListener('click', () => setGizmo('rotate'));
  scale.addEventListener('click', () => setGizmo('scale'));
  local.addEventListener('click', () => setSpace('local'));
  world.addEventListener('click', () => setSpace('world'));
  snapToggle.addEventListener('click', () => applyShortcut({ kind: 'snap' }));
  lit.addEventListener('click', () => setShading('lit'));
  unlit.addEventListener('click', () => setShading('unlit'));
  wire.addEventListener('click', () => setShading('wireframe'));
  grid.addEventListener('click', () => applyShortcut({ kind: 'grid' }));
  focus.addEventListener('click', () => scene.focusSelection());
  play.addEventListener('click', () => ctx.play());
  pause.addEventListener('click', () => ctx.pause());
  snapInput.addEventListener('change', () => {
    const value = Number(snapInput.value);
    if (!(value > 0)) {
      snapInput.value = formatNumber(currentStep());
      return;
    }
    if (gizmo() === 'rotate') rotateDegrees = value;
    else if (gizmo() === 'scale') scaleStep = value;
    else translateStep = value;
    pushSnap();
    refreshHud();
  });
  root.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const action = shortcutFromKey(event);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    applyShortcut(action);
  });

  const onSelection = ctx.selection.subscribe(() => {
    refreshHud();
  });
  const onGizmo = ctx.bus.on('gizmo:changed', () => {
    paint();
    refreshHud();
  });
  const onPlay = ctx.bus.on('play:changed', () => {
    paint();
    refreshHud();
  });
  const onStep = ctx.bus.on('play:step', () => {
    paint();
    refreshHud();
  });
  const theme = new MutationObserver(() => {
    readPalette(root, palette);
    scene.applyPalette();
  });
  theme.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const resize = new ResizeObserver(() => scene.resize());
  resize.observe(stage);
  const repaint = requestAnimationFrame(() => {
    readPalette(root, palette);
    scene.applyPalette();
  });

  pushSnap();
  paint();
  refreshHud();

  return () => {
    cancelAnimationFrame(repaint);
    theme.disconnect();
    resize.disconnect();
    onSelection();
    onGizmo();
    onPlay();
    onStep();
    scenes.delete(root);
    scene.dispose();
    root.remove();
  };
}

function button(doc: Document, label: string, title: string): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.title = title;
  return element;
}

function group(doc: Document, ...nodes: Node[]): HTMLDivElement {
  const element = doc.createElement('div');
  element.className = 'jurfi-viewport-group';
  element.append(...nodes);
  return element;
}

function sep(doc: Document): HTMLSpanElement {
  const element = doc.createElement('span');
  element.className = 'jurfi-viewport-sep';
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function press(element: HTMLButtonElement, on: boolean): void {
  element.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}
