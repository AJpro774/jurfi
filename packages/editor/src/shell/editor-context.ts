/**
 * FLAG: Editor Shell engineer fc90dcbf has not published a panel registry
 * or EditorContext on main. The node graph accepts this shape and, when
 * `registerPanel` exists, registers itself. `registerPanel` must not
 * synchronously mount back into the same element.
 */

import type { CommandBus } from './command-bus';

export interface EditorPanelRegistration {
  id: string;
  title: string;
  mount(host: HTMLElement): { destroy(): void };
}

export interface EditorContext {
  commandBus?: CommandBus;
  registerPanel?(panel: EditorPanelRegistration): () => void;
}
