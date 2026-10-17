import type { GraphEndpoint } from '@jurfi/script';
import { createLocalCommandBus } from '../shell/command-bus';
import { createGraphController } from './controller';
import { nodeRect, padRect, unionRects } from './geometry';
import { createDefaultRegistry } from './registry';
import { createEmptyGraph } from './serialize';

/** A small valid graph so the panel is runnable the moment it mounts. */
export function createDemoGraph() {
  const registry = createDefaultRegistry();
  const controller = createGraphController({
    document: createEmptyGraph(),
    registry,
    bus: createLocalCommandBus(),
  });

  const start = must(controller.addNode('event.onStart', { x: 48, y: 72 }));
  const sequence = must(controller.addNode('flow.sequence', { x: 320, y: 64 }));
  const hello = must(controller.addNode('data.string', { x: 320, y: 250 }));
  controller.setProp(hello, 'value', 'Hello, Jurfi');
  const printHello = must(controller.addNode('action.print', { x: 600, y: 48 }));
  const flag = must(controller.addNode('data.bool', { x: 600, y: 250 }));
  controller.setProp(flag, 'value', true);
  const branch = must(controller.addNode('flow.branch', { x: 880, y: 48 }));
  const taken = must(controller.addNode('data.string', { x: 880, y: 280 }));
  controller.setProp(taken, 'value', 'Branch taken');
  const printTaken = must(controller.addNode('action.print', { x: 1160, y: 36 }));

  link(controller, { node: start, pin: 'exec' }, { node: sequence, pin: 'exec' });
  link(controller, { node: sequence, pin: 'then0' }, { node: printHello, pin: 'exec' });
  link(controller, { node: hello, pin: 'value' }, { node: printHello, pin: 'message' });
  link(controller, { node: sequence, pin: 'then1' }, { node: branch, pin: 'exec' });
  link(controller, { node: flag, pin: 'value' }, { node: branch, pin: 'condition' });
  link(controller, { node: branch, pin: 'thenTrue' }, { node: printTaken, pin: 'exec' });
  link(controller, { node: taken, pin: 'value' }, { node: printTaken, pin: 'message' });

  const document = controller.getDocument();
  const grouped = new Set([branch, taken, printTaken]);
  const rects = document.nodes.filter((node) => grouped.has(node.id)).map((node) => nodeRect(node, fieldsFor(registry, node.type)));
  const bounds = unionRects(rects);
  if (bounds) controller.addGroup([...grouped], padRect(bounds, 28), 'Decision');
  controller.addComment(
    { x: 40, y: 420, w: 280, h: 96 },
    'Exec pins are squares. Data pins are circles and only connect when the types match.',
  );
  return controller.getDocument();
}

function fieldsFor(registry: ReturnType<typeof createDefaultRegistry>, type: string): number {
  return registry.get(type)?.fields?.length ?? 0;
}

function must(id: string | null): string {
  if (!id) throw new Error('Failed to build the demo graph');
  return id;
}

function link(controller: ReturnType<typeof createGraphController>, from: GraphEndpoint, to: GraphEndpoint): void {
  const error = controller.connect(from, to);
  if (error) throw new Error(error);
}
