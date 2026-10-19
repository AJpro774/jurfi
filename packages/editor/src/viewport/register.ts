import { registerPanel } from '../registry';
import { mountViewportPanel } from './panel';

export const VIEWPORT_PANEL_ID = 'viewport';

/** Replace the shell's Viewport placeholder. Call this before `createEditor`. */
export function registerViewportPanel(): () => void {
  return registerPanel({
    id: VIEWPORT_PANEL_ID,
    title: 'Viewport',
    mount: mountViewportPanel,
  });
}
