import { VERSION } from '@jurfi/core';

export function editorTitle(): string {
  return `Jurfi Editor v${VERSION}`;
}

export { registerPanel, getPanel, listPanels, subscribePanels } from './registry';
export type { PanelDefinition, PanelChange } from './registry';

export { createEditorContext } from './context';
export type { EditorContext, EditorContextOptions } from './context';

export { createSelection } from './selection';
export type { Selection } from './selection';

export { createEditorBus } from './bus';
export type { EditorBus, EditorEventMap, GizmoMode, PlayState } from './bus';

export { createUndoStack } from './undo';
export type { UndoCommand, UndoEvent, UndoStack } from './undo';

export { createCommandRegistry } from './commands';
export type { CommandRegistry, EditorCommand } from './commands';

export { createWorld, createDefaultSnapshot, isWorldSnapshot } from './world';
export type { EditorWorld, EntityRecord, WorldSnapshot } from './world';
