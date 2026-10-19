import type { EditorContext } from './context';
import type { UndoCommand } from './undo';
import type { EditorWorld } from './world';

/** History controls on the core world behind an editor document. */
export interface EcsHistory {
  transaction(label: string, fn: () => void): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  onChange(listener: (change: { kind: string; label: string }) => void): () => void;
  clearHistory(): void;
  clearRedo(): void;
  suspendHistory(): void;
  resumeHistory(): void;
  isHistorySuspended(): boolean;
}

export function ecsHistory(world: EditorWorld): EcsHistory | undefined {
  const ecs = (world as { ecs?: Partial<EcsHistory> }).ecs;
  if (!ecs || typeof ecs.transaction !== 'function' || typeof ecs.undo !== 'function' || typeof ecs.onChange !== 'function') {
    return undefined;
  }
  return ecs as EcsHistory;
}

/**
 * Apply a world edit.
 * When the document is a core ECS world, the edit is one transaction and the shared
 * undo stack hears it from `onChange`. The command is only stored for the headless world.
 * While history is suspended (play mode), the edit is applied and not recorded.
 */
export function editWithHistory(ctx: EditorContext, label: string, apply: () => void, command: UndoCommand): void {
  const ecs = ecsHistory(ctx.world);
  if (ecs?.isHistorySuspended()) {
    apply();
    return;
  }
  if (ecs) {
    ecs.transaction(label, apply);
    return;
  }
  apply();
  ctx.undo.push(command);
}
