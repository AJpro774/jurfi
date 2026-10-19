import { DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import type { Color, Material } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Discard, Fn, abs, float, fract, fwidth, length, max, min, mix, positionWorld, smoothstep, uniform, vec2 } from 'three/tsl';
import type { Vec3 } from '../math/vec';
import type { GridBounds } from './grid-math';

export type GridPlane = 'xz' | 'xy';
export type GridMaterialKind = 'node' | 'glsl';

export interface GridVisual {
  root: Mesh;
  setColors(grid: Color, axis: Color): void;
  layout(center: Vec3, bounds: GridBounds): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uGridColor;
  uniform vec3 uAxisColor;
  uniform vec2 uCenter;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uPlane;

  float gridLine(vec2 coord) {
    vec2 deriv = max(fwidth(coord), vec2(1e-4));
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / deriv;
    return 1.0 - min(min(grid.x, grid.y), 1.0);
  }

  float density(vec2 coord) {
    vec2 deriv = max(fwidth(coord), vec2(1e-4));
    float pixels = 1.0 / max(deriv.x, deriv.y);
    return smoothstep(6.0, 16.0, pixels);
  }

  void main() {
    vec2 coord = uPlane < 0.5 ? vWorld.xz : vWorld.xy;
    float minor = gridLine(coord) * density(coord);
    vec2 majorCoord = coord / 10.0;
    float major = gridLine(majorCoord) * density(majorCoord);
    vec2 coarseCoord = coord / 100.0;
    float coarse = gridLine(coarseCoord) * density(coarseCoord);
    vec2 deriv = max(fwidth(coord), vec2(1e-4));
    float axis = max(
      1.0 - min(abs(coord.x) / deriv.x, 1.0),
      1.0 - min(abs(coord.y) / deriv.y, 1.0)
    ) * density(coarseCoord);
    float dist = length(coord - uCenter);
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
    float alpha = max(minor * 0.5, major * 0.75);
    alpha = max(alpha, coarse * 0.9);
    alpha = max(alpha, axis) * fade;
    if (alpha < 0.015) discard;
    vec3 color = mix(uGridColor, uAxisColor, clamp(axis, 0.0, 1.0));
    gl_FragColor = vec4(color, alpha);
  }
`;

interface FadeControls {
  setColors(grid: Color, axis: Color): void;
  setFade(centerX: number, centerY: number, fadeStart: number, fadeEnd: number): void;
  material: Material;
  dispose(): void;
}

function glslControls(plane: GridPlane, grid: Color, axis: Color): FadeControls {
  const material = new ShaderMaterial({
    uniforms: {
      uGridColor: { value: grid.clone() },
      uAxisColor: { value: axis.clone() },
      uCenter: { value: new Vector2() },
      uFadeStart: { value: 8 },
      uFadeEnd: { value: 48 },
      uPlane: { value: plane === 'xz' ? 0 : 1 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
    side: DoubleSide,
    toneMapped: false,
  });
  return {
    material,
    setColors(nextGrid, nextAxis) {
      material.uniforms.uGridColor?.value.copy(nextGrid);
      material.uniforms.uAxisColor?.value.copy(nextAxis);
    },
    setFade(centerX, centerY, fadeStart, fadeEnd) {
      material.uniforms.uCenter?.value.set(centerX, centerY);
      const start = material.uniforms.uFadeStart;
      const end = material.uniforms.uFadeEnd;
      if (start) start.value = fadeStart;
      if (end) end.value = fadeEnd;
    },
    dispose() {
      material.dispose();
    },
  };
}

function lineMask(coord: Node<'vec2'>) {
  const deriv = max(fwidth(coord), vec2(0.0001, 0.0001));
  const grid = abs(fract(coord.sub(0.5)).sub(0.5)).div(deriv);
  const line = float(1).sub(min(min(grid.x, grid.y), float(1)));
  const pixels = float(1).div(max(deriv.x, deriv.y));
  return line.mul(smoothstep(6, 16, pixels));
}

function nodeControls(plane: GridPlane, grid: Color, axis: Color): FadeControls {
  const gridColor = uniform(grid.clone());
  const axisColor = uniform(axis.clone());
  const center = uniform(new Vector2());
  const fadeStart = uniform(8);
  const fadeEnd = uniform(48);
  const coord = plane === 'xz' ? vec2(positionWorld.x, positionWorld.z) : vec2(positionWorld.x, positionWorld.y);
  const minor = lineMask(coord);
  const major = lineMask(coord.div(10));
  const coarse = lineMask(coord.div(100));
  const deriv = max(fwidth(coord), vec2(0.0001, 0.0001));
  const coarseDeriv = max(fwidth(coord.div(100)), vec2(0.0001, 0.0001));
  const coarseDensity = smoothstep(6, 16, float(1).div(max(coarseDeriv.x, coarseDeriv.y)));
  const axisWeight = min(
    max(
      max(
        float(1).sub(min(abs(coord.x).div(deriv.x), float(1))),
        float(1).sub(min(abs(coord.y).div(deriv.y), float(1))),
      ).mul(coarseDensity),
      float(0),
    ),
    float(1),
  );
  const dist = length(coord.sub(center));
  const fade = float(1).sub(smoothstep(fadeStart, fadeEnd, dist));
  const alpha = max(max(max(minor.mul(0.5), major.mul(0.75)), coarse.mul(0.9)), axisWeight).mul(fade);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = mix(gridColor, axisColor, axisWeight);
  material.opacityNode = Fn(() => {
    Discard(alpha.lessThan(0.015));
    return alpha;
  })();
  material.transparent = true;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = 2;
  material.polygonOffsetUnits = 2;
  material.side = DoubleSide;
  material.toneMapped = false;
  Discard(alpha.lessThan(0.015));

  return {
    material,
    setColors(nextGrid, nextAxis) {
      gridColor.value.copy(nextGrid);
      axisColor.value.copy(nextAxis);
    },
    setFade(centerX, centerY, start, end) {
      center.value.set(centerX, centerY);
      fadeStart.value = start;
      fadeEnd.value = end;
    },
    dispose() {
      material.dispose();
    },
  };
}

/** Screen-space grid. Lines stay about one pixel wide and drop out before they alias. */
export function createGridVisual(plane: GridPlane, grid: Color, axis: Color, kind: GridMaterialKind): GridVisual {
  const controls = kind === 'node' ? nodeControls(plane, grid, axis) : glslControls(plane, grid, axis);
  const mesh = new Mesh(new PlaneGeometry(1, 1), controls.material);
  mesh.name = plane === 'xz' ? 'grid-3d' : 'grid-2d';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.raycast = () => undefined;
  if (plane === 'xz') mesh.rotation.x = -Math.PI / 2;
  return {
    root: mesh,
    setColors(nextGrid, nextAxis) {
      controls.setColors(nextGrid, nextAxis);
    },
    layout(center, bounds) {
      const size = bounds.extent * 2;
      if (plane === 'xz') {
        mesh.position.set(center.x, 0, center.z);
        mesh.scale.set(size, size, 1);
        controls.setFade(center.x, center.z, bounds.fadeStart, bounds.fadeEnd);
        return;
      }
      mesh.position.set(center.x, center.y, 0);
      mesh.scale.set(size, size, 1);
      controls.setFade(center.x, center.y, bounds.fadeStart, bounds.fadeEnd);
    },
    dispose() {
      mesh.geometry.dispose();
      controls.dispose();
      mesh.removeFromParent();
    },
  };
}
