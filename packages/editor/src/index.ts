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

export {
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION,
  PANEL,
  STANDARD_PANELS,
  ZONES,
  cloneLayout,
  defaultLayout,
  focusPanel,
  movePanel,
  parseLayout,
  serializeLayout,
  setActiveTab,
  setSizes,
  setZoneCollapsed,
  tryParseLayout,
} from './layout';
export type { LayoutSizes, LayoutState, ZoneId, ZoneState } from './layout';

export {
  AUTOSAVE_STORAGE_KEY,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  applyWorldSnapshot,
  downloadText,
  readProject,
  writeProject,
} from './project';
export type { ProjectFile } from './project';

export { browserStore, memoryStore } from './storage';
export type { KeyValueStore } from './storage';
