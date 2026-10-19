import type { Disposable } from '@jurfi/core';
import { createRenderer, detectBackend } from '@jurfi/render';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import type { Material } from 'three';
import type { EditorContext } from '../context';
import { dot, IDENTITY_QUAT, length, sub, transformsClose } from '../math/vec';
import type { Quat, Transform, Vec3 } from '../math/vec';
import type { EntityRecord } from '../world';
import { readCameraDocument, replaceCameraDocument } from './camera-document';
import { entityShape, entityTransform, hasTransform, isDrawable, writeTransform } from './components';
import type { EntityShape } from './components';
import { transformUndo } from './history';
import {
  focusBounds,
  focusOrbit,
  focusOrtho,
  normalizeWheel,
  orbitDrag,
  orbitEye,
  panOrbit,
  panOrtho,
  zoomOrbit,
  zoomOrtho,
} from './camera';
import type { OrbitCamera, OrthoCamera } from './camera';
import type { ViewportPalette } from './colors';
import {
  axisInSpace,
  bestAxisPlaneNormal,
  dragRotate,
  dragScale,
  dragTranslate,
  dragTranslatePlane,
  isAxis,
  isPlane,
  planeMask,
  planeNormal,
  rayPlane,
  scaleFactor,
  selectionPivot,
  signedAngle,
} from './gizmo-math';
import type { AxisId, GizmoHandle, GizmoSpace, PlaneId } from './gizmo-math';
import { createGizmo } from './gizmos';
import { buildGridSegments } from './grid-math';
import { createGridVisual } from './grid-view';
import type { IdBufferPicker } from './picking';
import { pickWithFallback } from './picking';
import type { GizmoMode, ShadingMode, ViewMode } from './types';

export interface SceneHandle extends Disposable {
  setViewMode(mode: ViewMode): void;
  setShading(mode: ShadingMode): void;
  setGridVisible(visible: boolean): void;
  setGizmoMode(mode: GizmoMode): void;
  setGizmoSpace(space: GizmoSpace): void;
  setSnap(enabled: boolean, translate: number, rotateRadians: number, scale: number): void;
  focusSelection(): void;
  applyPalette(): void;
  resize(): void;
  backend(): string;
  setIdBufferPicker(picker: IdBufferPicker | null): void;
}

interface SceneOptions {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: EditorContext;
  palette: ViewportPalette;
  onChange: () => void;
  onError: (message: string) => void;
}

interface EntityView {
  mesh: Mesh;
  outline: LineSegments;
  shape: EntityShape;
}

type Drag =
  | { kind: 'orbit'; pointerId: number; x: number; y: number }
  | { kind: 'pan'; pointerId: number; x: number; y: number }
  | {
      kind: 'translate';
      pointerId: number;
      dir: Vec3;
      normal: Vec3;
      pivot: Vec3;
      startHit: Vec3;
      before: Map<string, Transform>;
    }
  | {
      kind: 'translate-plane';
      pointerId: number;
      plane: PlaneId;
      normal: Vec3;
      pivot: Vec3;
      startHit: Vec3;
      before: Map<string, Transform>;
    }
  | {
      kind: 'rotate';
      pointerId: number;
      axis: AxisId;
      dir: Vec3;
      pivot: Vec3;
      startVec: Vec3;
      space: GizmoSpace;
      before: Map<string, Transform>;
    }
  | {
      kind: 'scale';
      pointerId: number;
      axis: AxisId | 'uniform';
      dir: Vec3;
      normal: Vec3;
      pivot: Vec3;
      startDist: number;
      space: GizmoSpace;
      before: Map<string, Transform>;
    };

