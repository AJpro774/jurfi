import type { GizmoMode, ViewMode } from './types';

export interface KeyChord {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type Shortcut =
  | { kind: 'gizmo'; mode: GizmoMode }
  | { kind: 'view'; mode: ViewMode }
  | { kind: 'space' }
  | { kind: 'grid' }
  | { kind: 'snap' }
  | { kind: 'focus' }
  | { kind: 'playback' };

/** Viewport keys. Modifier chords stay with the shell (undo, redo, save, palette). */
export function shortcutFromKey(key: KeyChord): Shortcut | null {
  if (key.ctrlKey || key.metaKey || key.altKey) return null;
  switch (key.code) {
    case 'KeyW':
      return { kind: 'gizmo', mode: 'translate' };
    case 'KeyE':
      return { kind: 'gizmo', mode: 'rotate' };
    case 'KeyR':
      return { kind: 'gizmo', mode: 'scale' };
    case 'Digit2':
      return { kind: 'view', mode: '2d' };
    case 'Digit3':
      return { kind: 'view', mode: '3d' };
    case 'KeyL':
      return { kind: 'space' };
    case 'KeyG':
      return { kind: 'grid' };
    case 'KeyM':
      return { kind: 'snap' };
    case 'KeyF':
      return { kind: 'focus' };
    case 'KeyP':
      return { kind: 'playback' };
    default:
      return null;
  }
}
