export type Easing = (t: number) => number;
export const linear: Easing = (t) => t;
export const easeInOut: Easing = (t) => t * t * (3 - 2 * t);
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
