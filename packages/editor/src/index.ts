export { editorTitle } from './title';

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

export { createEditor } from './shell';
export type { CreateEditorOptions, Editor } from './shell';

export { ensurePlaceholderPanels } from './panels';

export { registerContentPanels } from './content/register';
export { createDemoSnapshot, seedDemoLibrary } from './content/demo';

export { registerTimelinePanel } from './timeline/register';
export { createSampleClip } from './timeline/sample-clip';

export { registerViewportPanel, VIEWPORT_PANEL_ID } from './viewport/register';
export { setViewportIdBuffer } from './viewport/panel';
export type { IdBufferPicker } from './viewport/picking';
export type { ShadingMode, ViewMode } from './viewport/types';

export {
  createDefaultRegistry,
  createDemoGraph,
  createEmptyGraph,
  createRegistry,
  deserializeGraph,
  edgeWireId,
  evaluateConnection,
  GraphSchemaError,
  blendTreeAdapter,
  blendTreeFromGraph,
  blendTreeToGraph,
  createBlendRegistry,
  createDemoBlendTree,
  identityGraphAdapter,
  mountNodeGraph,
  registerNodeGraphPanel,
  searchNodes,
  serializeGraph,
  stripEditorData,
  validateGraph,
} from './node-graph';
export type {
  GraphClipboard,
  GraphDocAdapter,
  GraphRect,
  NodeDef,
  NodeGraphHandle,
  NodeGraphOptions,
  NodeRegistry,
  PinSpec,
} from './node-graph';
export type {
  DebugEvent,
  DebugSource,
  GraphComment,
  GraphDoc,
  GraphEdge,
  GraphGroup,
  GraphNode,
  PinEndpoint,
} from '@jurfi/script';
