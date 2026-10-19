import { describe, expect, it } from 'vitest';
import { Color, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  createBoxMesh,
  createMesh,
  createOrthographicCamera,
  createPerspectiveCamera,
  createPlaneMesh,
  createScene,
  createSphereMesh,
  createStandardMaterial,
} from './index';

describe('createScene', () => {
  it('starts empty with no background', () => {
    const scene = createScene();
    expect(scene.isScene).toBe(true);
    expect(scene.background).toBeNull();
    expect(scene.children).toHaveLength(0);
  });

  it('applies a background color', () => {
    const scene = createScene({ background: '#112233' });
    expect(scene.background).toBeInstanceOf(Color);
    expect((scene.background as Color).getHexString()).toBe('112233');
  });
});

describe('cameras', () => {
  it('creates a perspective camera and aims it', () => {
    const camera = createPerspectiveCamera({
      fov: 50,
      aspect: 640 / 400,
      near: 0.1,
      far: 100,
      position: [0, 11, 8],
      lookAt: [0, 0, 0],
    });
    expect(camera.isPerspectiveCamera).toBe(true);
    expect(camera.fov).toBe(50);
    expect(camera.aspect).toBeCloseTo(1.6);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(100);
    expect(camera.position.toArray()).toEqual([0, 11, 8]);
    const towardOrigin = new Vector3().copy(camera.position).negate().normalize();
    const direction = camera.getWorldDirection(new Vector3());
    expect(direction.dot(towardOrigin)).toBeGreaterThan(0.999);
  });

  it('uses three.js perspective defaults', () => {
    const camera = createPerspectiveCamera();
    expect(camera.fov).toBe(50);
    expect(camera.aspect).toBe(1);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(2000);
    expect(camera.position.toArray()).toEqual([0, 0, 0]);
  });

  it('creates an orthographic camera', () => {
    const camera = createOrthographicCamera({
      left: -5,
      right: 5,
      top: 4,
      bottom: -4,
      near: 0.2,
      far: 50,
      zoom: 2,
      position: [1, 2, 3],
    });
    expect(camera.isOrthographicCamera).toBe(true);
    expect(camera.left).toBe(-5);
    expect(camera.right).toBe(5);
    expect(camera.top).toBe(4);
    expect(camera.bottom).toBe(-4);
    expect(camera.near).toBe(0.2);
    expect(camera.far).toBe(50);
    expect(camera.zoom).toBe(2);
    expect(camera.position.toArray()).toEqual([1, 2, 3]);
  });
});

describe('meshes', () => {
  it('builds a standard node material with three.js PBR defaults', () => {
    const material = createStandardMaterial();
    expect(material).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(material.isMeshStandardNodeMaterial).toBe(true);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.roughness).toBe(1);
    expect(material.metalness).toBe(0);
    expect(material.emissive.getHex()).toBe(0x000000);
  });

  it('applies color, roughness, metalness, and emissive', () => {
    const material = createStandardMaterial({
      color: 'red',
      roughness: 0.3,
      metalness: 0.8,
      emissive: '#224466',
      emissiveIntensity: 0.4,
    });
    expect(material.color.getHex()).toBe(0xff0000);
    expect(material.roughness).toBe(0.3);
    expect(material.metalness).toBe(0.8);
    expect(material.emissive.getHexString()).toBe('224466');
    expect(material.emissiveIntensity).toBe(0.4);
  });

  it('creates box, sphere, and plane meshes', () => {
    const box = createBoxMesh({ width: 2, height: 3, depth: 4, color: '#abcdef' });
    expect(box.geometry.type).toBe('BoxGeometry');
    expect(box.geometry.parameters).toMatchObject({ width: 2, height: 3, depth: 4 });
    expect(box.material.color.getHexString()).toBe('abcdef');

    const sphere = createSphereMesh({ radius: 0.4, widthSegments: 24, heightSegments: 16, roughness: 0.3 });
    expect(sphere.geometry.type).toBe('SphereGeometry');
    expect(sphere.geometry.parameters).toMatchObject({ radius: 0.4, widthSegments: 24, heightSegments: 16 });
    expect(sphere.material.roughness).toBe(0.3);

    const plane = createPlaneMesh({ width: 10, height: 8 });
    expect(plane.geometry.type).toBe('PlaneGeometry');
    expect(plane.geometry.parameters).toMatchObject({ width: 10, height: 8 });
    expect(plane.rotation.x).toBe(0);
  });

  it('createMesh dispatches on kind and shares a material only when asked', () => {
    const shared = createStandardMaterial({ metalness: 1 });
    const floor = createMesh({ kind: 'plane', width: 10, height: 10, material: shared });
    const ball = createMesh({ kind: 'sphere', radius: 0.4, material: shared });
    const crate = createMesh({ kind: 'box' });
    const other = createBoxMesh();
    expect(floor.geometry.type).toBe('PlaneGeometry');
    expect(ball.geometry.type).toBe('SphereGeometry');
    expect(crate.geometry.type).toBe('BoxGeometry');
    expect(floor.material).toBe(shared);
    expect(ball.material).toBe(shared);
    expect(crate.material).not.toBe(other.material);
    expect(crate.material).toBeInstanceOf(MeshStandardNodeMaterial);
  });

  it('rejects an unknown primitive', () => {
    const options = { kind: 'cone' } as unknown as Parameters<typeof createMesh>[0];
    expect(() => createMesh(options)).toThrow(/unknown mesh primitive/i);
  });
});
