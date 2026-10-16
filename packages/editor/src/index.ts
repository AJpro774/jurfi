import { VERSION } from '@jurfi/core';

/** Editor-only code. Must never be imported by samples or exported games. */
export function editorTitle(): string {
  return "Jurfi Editor v" + VERSION;
}
