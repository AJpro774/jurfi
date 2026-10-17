export type FieldKind = 'number' | 'vec2' | 'vec3' | 'vec4' | 'color' | 'enum' | 'bool' | 'string' | 'asset-ref';

export interface FieldSchema {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface ComponentSchema {
  type: string;
  title: string;
  fields: readonly FieldSchema[];
  defaults: () => Record<string, unknown>;
}

const schemas = new Map<string, ComponentSchema>();

export function defineComponent(schema: ComponentSchema): ComponentSchema {
  schemas.set(schema.type, schema);
  return schema;
}

export function componentSchema(type: string): ComponentSchema | undefined {
  return schemas.get(type);
}

export function componentSchemas(): readonly ComponentSchema[] {
  return [...schemas.values()];
}

export function vecWidth(kind: FieldKind): number {
  if (kind === 'vec2') return 2;
  if (kind === 'vec3') return 3;
  if (kind === 'vec4') return 4;
  return 0;
}

export function parseNumberField(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.' || trimmed.endsWith('.')) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

export function parseColorField(raw: string): string | undefined {
  const trimmed = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

function vec3(x: number, y: number, z: number): number[] {
  return [x, y, z];
}

defineComponent({
  type: 'jurfi.transform',
  title: 'Transform',
  fields: [
    { key: 'position', label: 'Position', kind: 'vec3', step: 0.1 },
    { key: 'rotation', label: 'Rotation', kind: 'vec3', step: 1 },
    { key: 'scale', label: 'Scale', kind: 'vec3', step: 0.1 },
  ],
  defaults: () => ({ position: vec3(0, 0, 0), rotation: vec3(0, 0, 0), scale: vec3(1, 1, 1) }),
});

defineComponent({
  type: 'jurfi.camera',
  title: 'Camera',
  fields: [
    { key: 'projection', label: 'Projection', kind: 'enum', options: ['perspective', 'orthographic'] },
    { key: 'fov', label: 'Field of view', kind: 'number', min: 1, max: 179, step: 1 },
    { key: 'sensor', label: 'Sensor', kind: 'vec2', step: 0.1 },
    { key: 'viewport', label: 'Viewport', kind: 'vec4', step: 0.01 },
  ],
  defaults: () => ({
    projection: 'perspective',
    fov: 50,
    sensor: [36, 24],
    viewport: [0, 0, 1, 1],
  }),
});

defineComponent({
  type: 'jurfi.light',
  title: 'Light',
  fields: [
    { key: 'color', label: 'Color', kind: 'color' },
    { key: 'intensity', label: 'Intensity', kind: 'number', min: 0, step: 0.1 },
    { key: 'mode', label: 'Mode', kind: 'enum', options: ['directional', 'point', 'spot'] },
    { key: 'castShadows', label: 'Cast shadows', kind: 'bool' },
  ],
  defaults: () => ({ color: '#fff4e0', intensity: 1, mode: 'directional', castShadows: false }),
});

defineComponent({
  type: 'jurfi.health',
  title: 'Health',
  fields: [
    { key: 'current', label: 'Current', kind: 'number', step: 1 },
    { key: 'max', label: 'Max', kind: 'number', min: 0, step: 1 },
  ],
  defaults: () => ({ current: 100, max: 100 }),
});

defineComponent({
  type: 'jurfi.mesh',
  title: 'Mesh',
  fields: [
    { key: 'mesh', label: 'Mesh', kind: 'asset-ref' },
    { key: 'tint', label: 'Tint', kind: 'color' },
    { key: 'shown', label: 'Shown', kind: 'bool' },
    { key: 'tag', label: 'Tag', kind: 'string' },
  ],
  defaults: () => ({ mesh: '', tint: '#ffffff', shown: true, tag: '' }),
});
