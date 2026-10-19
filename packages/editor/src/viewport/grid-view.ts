import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments } from 'three';
import type { Color } from 'three';
import type { GridSegment } from './grid-math';

export interface GridVisual {
  root: Group;
  setColors(grid: Color, axis: Color): void;
  dispose(): void;
}

export function createGridVisual(segments: readonly GridSegment[], grid: Color, axis: Color): GridVisual {
  const gridPositions: number[] = [];
  const axisPositions: number[] = [];
  for (const segment of segments) {
    const target = segment.axis ? axisPositions : gridPositions;
    target.push(segment.a.x, segment.a.y, segment.a.z, segment.b.x, segment.b.y, segment.b.z);
  }
  const gridMaterial = new LineBasicMaterial({ color: grid });
  const axisMaterial = new LineBasicMaterial({ color: axis });
  const root = new Group();
  root.add(lines(gridPositions, gridMaterial), lines(axisPositions, axisMaterial));
  root.traverse((child) => {
    child.raycast = () => undefined;
  });
  return {
    root,
    setColors(nextGrid, nextAxis) {
      gridMaterial.color.copy(nextGrid);
      axisMaterial.color.copy(nextAxis);
    },
    dispose() {
      root.traverse((child) => {
        if (child instanceof LineSegments) child.geometry.dispose();
      });
      gridMaterial.dispose();
      axisMaterial.dispose();
      root.removeFromParent();
    },
  };
}

function lines(positions: number[], material: LineBasicMaterial): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new LineSegments(geometry, material);
}
