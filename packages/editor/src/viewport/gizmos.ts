import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  TorusGeometry,
} from 'three';
import type { BufferGeometry, Color, Object3D, Raycaster } from 'three';
import type { GizmoHandle } from './gizmo-math';
import type { GizmoMode } from './types';

interface HandlePaint {
  material: MeshBasicMaterial;
  handle: GizmoHandle;
  base: Color;
}

export interface GizmoColors {
  x: Color;
  y: Color;
  z: Color;
  highlight: Color;
}

export interface GizmoVisual {
  root: Group;
  setMode(mode: GizmoMode): void;
  setColors(colors: GizmoColors): void;
  setHover(handle: GizmoHandle | null): void;
  pick(raycaster: Raycaster): GizmoHandle | null;
  dispose(): void;
}

const AXIS = ['x', 'y', 'z'] as const;

export function createGizmo(colors: GizmoColors): GizmoVisual {
  const paints: HandlePaint[] = [];
  const geometries: BufferGeometry[] = [];
  const root = new Group();
  root.name = 'gizmo';
  root.frustumCulled = false;

  const translate = new Group();
  const rotate = new Group();
  const scale = new Group();
  root.add(translate, rotate, scale);

  const shaft = track(geometries, new CylinderGeometry(0.045, 0.045, 0.62, 10));
  shaft.translate(0, 0.36, 0);
  const head = track(geometries, new ConeGeometry(0.09, 0.18, 12));
  head.translate(0, 0.76, 0);
  const planeBox = track(geometries, new BoxGeometry(0.2, 0.2, 0.03));
  const torus = track(geometries, new TorusGeometry(0.82, 0.045, 10, 48));
  const scaleShaft = track(geometries, new BoxGeometry(0.04, 0.55, 0.04));
  scaleShaft.translate(0, 0.32, 0);
  const knob = track(geometries, new BoxGeometry(0.12, 0.12, 0.12));
  const uniform = track(geometries, new BoxGeometry(0.14, 0.14, 0.14));

  for (const axis of AXIS) {
    const color = colors[axis];
    translate.add(arrow(axis, shaft, head, paint(paints, axis, color)));
    translate.add(planeHandle(axis, planeBox, paint(paints, planeFor(axis), color)));
    rotate.add(ring(axis, torus, paint(paints, axis, color)));
    scale.add(scaleHandle(axis, scaleShaft, knob, paint(paints, axis, color)));
  }
  const centerMat = paint(paints, 'xyz', colors.highlight);
  const center = new Mesh(uniform, centerMat);
  tag(center, 'xyz');
  scale.add(center);

  let hover: GizmoHandle | null = null;
  let highlight = colors.highlight.clone();

  const applyHover = () => {
    for (const entry of paints) {
      const hot = hover === entry.handle;
      entry.material.color.copy(hot ? entry.base.clone().lerp(highlight, 0.45) : entry.base);
    }
  };

  return {
    root,
    setMode(mode) {
      translate.visible = mode === 'translate';
      rotate.visible = mode === 'rotate';
      scale.visible = mode === 'scale';
    },
    setColors(next) {
      highlight = next.highlight.clone();
      for (const entry of paints) {
        const source = entry.handle === 'xyz' ? next.highlight : colorForHandle(entry.handle, next);
        entry.base.copy(source);
      }
      applyHover();
    },
    setHover(handle) {
      if (hover === handle) return;
      hover = handle;
      applyHover();
    },
    pick(raycaster) {
      const hits = raycaster.intersectObjects(root.children, true);
      for (const hit of hits) {
        if (!chainVisible(hit.object)) continue;
        let current: Object3D | null = hit.object;
        while (current) {
          const handle = current.userData['handle'];
          if (isHandle(handle)) return handle;
          current = current.parent;
        }
      }
      return null;
    },
    dispose() {
      for (const entry of paints) entry.material.dispose();
      for (const geometry of geometries) geometry.dispose();
      root.removeFromParent();
    },
  };
}

function planeFor(axis: 'x' | 'y' | 'z'): GizmoHandle {
  if (axis === 'x') return 'yz';
  if (axis === 'y') return 'xz';
  return 'xy';
}

function colorForHandle(handle: GizmoHandle, colors: GizmoColors): Color {
  if (handle === 'x' || handle === 'yz') return colors.x;
  if (handle === 'y' || handle === 'xz') return colors.y;
  if (handle === 'z' || handle === 'xy') return colors.z;
  return colors.highlight;
}

function paint(paints: HandlePaint[], handle: GizmoHandle, color: Color): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  paints.push({ material, handle, base: color.clone() });
  return material;
}

function track<T extends BufferGeometry>(list: BufferGeometry[], geometry: T): T {
  list.push(geometry);
  return geometry;
}

function tag(object: Object3D, handle: GizmoHandle): void {
  object.userData['handle'] = handle;
  object.renderOrder = 1000;
  object.frustumCulled = false;
}

function arrow(axis: 'x' | 'y' | 'z', shaft: CylinderGeometry, head: ConeGeometry, material: MeshBasicMaterial): Group {
  const group = new Group();
  tag(group, axis);
  const shaftMesh = new Mesh(shaft, material);
  const headMesh = new Mesh(head, material);
  tag(shaftMesh, axis);
  tag(headMesh, axis);
  orient(group, axis);
  group.add(shaftMesh, headMesh);
  return group;
}

function scaleHandle(axis: 'x' | 'y' | 'z', shaft: BoxGeometry, knob: BoxGeometry, material: MeshBasicMaterial): Group {
  const group = new Group();
  tag(group, axis);
  const shaftMesh = new Mesh(shaft, material);
  const knobMesh = new Mesh(knob, material);
  knobMesh.position.y = 0.66;
  tag(shaftMesh, axis);
  tag(knobMesh, axis);
  orient(group, axis);
  group.add(shaftMesh, knobMesh);
  return group;
}

function ring(axis: 'x' | 'y' | 'z', torus: TorusGeometry, material: MeshBasicMaterial): Mesh {
  const mesh = new Mesh(torus, material);
  tag(mesh, axis);
  if (axis === 'x') mesh.rotation.y = Math.PI / 2;
  if (axis === 'y') mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function planeHandle(axis: 'x' | 'y' | 'z', geometry: BoxGeometry, material: MeshBasicMaterial): Mesh {
  const handle = planeFor(axis);
  const mesh = new Mesh(geometry, material);
  tag(mesh, handle);
  if (handle === 'xy') mesh.position.set(0.34, 0.34, 0);
  if (handle === 'xz') {
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0.34, 0, 0.34);
  }
  if (handle === 'yz') {
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(0, 0.34, 0.34);
  }
  return mesh;
}

function orient(group: Group, axis: 'x' | 'y' | 'z'): void {
  if (axis === 'x') group.rotation.z = -Math.PI / 2;
  if (axis === 'z') group.rotation.x = Math.PI / 2;
}

function chainVisible(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function isHandle(value: unknown): value is GizmoHandle {
  return value === 'x' || value === 'y' || value === 'z' || value === 'xy' || value === 'yz' || value === 'xz' || value === 'xyz';
}
