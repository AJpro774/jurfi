import { describe, expect, it } from 'vitest';
import { shortcutFromKey } from './shortcuts';

const plain = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

describe('viewport shortcuts', () => {
  it('maps the viewport keys', () => {
    expect(shortcutFromKey({ ...plain, code: 'KeyW' })).toEqual({ kind: 'gizmo', mode: 'translate' });
    expect(shortcutFromKey({ ...plain, code: 'KeyE' })).toEqual({ kind: 'gizmo', mode: 'rotate' });
    expect(shortcutFromKey({ ...plain, code: 'KeyR' })).toEqual({ kind: 'gizmo', mode: 'scale' });
    expect(shortcutFromKey({ ...plain, code: 'Digit2' })).toEqual({ kind: 'view', mode: '2d' });
    expect(shortcutFromKey({ ...plain, code: 'Digit3' })).toEqual({ kind: 'view', mode: '3d' });
    expect(shortcutFromKey({ ...plain, code: 'KeyF' })).toEqual({ kind: 'focus' });
    expect(shortcutFromKey({ ...plain, code: 'KeyP' })).toEqual({ kind: 'playback' });
    expect(shortcutFromKey({ ...plain, code: 'KeyA' })).toBeNull();
  });

  it('leaves undo, redo, and modified chords to the shell', () => {
    expect(shortcutFromKey({ ...plain, code: 'KeyZ', ctrlKey: true })).toBeNull();
    expect(shortcutFromKey({ ...plain, code: 'KeyZ', metaKey: true, shiftKey: true })).toBeNull();
    expect(shortcutFromKey({ ...plain, code: 'KeyY', ctrlKey: true })).toBeNull();
    expect(shortcutFromKey({ ...plain, code: 'KeyW', ctrlKey: true })).toBeNull();
    expect(shortcutFromKey({ ...plain, code: 'KeyF', altKey: true })).toBeNull();
  });
});