export function mountScene(options: SceneOptions): SceneHandle {
  const { stage, ctx, palette, onChange, onError } = options;
  const canvas = options.canvas;
  const world = new Scene();
  world.background = palette.background;
  const perspective = new PerspectiveCamera(50, 1, 0.05, 5000);
  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.05, 500);
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const forward = new Vector3();
  const geometries = {
    box: new BoxGeometry(1, 1, 1),
    sphere: new SphereGeometry(0.5, 32, 16),
    plane: new BoxGeometry(1, 0.05, 1),
  };
  const gizmo = createGizmo({
    x: palette.axisX,
    y: palette.axisY,
    z: palette.axisZ,
    highlight: palette.highlight,
  });
  const grid3d = createGridVisual(buildGridSegments(20, 1, 'xz'), palette.grid, palette.gridAxis);
  const grid2d = createGridVisual(buildGridSegments(20, 1, 'xy'), palette.grid, palette.gridAxis);
  grid3d.root.position.y = -0.001;
  grid2d.root.position.z = -0.01;
  const ambient = new AmbientLight(palette.light, 0.65);
  const key = new DirectionalLight(palette.light, 1.6);
  key.position.set(4, 8, 6);
  const fill = new DirectionalLight(palette.light, 0.45);
  fill.position.set(-6, 3, -4);
  world.add(ambient, key, fill, grid3d.root, grid2d.root, gizmo.root);

  const storedCamera = readCameraDocument();
  let orbit: OrbitCamera = storedCamera.orbit;
  let orthoState: OrthoCamera = storedCamera.ortho;
  const settings = {
    view: storedCamera.view,
    shading: 'lit' as ShadingMode,
    gizmo: ctx.getGizmoMode(),
    space: 'world' as GizmoSpace,
    snap: true,
    translateSnap: 1,
    rotateSnap: (15 * Math.PI) / 180,
    scaleSnap: 0.25,
    grid: true,
  };
  const publishCamera = (): void => {
    replaceCameraDocument({ view: settings.view, orbit, ortho: orthoState });
    ctx.project.markDirty();
  };
  const views = new Map<string, EntityView>();
  let drag: Drag | null = null;
  let dragAbsent = new Set<string>();
  let playing = ctx.getPlayState() !== 'editing';
  let idBuffer: IdBufferPicker | null = null;
  let renderer: Awaited<ReturnType<typeof createRenderer>> | null = null;
  let backendName = 'Starting';
  let disposed = false;
  let looping = false;
  let raf = 0;
  let lastW = 0;
  let lastH = 0;

  const snapOf = (step: number): number | null => (settings.snap && step > 0 ? step : null);
  const activeCamera = () => (settings.view === '3d' ? perspective : ortho);

  function syncCameras(): void {
    const aspect = Math.max(stage.clientWidth, 1) / Math.max(stage.clientHeight, 1);
    if (settings.view === '3d') {
      const eye = orbitEye(orbit);
      perspective.position.set(eye.x, eye.y, eye.z);
      perspective.up.set(0, 1, 0);
      perspective.lookAt(orbit.target.x, orbit.target.y, orbit.target.z);
      perspective.fov = orbit.fov;
      perspective.near = orbit.near;
      perspective.far = orbit.far;
      perspective.aspect = aspect;
      perspective.updateProjectionMatrix();
      return;
    }
    ortho.position.set(orthoState.center.x, orthoState.center.y, 10);
    ortho.up.set(0, 1, 0);
    ortho.lookAt(orthoState.center.x, orthoState.center.y, 0);
    const half = orthoState.halfHeight;
    ortho.left = -half * aspect;
    ortho.right = half * aspect;
    ortho.top = half;
    ortho.bottom = -half;
    ortho.near = orthoState.near;
    ortho.far = orthoState.far;
    ortho.zoom = 1;
    ortho.updateProjectionMatrix();
  }

  function cameraForward(): Vec3 {
    syncCameras();
    activeCamera().updateMatrixWorld();
    activeCamera().getWorldDirection(forward);
    return { x: forward.x, y: forward.y, z: forward.z };
  }

  function setNdc(clientX: number, clientY: number): void {
    const rect = stage.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    ndc.y = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
  }

  function pointerRay(): { origin: Vec3; dir: Vec3 } {
    syncCameras();
    const camera = activeCamera();
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const origin = raycaster.ray.origin;
    const direction = raycaster.ray.direction;
    return {
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: { x: direction.x, y: direction.y, z: direction.z },
    };
  }

  function selectedDrawables(): EntityRecord[] {
    const records: EntityRecord[] = [];
    for (const id of ctx.selection.get()) {
      const entity = ctx.world.get(id);
      if (entity && isDrawable(entity)) records.push(entity);
    }
    return records;
  }

  function primaryRotation(): Quat {
    const selected = selectedDrawables();
    const primary = selected.at(-1);
    return primary ? entityTransform(primary).rotation : IDENTITY_QUAT;
  }

  function currentPivot(): Vec3 | null {
    return selectionPivot(selectedDrawables().map((entity) => entityTransform(entity).position));
  }

  function snapshot(): Map<string, Transform> {
    const map = new Map<string, Transform>();
    dragAbsent = new Set();
    for (const entity of selectedDrawables()) {
      map.set(entity.id, entityTransform(entity));
      if (!hasTransform(entity.components)) dragAbsent.add(entity.id);
    }
    return map;
  }

  function updateGizmo(): void {
    const pivot = currentPivot();
    gizmo.root.visible = pivot != null && !playing;
    gizmo.setMode(settings.gizmo);
    if (!pivot) return;
    gizmo.root.position.set(pivot.x, pivot.y, pivot.z);
    if (settings.space === 'local') {
      const rotation = primaryRotation();
      gizmo.root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    } else gizmo.root.quaternion.identity();
    const pixels = Math.max(stage.clientHeight, 1);
    const worldHeight =
      settings.view === '2d'
        ? orthoState.halfHeight * 2
        : 2 * Math.tan((perspective.fov * Math.PI) / 360) * Math.max(perspective.position.distanceTo(gizmo.root.position), 0.001);
    gizmo.root.scale.setScalar((96 / pixels) * worldHeight);
  }

  function updateGrid(): void {
    grid3d.root.visible = settings.grid && settings.view === '3d';
    grid2d.root.visible = settings.grid && settings.view === '2d';
  }

  function paintMaterial(material: Material, color: Color): void {
    if ('color' in material && material.color instanceof Color) material.color.copy(color);
  }

  function colorFor(shape: EntityShape): Color {
    return shape === 'plane' ? palette.ground : palette.mesh;
  }

  function replaceMaterial(view: EntityView): void {
    const previous = view.mesh.material;
    const color = colorFor(view.shape);
    view.mesh.material =
      settings.shading === 'lit'
        ? new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.04 })
        : new MeshBasicMaterial({ color, wireframe: settings.shading === 'wireframe' });
    if (!Array.isArray(previous)) previous.dispose();
  }

  function removeView(view: EntityView): void {
    view.outline.geometry.dispose();
    if (!Array.isArray(view.outline.material)) view.outline.material.dispose();
    if (!Array.isArray(view.mesh.material)) view.mesh.material.dispose();
    view.mesh.removeFromParent();
  }

  function createView(entity: EntityRecord): EntityView {
    const shape = entityShape(entity);
    const mesh = new Mesh(geometries[shape], new MeshBasicMaterial({ color: colorFor(shape) }));
    mesh.name = entity.name;
    mesh.userData['entityId'] = entity.id;
    const outline = new LineSegments(new EdgesGeometry(mesh.geometry), new LineBasicMaterial({ color: palette.selection }));
    outline.raycast = () => undefined;
    outline.visible = false;
    mesh.add(outline);
    world.add(mesh);
    const view = { mesh, outline, shape };
    replaceMaterial(view);
    return view;
  }

  function syncEntities(): void {
    const seen = new Set<string>();
    const selected = new Set(ctx.selection.get());
    for (const entity of ctx.world.entities()) {
      if (!isDrawable(entity)) continue;
      seen.add(entity.id);
      const shape = entityShape(entity);
      let view = views.get(entity.id);
      if (!view || view.shape !== shape) {
        if (view) removeView(view);
        view = createView(entity);
        views.set(entity.id, view);
      }
      const transform = entityTransform(entity);
      view.mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
      view.mesh.quaternion.set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w);
      view.mesh.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
      view.mesh.updateMatrixWorld();
      view.outline.visible = selected.has(entity.id);
    }
    for (const [id, view] of views) {
      if (seen.has(id)) continue;
      removeView(view);
      views.delete(id);
    }
    updateGizmo();
  }

  function applyPalette(): void {
    world.background = palette.background;
    ambient.color.copy(palette.light);
    key.color.copy(palette.light);
    fill.color.copy(palette.light);
    grid3d.setColors(palette.grid, palette.gridAxis);
    grid2d.setColors(palette.grid, palette.gridAxis);
    gizmo.setColors({ x: palette.axisX, y: palette.axisY, z: palette.axisZ, highlight: palette.highlight });
    for (const view of views.values()) {
      if (!Array.isArray(view.mesh.material)) paintMaterial(view.mesh.material, colorFor(view.shape));
      if (!Array.isArray(view.outline.material)) paintMaterial(view.outline.material, palette.selection);
    }
  }

  function resize(force = false): void {
    if (!renderer) return;
    const width = Math.max(1, Math.floor(stage.clientWidth));
    const height = Math.max(1, Math.floor(stage.clientHeight));
    if (!force && width === lastW && height === lastH) return;
    lastW = width;
    lastH = height;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
  }

  function frame(): void {
    if (disposed || !looping || !renderer) return;
    raf = requestAnimationFrame(frame);
    resize();
    syncCameras();
    updateGizmo();
    try {
      renderer.render(world, activeCamera());
    } catch (error) {
      looping = false;
      onError(error instanceof Error ? error.message : 'Render failed');
    }
  }

  function entityIdAtPointer(): string | null {
    const meshes = [...views.values()].map((view) => view.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      const id = hit.object.userData['entityId'];
      if (typeof id === 'string') return id;
    }
    return null;
  }

  function selectAt(event: PointerEvent): void {
    const rect = stage.getBoundingClientRect();
    const id = pickWithFallback(idBuffer, event.clientX - rect.left, event.clientY - rect.top, entityIdAtPointer);
    if (id) {
      if (event.shiftKey) {
        const ids = ctx.selection.get();
        ctx.selection.set(ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]);
      } else ctx.selection.set([id]);
      return;
    }
    if (!event.shiftKey) ctx.selection.set([]);
  }

  function beginGizmo(handle: GizmoHandle, event: PointerEvent): boolean {
    const pivot = currentPivot();
    if (!pivot) return false;
    const rotation = primaryRotation();
    const ray = pointerRay();
    const before = snapshot();
    if (before.size === 0) return false;
    if (isAxis(handle) && settings.gizmo === 'translate') {
      const dir = axisInSpace(handle, rotation, settings.space);
      const normal = bestAxisPlaneNormal(dir, cameraForward());
      const hit = rayPlane(ray.origin, ray.dir, pivot, normal);
      if (!hit) return false;
      drag = { kind: 'translate', pointerId: event.pointerId, dir, normal, pivot, startHit: hit, before };
      return true;
    }
    if (isPlane(handle) && settings.gizmo === 'translate') {
      const normal = planeNormal(handle, rotation, settings.space);
      const hit = rayPlane(ray.origin, ray.dir, pivot, normal);
      if (!hit) return false;
      drag = { kind: 'translate-plane', pointerId: event.pointerId, plane: handle, normal, pivot, startHit: hit, before };
      return true;
    }
    if (isAxis(handle) && settings.gizmo === 'rotate') {
      const dir = axisInSpace(handle, rotation, settings.space);
      const hit = rayPlane(ray.origin, ray.dir, pivot, dir);
      if (!hit) return false;
      drag = {
        kind: 'rotate',
        pointerId: event.pointerId,
        axis: handle,
        dir,
        pivot,
        startVec: sub(hit, pivot),
        space: settings.space,
        before,
      };
      return true;
    }
    if (settings.gizmo === 'scale' && (isAxis(handle) || handle === 'xyz')) {
      const axis = handle === 'xyz' ? 'uniform' : handle;
      const dir = axis === 'uniform' ? cameraForward() : axisInSpace(axis, rotation, settings.space);
      const normal = axis === 'uniform' ? dir : bestAxisPlaneNormal(dir, cameraForward());
      const hit = rayPlane(ray.origin, ray.dir, pivot, normal);
      if (!hit) return false;
      const offset = sub(hit, pivot);
      const startDist = axis === 'uniform' ? length(offset) : dot(offset, dir);
      drag = { kind: 'scale', pointerId: event.pointerId, axis, dir, normal, pivot, startDist, space: settings.space, before };
      return true;
    }
    return false;
  }

  function applyDrag(id: string, start: Transform, next: Transform): void {
    const entity = ctx.world.get(id);
    if (!entity) return;
    if (transformsClose(start, next) && dragAbsent.has(id)) {
      if (hasTransform(entity.components)) writeTransform(ctx.world, id, null);
      return;
    }
    if (hasTransform(entity.components) && transformsClose(entityTransform(entity), next)) return;
    writeTransform(ctx.world, id, next);
  }

  function moveGizmo(event: PointerEvent): void {
    const current = drag;
    if (!current || current.kind === 'orbit' || current.kind === 'pan') return;
    setNdc(event.clientX, event.clientY);
    const ray = pointerRay();
    const normal = current.kind === 'rotate' ? current.dir : current.normal;
    const hit = rayPlane(ray.origin, ray.dir, current.pivot, normal);
    if (!hit) return;
    if (current.kind === 'translate') {
      const delta = dot(sub(hit, current.startHit), current.dir);
      for (const [id, start] of current.before) {
        applyDrag(id, start, dragTranslate(start, current.dir, delta, snapOf(settings.translateSnap)));
      }
      return;
    }
    if (current.kind === 'translate-plane') {
      const delta = sub(hit, current.startHit);
      for (const [id, start] of current.before) {
        applyDrag(id, start, dragTranslatePlane(start, delta, snapOf(settings.translateSnap), planeMask(current.plane)));
      }
      return;
    }
    if (current.kind === 'rotate') {
      const angle = signedAngle(current.startVec, sub(hit, current.pivot), current.dir);
      for (const [id, start] of current.before) {
        applyDrag(id, start, dragRotate(start, current.pivot, current.axis, angle, current.space, snapOf(settings.rotateSnap)));
      }
      return;
    }
    const offset = sub(hit, current.pivot);
    const factor = scaleFactor(current.startDist, current.axis === 'uniform' ? length(offset) : dot(offset, current.dir));
    for (const [id, start] of current.before) {
      applyDrag(id, start, dragScale(start, current.pivot, current.axis, factor, current.space, snapOf(settings.scaleSnap)));
    }
  }

  function commitDrag(): void {
    if (!drag || drag.kind === 'orbit' || drag.kind === 'pan') {
      drag = null;
      return;
    }
    const after = new Map<string, Transform>();
    for (const id of drag.before.keys()) {
      const entity = ctx.world.get(id);
      if (entity) after.set(id, entityTransform(entity));
    }
    const label = drag.kind === 'rotate' ? 'Rotate' : drag.kind === 'scale' ? 'Scale' : 'Translate';
    const command = transformUndo(ctx.world, drag.before, after, label, dragAbsent);
    dragAbsent = new Set();
    drag = null;
    if (command) ctx.undo.push(command);
  }

  function revertDrag(): void {
    if (drag && drag.kind !== 'orbit' && drag.kind !== 'pan') {
      for (const [id, start] of drag.before) writeTransform(ctx.world, id, dragAbsent.has(id) ? null : start);
    }
    drag = null;
    dragAbsent = new Set();
  }

  function onPointerDown(event: PointerEvent): void {
    if (disposed) return;
    stage.focus();
    setNdc(event.clientX, event.clientY);
    const pan =
      event.button === 2 ||
      (event.button === 1 && event.shiftKey) ||
      (settings.view === '2d' && (event.button === 1 || (event.button === 0 && event.altKey)));
    const orbiting = settings.view === '3d' && (event.button === 1 || (event.button === 0 && event.altKey)) && !event.shiftKey;
    if (pan || orbiting) {
      event.preventDefault();
      drag = { kind: pan ? 'pan' : 'orbit', pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        /* The pointer can be released before capture lands. */
      }
      return;
    }
    if (event.button !== 0 || playing) return;
    pointerRay();
    const handle = gizmo.pick(raycaster);
    if (handle && beginGizmo(handle, event)) {
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        /* See above. */
      }
      return;
    }
    selectAt(event);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) {
      if (playing) {
        gizmo.setHover(null);
        return;
      }
      setNdc(event.clientX, event.clientY);
      pointerRay();
      gizmo.setHover(gizmo.pick(raycaster));
      return;
    }
    if (drag.kind === 'orbit') {
      orbit = orbitDrag(orbit, event.clientX - drag.x, event.clientY - drag.y);
      drag = { ...drag, x: event.clientX, y: event.clientY };
      publishCamera();
      return;
    }
    if (drag.kind === 'pan') {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag = { ...drag, x: event.clientX, y: event.clientY };
      if (settings.view === '3d') orbit = panOrbit(orbit, dx, dy, stage.clientHeight);
      else orthoState = panOrtho(orthoState, dx, dy, stage.clientHeight);
      publishCamera();
      return;
    }
    moveGizmo(event);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    commitDrag();
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    revertDrag();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = normalizeWheel(event.deltaY, event.deltaMode);
    if (settings.view === '3d') orbit = zoomOrbit(orbit, delta);
    else orthoState = zoomOrtho(orthoState, delta);
    publishCamera();
  }

  function onContextMenu(event: Event): void {
    event.preventDefault();
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerCancel);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', onContextMenu);

  const unsubWorld = ctx.world.subscribe(syncEntities);
  const unsubSelection = ctx.selection.subscribe(syncEntities);
  const syncPlay = (): void => {
    playing = ctx.getPlayState() !== 'editing';
    if (playing) revertDrag();
    updateGizmo();
  };
  const unsubPlay = ctx.bus.on('play:changed', syncPlay);
  const unsubStep = ctx.bus.on('play:step', syncPlay);
  const unsubGizmo = ctx.bus.on('gizmo:changed', (event) => {
    settings.gizmo = event.mode;
    gizmo.setHover(null);
    updateGizmo();
  });
  syncEntities();
  updateGrid();
  syncCameras();

  void bootRenderer(canvas, detectBackend())
    .then((booted) => {
      if (disposed) {
        booted.renderer.dispose();
        return;
      }
      renderer = booted.renderer;
      backendName = runningBackend(booted.renderer, booted.backend);
      if ('outputColorSpace' in renderer) renderer.outputColorSpace = SRGBColorSpace;
      looping = true;
      resize(true);
      onChange();
      frame();
    })
    .catch((error: unknown) => {
      if (!disposed) onError(error instanceof Error ? error.message : 'Renderer failed to start');
    });

  return {
    setViewMode(mode) {
      settings.view = mode;
      updateGrid();
      updateGizmo();
      publishCamera();
    },
    setShading(mode) {
      settings.shading = mode;
      for (const view of views.values()) replaceMaterial(view);
    },
    setGridVisible(visible) {
      settings.grid = visible;
      updateGrid();
    },
    setGizmoMode(mode) {
      settings.gizmo = mode;
      gizmo.setHover(null);
      updateGizmo();
    },
    setGizmoSpace(space) {
      settings.space = space;
      updateGizmo();
    },
    setSnap(enabled, translate, rotateRadians, scale) {
      settings.snap = enabled;
      settings.translateSnap = translate;
      settings.rotateSnap = rotateRadians;
      settings.scaleSnap = scale;
    },
    focusSelection() {
      const items: { position: Vec3; scale: Vec3 }[] = [];
      for (const entity of selectedDrawables()) items.push(entityTransform(entity));
      const bounds = focusBounds(items) ?? { center: { x: 0, y: 0, z: 0 }, radius: 2 };
      if (settings.view === '3d') orbit = focusOrbit(orbit, bounds.center, bounds.radius);
      else orthoState = focusOrtho(orthoState, bounds.center, bounds.radius);
      publishCamera();
    },
    applyPalette,
    resize: () => resize(true),
    backend: () => backendName,
    setIdBufferPicker(picker) {
      idBuffer = picker;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerCancel);
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('contextmenu', onContextMenu);
      unsubWorld();
      unsubSelection();
      unsubPlay();
      unsubStep();
      unsubGizmo();
      for (const view of views.values()) removeView(view);
      views.clear();
      gizmo.dispose();
      grid3d.dispose();
      grid2d.dispose();
      geometries.box.dispose();
      geometries.sphere.dispose();
      geometries.plane.dispose();
      ambient.dispose();
      key.dispose();
      fill.dispose();
      renderer?.dispose();
    },
  };
}

