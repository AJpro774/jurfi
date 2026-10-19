import type { EditorContext } from '../context';
import type { EntityRecord } from '../world';
import { createEntity, deleteEntities, duplicateEntity, moveEntity, renameEntity, setFlag, type Placement } from './edits';
import { siblingRecords, watchWorld } from './ecs';
import { flagBook, readFlags } from './flags';
import { chevronIcon, eyeIcon, lockIcon } from './icons';

interface Row {
  entity: EntityRecord;
  depth: number;
}

function childMap(ctx: EditorContext): Map<string | null, EntityRecord[]> {
  const map = new Map<string | null, EntityRecord[]>();
  const visit = (parentId: string | null): void => {
    const kids = siblingRecords(ctx, parentId);
    map.set(parentId, kids);
    for (const kid of kids) visit(kid.id);
  };
  visit(null);
  return map;
}

function flatten(ctx: EditorContext): Row[] {
  const children = childMap(ctx);
  const rows: Row[] = [];
  const visit = (parent: string | null, depth: number): void => {
    for (const entity of children.get(parent) ?? []) {
      rows.push({ entity, depth });
      visit(entity.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

function includedIds(ctx: EditorContext, query: string): Set<string> | null {
  const entities = ctx.world.entities();
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return null;
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const matches = entities.filter((entity) => entity.name.toLowerCase().includes(trimmed)).map((entity) => entity.id);
  const include = new Set<string>();
  for (const id of matches) {
    let cursor: string | null = id;
    while (cursor) {
      include.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  const children = childMap(ctx);
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    include.add(id);
    for (const child of children.get(id) ?? []) walk(child.id);
  };
  for (const id of matches) walk(id);
  return include;
}

export function mountHierarchy(el: HTMLElement, ctx: EditorContext): () => void {
  el.classList.add('jp-host');
  const panel = document.createElement('div');
  panel.className = 'jp-panel';
  el.append(panel);

  let query = '';
  let renamingId: string | null = null;
  let focusId: string | null = null;
  let anchorId: string | null = null;
  let dragId: string | null = null;
  let suppressClick = false;
  let focusAfterRender: string | null = null;
  let rendering = false;
  const collapsed = new Set<string>();

  let menu: HTMLElement | null = null;
  const offWorld = watchWorld(ctx, () => render());
  const offSelection = ctx.selection.subscribe(() => render());
  const offFlags = flagBook(ctx).subscribe(() => render());

  render();

  return () => {
    closeMenu();
    offWorld();
    offSelection();
    offFlags();
    panel.remove();
  };

  function rows(): Row[] {
    const include = includedIds(ctx, query);
    const filtering = include !== null;
    const visible: Row[] = [];
    const hidden = new Set<string>();
    for (const row of flatten(ctx)) {
      if (row.entity.parentId !== null && hidden.has(row.entity.parentId)) {
        hidden.add(row.entity.id);
        continue;
      }
      if (include && !include.has(row.entity.id)) continue;
      visible.push(row);
      if (!filtering && collapsed.has(row.entity.id)) hidden.add(row.entity.id);
    }
    return visible;
  }

  function render(): void {
    if (rendering) return;
    rendering = true;
    const previous = document.activeElement;
    const focusKey = previous instanceof HTMLElement && panel.contains(previous) ? previous.dataset.focus ?? null : null;
    const caret = previous instanceof HTMLInputElement ? previous.selectionStart : null;
    const caretEnd = previous instanceof HTMLInputElement ? previous.selectionEnd : null;
    const forced = focusAfterRender;
    focusAfterRender = null;

    panel.replaceChildren();
    const toolbar = document.createElement('div');
    toolbar.className = 'jp-toolbar';
    const search = document.createElement('input');
    search.className = 'je-field';
    search.type = 'search';
    search.placeholder = 'Filter';
    search.setAttribute('aria-label', 'Filter hierarchy');
    search.dataset.focus = 'search';
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      render();
    });
    toolbar.append(search);

    const tree = document.createElement('div');
    tree.className = 'jp-tree';
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', 'Hierarchy');
    tree.ariaMultiSelectable = 'true';
    const list = rows();
    if (!focusId || !list.some((row) => row.entity.id === focusId)) focusId = list[0]?.entity.id ?? null;
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'je-muted jp-empty';
      empty.textContent = query.trim() === '' ? 'No entities' : 'No matches';
      tree.append(empty);
    }
    const children = childMap(ctx);
    for (const row of list) tree.append(renderRow(row, (children.get(row.entity.id) ?? []).length > 0, includeActive(query)));
    tree.addEventListener('keydown', onTreeKey);

    panel.append(toolbar, tree);
    const nextKey = forced ?? focusKey;
    if (nextKey) {
      const next = panel.querySelector<HTMLElement>(`[data-focus="${escapeAttr(nextKey)}"]`);
      if (next) {
        next.focus();
        if (next instanceof HTMLInputElement && caret !== null && caretEnd !== null && nextKey === focusKey) {
          next.setSelectionRange(caret, caretEnd);
        }
      }
    }
    rendering = false;
  }

  function renderRow(row: Row, expandable: boolean, filtering: boolean): HTMLElement {
    const { entity, depth } = row;
    const flags = readFlags(ctx, entity.id);
    const selected = ctx.selection.get().includes(entity.id);
    const item = document.createElement('div');
    item.className = 'je-row jp-entity';
    item.setAttribute('role', 'treeitem');
    item.dataset.id = entity.id;
    item.dataset.focus = `row:${entity.id}`;
    item.style.setProperty('--je-depth', String(depth));
    item.ariaSelected = selected ? 'true' : 'false';
    item.tabIndex = entity.id === focusId ? 0 : -1;
    item.draggable = false;
    if (expandable) item.ariaExpanded = filtering || !collapsed.has(entity.id) ? 'true' : 'false';

    if (expandable) {
      const twist = document.createElement('button');
      twist.type = 'button';
      twist.className = 'jp-icon jp-twist';
      twist.setAttribute('aria-label', collapsed.has(entity.id) ? `Expand ${entity.name}` : `Collapse ${entity.name}`);
      twist.append(chevronIcon(!collapsed.has(entity.id) || filtering));
      twist.addEventListener('click', (event) => {
        event.stopPropagation();
        if (collapsed.has(entity.id)) collapsed.delete(entity.id);
        else collapsed.add(entity.id);
        render();
      });
      item.append(twist);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'jp-twist-spacer';
      item.append(spacer);
    }

    if (renamingId === entity.id) {
      const input = document.createElement('input');
      input.className = 'je-field jp-rename';
      input.type = 'text';
      input.value = entity.name;
      input.setAttribute('aria-label', `Rename ${entity.name}`);
      input.dataset.focus = `rename:${entity.id}`;
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          commitRename(entity.id, input.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          renamingId = null;
          focusAfterRender = `row:${entity.id}`;
          render();
        }
      });
      input.addEventListener('focusout', () => {
        if (rendering || renamingId !== entity.id) return;
        commitRename(entity.id, input.value);
      });
      item.append(input);
    } else {
      const name = document.createElement('span');
      name.className = 'jp-name';
      name.textContent = entity.name;
      item.append(name);
    }

    const visibility = document.createElement('button');
    visibility.type = 'button';
    visibility.className = 'jp-icon';
    visibility.setAttribute('aria-pressed', flags.visible ? 'true' : 'false');
    visibility.setAttribute('aria-label', flags.visible ? `Hide ${entity.name}` : `Show ${entity.name}`);
    visibility.append(eyeIcon(flags.visible));
    visibility.addEventListener('click', (event) => {
      event.stopPropagation();
      setFlag(ctx, entity.id, 'visible', !flags.visible);
    });

    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'jp-icon';
    lock.setAttribute('aria-pressed', flags.locked ? 'true' : 'false');
    lock.setAttribute('aria-label', flags.locked ? `Unlock ${entity.name}` : `Lock ${entity.name}`);
    lock.append(lockIcon(flags.locked));
    lock.addEventListener('click', (event) => {
      event.stopPropagation();
      setFlag(ctx, entity.id, 'locked', !flags.locked);
    });
    item.append(visibility, lock);

    item.addEventListener('click', (event) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if ((event.target as HTMLElement | null)?.closest('button, input')) return;
      onSelect(entity.id, event.shiftKey, event.metaKey || event.ctrlKey);
    });
    item.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || flags.locked) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('button, input')) return;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      const onMove = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return;
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        moved = true;
        dragId = entity.id;
        markDrop(ev.clientX, ev.clientY, entity.id);
      };
      const onUp = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!moved) return;
        suppressClick = true;
        dragId = null;
        const hit = rowAt(ev.clientX, ev.clientY);
        const row = hit ? panel.querySelector<HTMLElement>(`[data-id="${escapeAttr(hit)}"]`) : null;
        const zone = row ? dropZone(row, ev.clientY) : 'inside';
        clearDropMarks();
        const targetEntity = hit ? ctx.world.get(hit) : undefined;
        if (!hit || hit === entity.id || !targetEntity) return;
        moveEntity(ctx, entity.id, placementFor(entity.id, targetEntity, zone));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMenu(entity.id, event.clientX, event.clientY);
    });
    item.addEventListener('dblclick', (event) => {
      if ((event.target as HTMLElement | null)?.closest('button')) return;
      beginRename(entity.id);
    });
    item.addEventListener('dragstart', (event) => {
      dragId = entity.id;
      event.dataTransfer?.setData('text/plain', entity.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragover', (event) => {
      if (!dragId || dragId === entity.id) return;
      event.preventDefault();
      item.dataset.drop = dropZone(item, event.clientY);
    });
    item.addEventListener('dragleave', () => {
      delete item.dataset.drop;
    });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      delete item.dataset.drop;
      const source = dragId;
      dragId = null;
      if (!source || source === entity.id) return;
      moveEntity(ctx, source, placementFor(source, entity, dropZone(item, event.clientY)));
    });
    item.addEventListener('dragend', () => {
      dragId = null;
    });
    return item;
  }

  function onTreeKey(event: KeyboardEvent): void {
    if (renamingId || event.target instanceof HTMLInputElement) return;
    const current = focusId;
    if (!current) return;
    const list = rows();
    const index = list.findIndex((row) => row.entity.id === current);
    if (index < 0) return;
    const entity = list[index]?.entity;
    if (!entity) return;

    if (event.key === 'ArrowDown' && !event.altKey) {
      event.preventDefault();
      const next = list[index + 1]?.entity.id;
      if (next) onSelect(next, event.shiftKey, false);
      return;
    }
    if (event.key === 'ArrowUp' && !event.altKey) {
      event.preventDefault();
      const next = list[index - 1]?.entity.id;
      if (next) onSelect(next, event.shiftKey, false);
      return;
    }
    if (event.key === 'ArrowRight' && !event.altKey) {
      event.preventDefault();
      collapsed.delete(current);
      render();
      return;
    }
    if (event.key === 'ArrowLeft' && !event.altKey) {
      event.preventDefault();
      collapsed.add(current);
      render();
      return;
    }
    if (event.key === 'F2' || event.key === 'Enter') {
      event.preventDefault();
      beginRename(current);
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      const selected = ctx.selection.get();
      removeIds(selected.includes(current) ? selected : [current]);
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const row = panel.querySelector<HTMLElement>(`[data-id="${escapeAttr(current)}"]`);
      const rect = row?.getBoundingClientRect();
      openMenu(current, rect ? rect.left + 8 : 8, rect ? rect.bottom : 8);
      return;
    }
    if (!event.altKey) return;
    const siblings = siblingRecords(ctx, entity.parentId);
    const siblingIndex = siblings.findIndex((item) => item.id === current);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const after = siblings[siblingIndex + 2];
      moveEntity(ctx, current, { parentId: entity.parentId, beforeId: after?.id ?? null });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const previous = siblings[siblingIndex - 1];
      if (previous) moveEntity(ctx, current, { parentId: entity.parentId, beforeId: previous.id });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const previous = siblings[siblingIndex - 1];
      if (previous) moveEntity(ctx, current, { parentId: previous.id, beforeId: null });
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const parent = ctx.world.get(entity.parentId ?? '');
      if (!parent) return;
      const parentSiblings = siblingRecords(ctx, parent.parentId);
      const parentIndex = parentSiblings.findIndex((item) => item.id === parent.id);
      const afterParent = parentSiblings[parentIndex + 1];
      moveEntity(ctx, current, { parentId: parent.parentId, beforeId: afterParent?.id ?? null });
    }
  }

  function onSelect(id: string, shift: boolean, toggle: boolean): void {
    focusId = id;
    focusAfterRender = `row:${id}`;
    const current = ctx.selection.get();
    let next: string[];
    if (shift && anchorId) {
      const list = rows();
      const from = list.findIndex((row) => row.entity.id === anchorId);
      const to = list.findIndex((row) => row.entity.id === id);
      if (from < 0 || to < 0) next = [id];
      else {
        const [start, end] = from < to ? [from, to] : [to, from];
        const range = list.slice(start, end + 1).map((row) => row.entity.id).filter((item) => item !== id);
        next = [id, ...range];
      }
    } else if (toggle) {
      next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current];
      anchorId = id;
    } else {
      next = [id];
      anchorId = id;
    }
    const unchanged = next.length === current.length && next.every((item, index) => item === current[index]);
    ctx.selection.set(next);
    if (unchanged) render();
  }

  function beginRename(id: string): void {
    const entity = ctx.world.get(id);
    if (!entity || readFlags(ctx, id).locked) return;
    renamingId = id;
    focusAfterRender = `rename:${id}`;
    render();
  }

  function commitRename(id: string, value: string): void {
    if (renamingId !== id) return;
    renamingId = null;
    focusAfterRender = `row:${id}`;
    if (!renameEntity(ctx, id, value)) render();
  }

  function rowAt(x: number, y: number): string | null {
    const node = document.elementFromPoint(x, y);
    const row = node instanceof Element ? node.closest<HTMLElement>('[data-id]') : null;
    return row?.dataset.id ?? null;
  }

  function markDrop(x: number, y: number, source: string): void {
    clearDropMarks();
    const id = rowAt(x, y);
    if (!id || id === source) return;
    const row = panel.querySelector<HTMLElement>(`[data-id="${escapeAttr(id)}"]`);
    if (!row) return;
    row.dataset.drop = dropZone(row, y);
  }

  function clearDropMarks(): void {
    for (const row of panel.querySelectorAll<HTMLElement>('[data-drop]')) delete row.dataset.drop;
  }

  function openMenu(id: string, x: number, y: number): void {
    closeMenu();
    const entity = ctx.world.get(id);
    if (!entity) return;
    focusId = id;
    const locked = readFlags(ctx, id).locked;
    const overlay = document.createElement('div');
    overlay.className = 'jp-menu';
    overlay.setAttribute('role', 'menu');
    overlay.setAttribute('aria-label', `${entity.name} actions`);
    overlay.style.left = `${x}px`;
    overlay.style.top = `${y}px`;
    const actions: { label: string; disabled: boolean; run: () => void }[] = [
      { label: 'Create Empty', disabled: entity.parentId !== null && readFlags(ctx, entity.parentId).locked, run: () => selectCreated(createEntity(ctx, entity.parentId)) },
      { label: 'Create Child', disabled: locked, run: () => selectCreated(createEntity(ctx, id)) },
      { label: 'Duplicate', disabled: locked, run: () => selectCreated(duplicateEntity(ctx, id)) },
      { label: 'Delete', disabled: locked, run: () => removeIds([id]) },
    ];
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'jp-menu-item';
      button.setAttribute('role', 'menuitem');
      button.textContent = action.label;
      button.disabled = action.disabled;
      button.addEventListener('click', () => {
        closeMenu();
        action.run();
      });
      overlay.append(button);
    }
    overlay.addEventListener('keydown', (event) => {
      const items = [...overlay.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const index = items.findIndex((item) => item === document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        focusAfterRender = `row:${id}`;
        render();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = items[(index + step + items.length) % items.length];
        next?.focus();
      }
    });
    el.append(overlay);
    menu = overlay;
    overlay.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    window.addEventListener('pointerdown', onMenuPointer, true);
  }

  function onMenuPointer(event: PointerEvent): void {
    const target = event.target;
    if (menu && target instanceof Node && menu.contains(target)) return;
    closeMenu();
  }

  function closeMenu(): void {
    window.removeEventListener('pointerdown', onMenuPointer, true);
    menu?.remove();
    menu = null;
  }

  function selectCreated(id: string | null): void {
    if (!id) return;
    focusId = id;
    focusAfterRender = `row:${id}`;
    ctx.selection.set([id]);
  }

  function removeIds(ids: readonly string[]): void {
    const fallback = ids
      .map((id) => ctx.world.get(id)?.parentId)
      .find((parentId): parentId is string => typeof parentId === 'string' && !ids.includes(parentId)) ?? null;
    if (!deleteEntities(ctx, ids)) return;
    const remaining = ctx.selection.get().filter((id) => ctx.world.get(id) !== undefined && !ids.includes(id));
    const next = remaining.length > 0 ? remaining : fallback ? [fallback] : [];
    if (next[0]) {
      focusId = next[0];
      focusAfterRender = `row:${next[0]}`;
    }
    ctx.selection.set(next);
  }

  function placementFor(source: string, target: EntityRecord, zone: 'before' | 'after' | 'inside'): Placement {
    if (zone === 'inside') return { parentId: target.id, beforeId: null };
    if (zone === 'before') return { parentId: target.parentId, beforeId: target.id };
    const siblings = siblingRecords(ctx, target.parentId);
    const index = siblings.findIndex((entity) => entity.id === target.id);
    const following = siblings[index + 1];
    return { parentId: target.parentId, beforeId: following && following.id !== source ? following.id : null };
  }
}

function includeActive(query: string): boolean {
  return query.trim() !== '';
}

function dropZone(row: HTMLElement, clientY: number): 'before' | 'after' | 'inside' {
  const rect = row.getBoundingClientRect();
  if (rect.height <= 0) return 'inside';
  const y = clientY - rect.top;
  if (y < rect.height * 0.25) return 'before';
  if (y > rect.height * 0.75) return 'after';
  return 'inside';
}

function escapeAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
