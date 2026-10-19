import { POSE_DATA_TYPE } from '@jurfi/anim';
import { createNodeRegistry } from '@jurfi/script';
import type { NodeRegistry, PinSpec } from '@jurfi/script';

const poseOut: PinSpec = { name: 'pose', kind: 'data', direction: 'out', dataType: POSE_DATA_TYPE, label: 'Pose' };

function poseIn(name: string, label: string): PinSpec {
  return { name, kind: 'data', direction: 'in', dataType: POSE_DATA_TYPE, label };
}

/** Anim nodes. Blend1D and Blend2D pose inputs are expanded from `props.count`. */
export function createBlendRegistry(): NodeRegistry {
  return createNodeRegistry([
    {
      typeId: 'anim/Clip',
      category: 'clip',
      doc: 'Samples a clip into a pose.',
      pins: [poseOut],
    },
    {
      typeId: 'anim/Blend1D',
      category: 'blend',
      doc: 'Blends poses along one float or int parameter.',
      pins: [poseOut],
    },
    {
      typeId: 'anim/Blend2D',
      category: 'blend',
      doc: 'Blends poses on two float or int parameters.',
      pins: [poseOut],
    },
    {
      typeId: 'anim/Additive',
      category: 'blend',
      doc: 'Adds an offset pose onto a base pose.',
      pins: [poseIn('base', 'Base'), poseIn('add', 'Add'), poseOut],
    },
    {
      typeId: 'anim/Mask',
      category: 'blend',
      doc: 'Keeps named joints from the source pose.',
      pins: [poseIn('source', 'Source'), poseIn('base', 'Base'), poseOut],
    },
  ]);
}
