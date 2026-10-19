import {
  BoxGeometry,
  Color,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
} from 'three';
import type { BufferGeometry, ColorRepresentation } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';

/** World-space point as `[x, y, z]`. */
export type Vec3Tuple = readonly [x: number, y: number, z: number];

/** Mesh whose material is a {@link MeshStandardNodeMaterial}. */
export type StandardMesh<TGeometry extends BufferGeometry = BufferGeometry> = Mesh<TGeometry, MeshStandardNodeMaterial>;

/** Options for {@link createScene}. */
export interface CreateSceneOptions {
  /** Background color. Omit to leave `scene.background` unset. */
  background?: ColorRepresentation;
}

/**
 * Create an empty three.js scene.
 *
 * @param options - Optional background color.
 * @returns A new {@link Scene}. No lights or objects are added.
 */
export function createScene(options: CreateSceneOptions = {}): Scene {
  const scene = new Scene();
  if (options.background !== undefined) scene.background = new Color(options.background);
  return scene;
}

/** Shared placement fields for the camera helpers. */
export interface CameraPlacement {
  /** Camera position in world units. Omit to leave the camera at the origin. */
  position?: Vec3Tuple;
  /** Point the camera looks at, applied after `position`. */
  lookAt?: Vec3Tuple;
}

/** Options for {@link createPerspectiveCamera}. */
export interface PerspectiveCameraOptions extends CameraPlacement {
  /** Vertical field of view in degrees. Default `50` (three.js default). */
  fov?: number;
  /** Viewport width divided by height. Default `1`. */
  aspect?: number;
  /** Near clipping plane. Default `0.1`. */
  near?: number;
  /** Far clipping plane. Default `2000` (three.js default). */
  far?: number;
}

/** Options for {@link createOrthographicCamera}. */
export interface OrthographicCameraOptions extends CameraPlacement {
  /** Left edge of the frustum. Default `-1`. */
  left?: number;
  /** Right edge of the frustum. Default `1`. */
  right?: number;
  /** Top edge of the frustum. Default `1`. */
  top?: number;
  /** Bottom edge of the frustum. Default `-1`. */
  bottom?: number;
  /** Near clipping plane. Default `0.1`. */
  near?: number;
  /** Far clipping plane. Default `2000` (three.js default). */
  far?: number;
  /** Zoom factor. Default `1`. */
  zoom?: number;
}

function placeCamera(camera: PerspectiveCamera | OrthographicCamera, options: CameraPlacement): void {
  if (options.position !== undefined) {
    const [x, y, z] = options.position;
    camera.position.set(x, y, z);
  }
  if (options.lookAt !== undefined) {
    const [x, y, z] = options.lookAt;
    camera.lookAt(x, y, z);
  }
}

/**
 * Create a perspective camera.
 *
 * @param options - Frustum and placement. Omitted frustum fields use three.js defaults.
 * @returns A new {@link PerspectiveCamera}.
 */
export function createPerspectiveCamera(options: PerspectiveCameraOptions = {}): PerspectiveCamera {
  const camera = new PerspectiveCamera(options.fov ?? 50, options.aspect ?? 1, options.near ?? 0.1, options.far ?? 2000);
  placeCamera(camera, options);
  return camera;
}

/**
 * Create an orthographic camera.
 *
 * @param options - Frustum and placement. Omitted frustum fields use three.js defaults.
 * @returns A new {@link OrthographicCamera}.
 */
export function createOrthographicCamera(options: OrthographicCameraOptions = {}): OrthographicCamera {
  const camera = new OrthographicCamera(
    options.left ?? -1,
    options.right ?? 1,
    options.top ?? 1,
    options.bottom ?? -1,
    options.near ?? 0.1,
    options.far ?? 2000,
  );
  if (options.zoom !== undefined) camera.zoom = options.zoom;
  placeCamera(camera, options);
  if (options.zoom !== undefined) camera.updateProjectionMatrix();
  return camera;
}

/**
 * PBR inputs for the default node material.
 * Values match `MeshStandardMaterial` when omitted: white, roughness `1`, metalness `0`.
 */
export interface StandardMaterialOptions {
  /** Base color. */
  color?: ColorRepresentation;
  /** `0` is mirror-smooth, `1` is fully rough. Default `1`. */
  roughness?: number;
  /** `0` is dielectric, `1` is metal. Default `0`. */
  metalness?: number;
  /** Emissive color. Omit to leave the material's default (black). */
  emissive?: ColorRepresentation;
  /** Scales {@link StandardMaterialOptions.emissive}. Omit to leave the default (`1`). */
  emissiveIntensity?: number;
}

/**
 * Create the default PBR material: three.js `MeshStandardNodeMaterial`.
 *
 * Node materials compile on `WebGPURenderer` for both the WebGPU backend and
 * the WebGL 2 backend (`forceWebGL`). They do not compile on the legacy
 * `WebGLRenderer`. Each call returns a new material unless the caller passes
 * that instance into a mesh helper's `material` option.
 *
 * @param options - Color, roughness, metalness, and emissive overrides.
 * @returns A new standard node material.
 */
