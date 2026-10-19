import { POSE_DATA_TYPE } from '@jurfi/anim';
import type { PinSpec } from '@jurfi/script';
import type { NodePropField } from '../registry';

const BLEND_INPUT_NODES = new Set(['anim/Blend1D', 'anim/Blend2D']);
const MAX_BLEND_INPUTS = 8;

export function blendInputCount(typeId: string, props: Record<string, unknown> | undefined): number {
  const fallback = typeId === 'anim/Blend2D' ? 3 : 2;
  const raw = props?.count;
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return Math.min(MAX_BLEND_INPUTS, Math.max(1, raw));
  }
  return fallback;
}

/** Pose inputs `in0..inN` plus a pose output. `null` for nodes with fixed pins. */
export function expandBlendPins(typeId: string, props: Record<string, unknown> | undefined): PinSpec[] | null {
  if (!BLEND_INPUT_NODES.has(typeId)) return null;
  const count = blendInputCount(typeId, props);
  const pins: PinSpec[] = [];
  for (let index = 0; index < count; index += 1) {
    pins.push({
      name: `in${index}`,
      kind: 'data',
      direction: 'in',
      dataType: POSE_DATA_TYPE,
      label: String(index),
    });
  }
  pins.push({ name: 'pose', kind: 'data', direction: 'out', dataType: POSE_DATA_TYPE, label: 'Pose' });
  return pins;
}

export function blendFields(typeId: string, props: Record<string, unknown> | undefined): readonly NodePropField[] | null {
  if (typeId === 'anim/Clip') return [{ key: 'clip', label: 'Clip', kind: 'string' }];
  if (typeId === 'anim/Additive') return [{ key: 'weight', label: 'Weight', kind: 'string' }];
  if (typeId === 'anim/Mask') {
    return [
      { key: 'joints', label: 'Joints', kind: 'string' },
      { key: 'weight', label: 'Weight', kind: 'string' },
    ];
  }
  if (typeId === 'anim/Blend1D') {
    const count = blendInputCount(typeId, props);
    const fields: NodePropField[] = [
      { key: 'param', label: 'Param', kind: 'string' },
      { key: 'count', label: 'Inputs', kind: 'number' },
    ];
    for (let index = 0; index < count; index += 1) {
      fields.push({ key: `pos${index}`, label: `Pos ${index}`, kind: 'number' });
    }
    return fields;
  }
  if (typeId === 'anim/Blend2D') {
    const count = blendInputCount(typeId, props);
    const fields: NodePropField[] = [
      { key: 'paramX', label: 'Param X', kind: 'string' },
      { key: 'paramY', label: 'Param Y', kind: 'string' },
      { key: 'count', label: 'Inputs', kind: 'number' },
    ];
    for (let index = 0; index < count; index += 1) {
      fields.push({ key: `x${index}`, label: `X ${index}`, kind: 'number' });
      fields.push({ key: `y${index}`, label: `Y ${index}`, kind: 'number' });
    }
    return fields;
  }
  return null;
}
