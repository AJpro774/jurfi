export function isApplePlatform(platform = typeof navigator === 'undefined' ? '' : navigator.platform): boolean {
  return /Mac|iPhone|iPad/.test(platform);
}

/** Canonical chord (`Mod+Shift+Z`). Bare keys are ignored except Escape. */
export function eventToShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>): string | null {
  if (event.repeat) return null;
  const key = event.key;
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  const token = key === 'Escape' ? 'Escape' : key.length === 1 ? key.toUpperCase() : key;
  parts.push(token);
  if (parts.length === 1 && token !== 'Escape') return null;
  return parts.join('+');
}

export function formatShortcut(shortcut: string, apple = isApplePlatform()): string {
  const parts = shortcut.split('+').map((part) => {
    if (part === 'Mod') return apple ? '⌘' : 'Ctrl';
    if (part === 'Shift') return apple ? '⇧' : 'Shift';
    if (part === 'Alt') return apple ? '⌥' : 'Alt';
    return part;
  });
  return apple ? parts.join('') : parts.join('+');
}