export function createStandardMaterial(options: StandardMaterialOptions = {}): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  if (options.color !== undefined) material.color.set(options.color);
  if (options.roughness !== undefined) material.roughness = options.roughness;
  if (options.metalness !== undefined) material.metalness = options.metalness;
  if (options.emissive !== undefined) material.emissive.set(options.emissive);
  if (options.emissiveIntensity !== undefined) material.emissiveIntensity = options.emissiveIntensity;
  return material;
}

/** Geometry-independent mesh options. */
export interface MeshMaterialOptions extends StandardMaterialOptions {
  /**
   * Material to reuse. When omitted, a new {@link createStandardMaterial}
   * is built from the color and PBR fields on this object.
   */
  material?: MeshStandardNodeMaterial;
}

function materialFrom(options: MeshMaterialOptions): MeshStandardNodeMaterial {
  return options.material ?? createStandardMaterial(options);
}

/** Options for {@link createBoxMesh}. Width, height, and depth default to `1`. */
export interface BoxMeshOptions extends MeshMaterialOptions {
  width?: number;
  height?: number;
  depth?: number;
  widthSegments?: number;
  heightSegments?: number;
  depthSegments?: number;
}

/** Options for {@link createSphereMesh}. Radius defaults to `1`. */
export interface SphereMeshOptions extends MeshMaterialOptions {
  radius?: number;
  /** Horizontal segments. Default `32` (three.js default). */
  widthSegments?: number;
  /** Vertical segments. Default `16` (three.js default). */
  heightSegments?: number;
}

/** Options for {@link createPlaneMesh}. The plane lies on XY; width and height default to `1`. */
export interface PlaneMeshOptions extends MeshMaterialOptions {
  width?: number;
  height?: number;
  widthSegments?: number;
  heightSegments?: number;
}

/** Primitive accepted by {@link createMesh}. */
export type PrimitiveKind = 'box' | 'sphere' | 'plane';

/** Options for {@link createMesh}. Geometry fields match the chosen `kind`. */
export interface CreateMeshOptions extends BoxMeshOptions, SphereMeshOptions, PlaneMeshOptions {
  kind: PrimitiveKind;
}

/**
 * Create a box mesh with a standard node material.
 *
 * @param options - Size, segment counts, and material overrides.
 * @returns A mesh at the origin. The caller owns the geometry and material.
 */
export function createBoxMesh(options: BoxMeshOptions = {}): StandardMesh<BoxGeometry> {
  const geometry = new BoxGeometry(
    options.width ?? 1,
    options.height ?? 1,
    options.depth ?? 1,
    options.widthSegments,
    options.heightSegments,
    options.depthSegments,
  );
  return new Mesh(geometry, materialFrom(options));
}

/**
 * Create a sphere mesh with a standard node material.
 *
 * @param options - Radius, segment counts, and material overrides.
 * @returns A mesh at the origin. The caller owns the geometry and material.
 */
export function createSphereMesh(options: SphereMeshOptions = {}): StandardMesh<SphereGeometry> {
  const geometry = new SphereGeometry(options.radius ?? 1, options.widthSegments, options.heightSegments);
  return new Mesh(geometry, materialFrom(options));
}

/**
 * Create a plane mesh with a standard node material.
 *
 * The plane lies on the XY plane, facing +Z, matching `PlaneGeometry`.
 * Rotate it (for example `mesh.rotation.x = -Math.PI / 2`) to lay it on the ground.
 *
 * @param options - Size, segment counts, and material overrides.
 * @returns A mesh at the origin. The caller owns the geometry and material.
 */
export function createPlaneMesh(options: PlaneMeshOptions = {}): StandardMesh<PlaneGeometry> {
  const geometry = new PlaneGeometry(options.width ?? 1, options.height ?? 1, options.widthSegments, options.heightSegments);
  return new Mesh(geometry, materialFrom(options));
}

/**
 * Create a box, sphere, or plane mesh with a standard node material.
 *
 * @param options - `kind` plus the geometry and material fields for that primitive.
 * @returns The mesh for `options.kind`.
 *
 * @example
 * ```ts
 * const floor = createMesh({ kind: 'plane', width: 10, height: 10, color: '#334455' });
 * floor.rotation.x = -Math.PI / 2;
 * const ball = createMesh({ kind: 'sphere', radius: 0.4, roughness: 0.3 });
 * ```
 */
export function createMesh(options: CreateMeshOptions): StandardMesh<BoxGeometry | SphereGeometry | PlaneGeometry> {
  switch (options.kind) {
    case 'box':
      return createBoxMesh(options);
    case 'sphere':
      return createSphereMesh(options);
    case 'plane':
      return createPlaneMesh(options);
    default:
      return assertNever(options.kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown mesh primitive: ${String(value)}`);
}
