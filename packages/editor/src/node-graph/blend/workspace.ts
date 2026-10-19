import type { GraphController } from '../controller';
import { NodeGraphView } from '../view';
import { blendTreeFromGraph } from './document';
import { mountBlendMachine } from './machine';

export const BLEND_AUTOSAVE_KEY = 'jurfi.editor.blendtree';

export function mountBlendWorkspace(
  host: HTMLElement,
  controller: GraphController,
  onChange?: (json: string) => void,
): { destroy(): void } {
  const doc = host.ownerDocument;
  const wrap = doc.createElement('div');
  wrap.className = 'ng-blend';
  const canvasHost = doc.createElement('div');
  canvasHost.className = 'ng-blend-canvas';
  const machineHost = doc.createElement('div');
  machineHost.className = 'ng-machine-host';
  wrap.append(canvasHost, machineHost);
  host.replaceChildren(wrap);
  const view = new NodeGraphView(canvasHost, controller, controller.registry, (graph) => {
    onChange?.(JSON.stringify(blendTreeFromGraph(graph)));
  });
  const machine = mountBlendMachine(machineHost, controller);
  return {
    destroy() {
      machine.destroy();
      view.destroy();
      wrap.remove();
    },
  };
}

export function readBlendAutosave(): unknown {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(BLEND_AUTOSAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function writeBlendAutosave(json: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BLEND_AUTOSAVE_KEY, json);
  } catch {
    // Storage can be full or disabled. The in-memory tree stays current.
  }
}