async function bootRenderer(canvas: HTMLCanvasElement, preferred: ReturnType<typeof detectBackend>): Promise<{
  renderer: Awaited<ReturnType<typeof createRenderer>>;
  canvas: HTMLCanvasElement;
  backend: string;
}> {
  try {
    // createRenderer awaits WebGPURenderer.init() before resolving, including the WebGL2 path.
    const renderer = await createRenderer(canvas, preferred);
    return { renderer, canvas, backend: preferred === 'webgpu' ? 'WebGPU' : 'WebGL2' };
  } catch (error) {
    if (preferred === 'webgl2') throw error;
    const next = canvas.ownerDocument.createElement('canvas');
    next.className = canvas.className;
    const label = canvas.getAttribute('aria-label');
    if (label) next.setAttribute('aria-label', label);
    canvas.replaceWith(next);
    const renderer = await createRenderer(next, 'webgl2');
    return { renderer, canvas: next, backend: 'WebGL2' };
  }
}

/** WebGPURenderer can init successfully and still fall back to a WebGL backend. */
function runningBackend(renderer: object, requested: string): string {
  const backend = Reflect.get(renderer, 'backend');
  if (backend && typeof backend === 'object') {
    if (Reflect.get(backend, 'isWebGPUBackend') === true) return 'WebGPU';
    if (Reflect.get(backend, 'isWebGLBackend') === true) return 'WebGL2';
  }
  return requested;
}
