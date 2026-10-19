import type { Entity } from './entity';
import { EcsError } from './errors';
import { cloneJson } from './storage';

/** JSON-safe copy of one entity, enough to undo a destroy. */
export interface EntitySnapshot {
  readonly entity: Entity;
  readonly name: string;
  readonly parent: Entity | null;
  readonly alias?: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly components: Readonly<Record<string, unknown>>;
  readonly children: readonly Entity[];
}

/**
 * One recorded edit. `release` undoes `create` without burning a generation,
 * so a later redo adopts the same id. `restore` undoes `destroy`.
 */
export type WorldPatch =
  | { readonly op: 'create'; readonly entity: Entity }
  | { readonly op: 'release'; readonly entity: Entity }
  | { readonly op: 'destroy'; readonly entity: Entity }
  | { readonly op: 'restore'; readonly snapshot: EntitySnapshot }
  | { readonly op: 'add'; readonly entity: Entity; readonly component: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly entity: Entity; readonly component: string }
  | { readonly op: 'set'; readonly entity: Entity; readonly component: string; readonly value: unknown }
  | {
      readonly op: 'setField';
      readonly entity: Entity;
      readonly component: string;
      readonly field: string;
      readonly value: unknown;
    }
  | { readonly op: 'setVariable'; readonly entity: Entity; readonly name: string; readonly value: unknown }
  | { readonly op: 'deleteVariable'; readonly entity: Entity; readonly name: string }
  | { readonly op: 'setName'; readonly entity: Entity; readonly name: string }
  | { readonly op: 'setParent'; readonly entity: Entity; readonly parent: Entity | null };

/** One committed edit, undo, or redo. Autosave listens to this stream. */
export interface WorldChange {
  readonly kind: 'edit' | 'undo' | 'redo';
  readonly label: string;
  readonly patches: readonly WorldPatch[];
}

interface LoggedEdit {
  readonly forward: WorldPatch;
  readonly inverse: WorldPatch;
}

interface Step {
  label: string;
  entries: LoggedEdit[];
}

const HISTORY_LIMIT = 200;

export function copyPatchValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  return cloneJson(value);
}

/**
 * Inverse-patch log for one world.
 * An open transaction collects edits into a single step. Undo applies inverses
 * in reverse; redo applies the original patches. Neither path records again.
 */
export class ChangeLog {
  /** True while undo, redo, or rollback is applying patches. */
  applying = false;
  /** True while a scene load replaces storage and must not record. */
  suspended = false;

  private readonly undoStack: Step[] = [];
  private readonly redoStack: Step[] = [];
  private open: Step | null = null;
  private depth = 0;
  private readonly listeners = new Set<(change: WorldChange) => void>();

  get capturing(): boolean {
    return !this.applying && !this.suspended;
  }

  get openDepth(): number {
    return this.depth;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  begin(label: string): void {
    if (this.depth === 0) this.open = { label, entries: [] };
    this.depth += 1;
  }

  push(label: string, forward: WorldPatch, inverse: WorldPatch): void {
    if (!this.capturing) return;
    const entry = { forward, inverse };
    if (this.depth > 0 && this.open) {
      this.open.entries.push(entry);
      return;
    }
    this.commit({ label, entries: [entry] }, 'edit');
  }

  /** Close one `begin`. The outermost close commits a single history step. */
  end(): void {
    if (this.depth === 0) return;
    this.depth -= 1;
    if (this.depth > 0 || !this.open) return;
    const step = this.open;
    this.open = null;
    if (step.entries.length > 0) this.commit(step, 'edit');
  }

  rollback(apply: (patch: WorldPatch) => void): void {
    const step = this.open;
    this.open = null;
    this.depth = 0;
    if (!step || step.entries.length === 0) return;
    this.applying = true;
    try {
      for (let index = step.entries.length - 1; index >= 0; index -= 1) {
        const entry = step.entries[index];
        if (entry) apply(entry.inverse);
      }
    } finally {
      this.applying = false;
    }
  }

  undo(apply: (patch: WorldPatch) => void): boolean {
    this.assertClosed();
    const step = this.undoStack.pop();
    if (!step) return false;
    this.applyStep(step, 'inverse', apply);
    this.redoStack.push(step);
    this.emit({ kind: 'undo', label: step.label, patches: direction(step, 'inverse') });
    return true;
  }

  redo(apply: (patch: WorldPatch) => void): boolean {
    this.assertClosed();
    const step = this.redoStack.pop();
    if (!step) return false;
    this.applyStep(step, 'forward', apply);
    this.undoStack.push(step);
    this.emit({ kind: 'redo', label: step.label, patches: direction(step, 'forward') });
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.open = null;
    this.depth = 0;
  }

  onChange(listener: (change: WorldChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commit(step: Step, kind: 'edit'): void {
    this.redoStack.length = 0;
    this.undoStack.push(step);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.emit({ kind, label: step.label, patches: direction(step, 'forward') });
  }

  private applyStep(step: Step, which: 'forward' | 'inverse', apply: (patch: WorldPatch) => void): void {
    this.applying = true;
    try {
      if (which === 'forward') {
        for (const entry of step.entries) apply(entry.forward);
        return;
      }
      for (let index = step.entries.length - 1; index >= 0; index -= 1) {
        const entry = step.entries[index];
        if (entry) apply(entry.inverse);
      }
    } finally {
      this.applying = false;
    }
  }

  private emit(change: WorldChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  private assertClosed(): void {
    if (this.depth > 0) {
      throw new EcsError('invalid-value', 'Cannot undo or redo while a transaction is open');
    }
  }
}

function direction(step: Step, which: 'forward' | 'inverse'): WorldPatch[] {
  if (which === 'forward') return step.entries.map((entry) => entry.forward);
  const patches: WorldPatch[] = [];
  for (let index = step.entries.length - 1; index >= 0; index -= 1) {
    const entry = step.entries[index];
    if (entry) patches.push(entry.inverse);
  }
  return patches;
}
