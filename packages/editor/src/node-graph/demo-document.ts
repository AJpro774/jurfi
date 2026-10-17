import type { PinEndpoint } from '@jurfi/script';
import { createUndoStack } from '../undo';
import { createGraphController } from './controller';
import { nodeRect, padRect, unionRects } from './geometry';
import { createDefaultRegistry, nodeFields, nodePins } from './registry';
import { createEmptyGraph } from './serialize';

/** A small valid graph so the panel is runnable the moment it mounts. */
export function createDemoGraph() {
  const registry = createDefaultRegistry();
  const controller = createGraphController({
    document: createEmptyGraph(),
    registry,
    undo: createUndoStack(),
  });

  const start = must(controller.addNode('core/OnStart', { x: 48, y: 72 }));
  const sequence = must(controller.addNode('core/Sequence', { x: 340, y: 48 }));
  const greet = must(controller.addNode('core/SetVariable', { x: 680, y: 24 }));
  controller.setProp(greet, 'name', 'greeting');
  controller.setPin(greet, 'value', 'Hello, Jurfi');
  const branch = must(controller.addNode('core/Branch', { x: 680, y: 220 }));
  controller.setPin(branch, 'condition', true);
  const taken = must(controller.addNode('core/SetVariable', { x: 1020, y: 200 }));
  controller.setProp(taken, 'name', 'branch');
  controller.setPin(taken, 'value', 'taken');

  link(controller, { node: start, pin: 'then' }, { node: sequence, pin: 'exec' });
  link(controller, { node: sequence, pin: 'then0' }, { node: greet, pin: 'exec' });
  link(controller, { node: sequence, pin: 'then1' }, { node: branch, pin: 'exec' });
  link(controller, { node: branch, pin: 'true' }, { node: taken, pin: 'exec' });

  const document = controller.getDocument();
  const grouped = new Set([branch, taken]);
  const rects = document.nodes
    .filter((node) => grouped.has(node.id))
    .map((node) => nodeRect(node, nodePins(node, registry), nodeFields(registry.get(node.type)).length));
  const bounds = unionRects(rects);
  if (bounds) controller.addGroup([...grouped], padRect(bounds, 28), 'Decision');
  controller.addComment(
    { x: 40, y: 420, w: 280, h: 96 },
    'Exec pins are diamonds. Data pins are circles and only connect when the types match.',
  );
  return controller.getDocument();
}

function must(id: string | null): string {
  if (!id) throw new Error('Failed to build the demo graph');
  return id;
}

function link(controller: ReturnType<typeof createGraphController>, from: PinEndpoint, to: PinEndpoint): void {
  const error = controller.connect(from, to);
  if (error) throw new Error(error);
}
