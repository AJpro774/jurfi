import { defineComponent } from './schema';

/**
 * Local position, quaternion rotation, and scale.
 * Storage defaults to `soa` because the id is `Transform`.
 * `World.renderScene` builds column-major world matrices from this component.
 */
export const Transform = defineComponent('Transform', {
  position: { type: 'vec3', default: [0, 0, 0] },
  rotation: { type: 'quat', default: [0, 0, 0, 1] },
  scale: { type: 'vec3', default: [1, 1, 1] },
});

/** 3D light. Not a 2D light; see {@link Light2D}. */
export const Light = defineComponent('Light', {
  kind: { type: 'string', default: 'point' },
  color: { type: 'color', default: [1, 1, 1, 1] },
  intensity: { type: 'number', default: 1 },
  range: { type: 'number', default: 10 },
});

/** 2D light. Separate from {@link Light}; it does not share fields or storage. */
export const Light2D = defineComponent('Light2D', {
  color: { type: 'color', default: [1, 1, 1, 1] },
  intensity: { type: 'number', default: 1 },
  radius: { type: 'number', default: 4 },
});
