import { PANEL } from './layout';
import { getPanel, registerPanel, type PanelDefinition } from './registry';
import type { EditorWorld, EntityRecord } from './world';

const ownedByPlaceholder = new Map<string, PanelDefinition>();

function flatten(world: EditorWorld): { entity: EntityRecord; depth: number }[] {
  const entities = world.entities();
  const ids = new Set(entities.map((entity) => entity.id));
  const children = new Map<string | null, EntityRecord[]>();
  for (const entity of entities) {
    const parent = entity.parentId !== null && ids.has(entity.parentId) ? entity.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(entity);
    children.set(parent, list);
  }
  const rows: { entity: EntityRecord; depth: number }[] = [];
  const visit = (parent: string | null, depth: number): void => {
    for (const entity of children.get(parent) ?? []) {
      rows.push({ entity, depth });
      visit(entity.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

function host(el: HTMLElement, id: string, detail: string): HTMLElement {
  el.classList.add('je-panel-fill');
  el.dataset.placeholder = id;
  const root = document.createElement('div');
  root.className = 'je-placeholder';
  const flag = document.createElement('p');
  flag.className = 'je-placeholder-flag';
  flag.textContent = 'Placeholder';
  const note = document.createElement('p');
  note.className = 'je-placeholder-note';
  note.textContent = `Replace this panel by calling registerPanel({ id: "${id}", ... }). ${detail}`;
  root.append(flag, note);
  el.append(root);
  return root;
}

function hierarchyPanel(): PanelDefinition {
  return {
    id: PANEL.hierarchy,
    title: 'Hierarchy',
    mount(el, ctx) {
      const root = host(el, PANEL.hierarchy, 'Click a row to change the selection.');
      const list = document.createElement('div');
      list.className = 'je-list';
      list.setAttribute('role', 'tree');
      root.append(list);
      const render = (): void => {
        const selected = new Set(ctx.selection.get());
        list.replaceChildren();
        for (const row of flatten(ctx.world)) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'je-row';
          button.setAttribute('role', 'treeitem');
          button.style.setProperty('--je-depth', String(row.depth));
          button.textContent = row.entity.name;
          button.setAttribute('aria-selected', selected.has(row.entity.id) ? 'true' : 'false');
          button.addEventListener('click', () => ctx.selection.set([row.entity.id]));
          list.append(button);
        }
      };
      render();
      const offSelection = ctx.selection.subscribe(render);
      const offWorld = ctx.bus.on('world:changed', render);
      return () => {
        offSelection();
        offWorld();
      };
    },
  };
}

function fieldLabel(text: string, id: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'je-label';
  label.htmlFor = id;
  label.textContent = text;
  return label;
}

function inspectorPanel(): PanelDefinition {
  return {
    id: PANEL.inspector,
    title: 'Inspector',
    mount(el, ctx) {
      const root = host(el, PANEL.inspector, 'Name and health edits are undoable.');
      const form = document.createElement('div');
      root.append(form);
      let selected = '';
      let nameInput: HTMLInputElement | null = null;
      let healthInput: HTMLInputElement | null = null;
      let componentsView: HTMLPreElement | null = null;

      const sync = (): void => {
        const id = ctx.selection.get()[0];
        const entity = id ? ctx.world.get(id) : undefined;
        if (!entity) return;
        if (nameInput && nameInput.value !== entity.name) nameInput.value = entity.name;
        if (healthInput) {
          const health = entity.components.health;
          const text = typeof health === 'number' ? String(health) : '';
          if (healthInput.value !== text) healthInput.value = text;
          if (typeof health === 'number' && health < 0) healthInput.setAttribute('aria-invalid', 'true');
          else healthInput.removeAttribute('aria-invalid');
        }
        if (componentsView) componentsView.textContent = JSON.stringify(entity.components, null, 2);
      };

      const rebuild = (): void => {
        const ids = ctx.selection.get();
        const id = ids[0];
        form.replaceChildren();
        nameInput = null;
        healthInput = null;
        componentsView = null;
        if (!id) {
          selected = '';
          const empty = document.createElement('p');
          empty.className = 'je-muted';
          empty.textContent = 'Nothing selected.';
          form.append(empty);
          return;
        }
        const entity = ctx.world.get(id);
        selected = id;
        if (!entity) {
          const missing = document.createElement('p');
          missing.className = 'je-muted';
          missing.textContent = 'The selected entity is not in the world.';
          form.append(missing);
          return;
        }
        if (ids.length > 1) {
          const note = document.createElement('p');
          note.className = 'je-muted';
          note.textContent = `${ids.length} selected. Editing ${entity.name}.`;
          form.append(note);
        }
        const nameId = `je-name-${id}`;
        form.append(fieldLabel('Name', nameId));
        nameInput = document.createElement('input');
        nameInput.id = nameId;
        nameInput.className = 'je-field';
        nameInput.value = entity.name;
        nameInput.addEventListener('input', () => {
          const current = ctx.world.get(id);
          if (!current || !nameInput) return;
          const next = nameInput.value;
          const previous = current.name;
          if (next === previous) return;
          ctx.undo.push({
            label: 'Rename entity',
            mergeKey: `entity:${id}:name`,
            undo: () => ctx.world.update(id, { name: previous }),
            redo: () => ctx.world.update(id, { name: next }),
          });
          ctx.world.update(id, { name: next });
        });
        form.append(nameInput);

        if (typeof entity.components.health === 'number') {
          const healthId = `je-health-${id}`;
          form.append(fieldLabel('Health', healthId));
          healthInput = document.createElement('input');
          healthInput.id = healthId;
          healthInput.className = 'je-field';
          healthInput.type = 'number';
          healthInput.value = String(entity.components.health);
          healthInput.addEventListener('input', () => {
            const current = ctx.world.get(id);
            if (!current || !healthInput) return;
            const parsed = Number(healthInput.value);
            if (!Number.isFinite(parsed)) return;
            if (current.components.health === parsed) return;
            const previous = current.components;
            const components = { ...current.components, health: parsed };
            ctx.undo.push({
              label: 'Edit health',
              mergeKey: `entity:${id}:health`,
              undo: () => ctx.world.update(id, { components: previous }),
              redo: () => ctx.world.update(id, { components }),
            });
            ctx.world.update(id, { components });
            if (parsed < 0) healthInput.setAttribute('aria-invalid', 'true');
            else healthInput.removeAttribute('aria-invalid');
          });
          form.append(healthInput);
        }

        componentsView = document.createElement('pre');
        componentsView.className = 'je-code';
        componentsView.textContent = JSON.stringify(entity.components, null, 2);
        form.append(componentsView);
        sync();
      };

      rebuild();
      const offSelection = ctx.selection.subscribe(rebuild);
      const offWorld = ctx.bus.on('world:changed', () => {
        const id = ctx.selection.get()[0] ?? '';
        if (id !== selected) rebuild();
        else sync();
      });
      return () => {
        offSelection();
        offWorld();
      };
    },
  };
}

function assetsPanel(): PanelDefinition {
  const entries = ['textures/', 'meshes/', 'materials/', 'audio/'];
  return {
    id: PANEL.assets,
    title: 'Asset Browser',
    mount(el) {
      const root = host(el, PANEL.assets, 'The list below is static sample data.');
      const input = document.createElement('input');
      input.className = 'je-field';
      input.type = 'search';
      input.placeholder = 'Search assets';
      input.setAttribute('aria-label', 'Search assets');
      const list = document.createElement('div');
      list.className = 'je-list';
      const render = (): void => {
        const query = input.value.trim().toLowerCase();
        list.replaceChildren();
        for (const entry of entries) {
          if (query && !entry.includes(query)) continue;
          const row = document.createElement('div');
          row.className = 'je-row';
          row.textContent = entry;
          list.append(row);
        }
      };
      input.addEventListener('input', render);
      root.append(input, list);
      render();
    },
  };
}

function viewportPanel(): PanelDefinition {
  return {
    id: PANEL.viewport,
    title: 'Viewport',
    mount(el, ctx) {
      const root = host(el, PANEL.viewport, 'No renderer is attached. The toolbar gizmo mode is shown here.');
      const canvas = document.createElement('div');
      canvas.className = 'je-viewport';
      const label = document.createElement('p');
      label.className = 'je-viewport-label';
      label.textContent = 'Viewport';
      const detail = document.createElement('p');
      detail.className = 'je-muted';
      canvas.append(label, detail);
      root.append(canvas);
      const render = (): void => {
        const id = ctx.selection.get()[0];
        const name = id ? ctx.world.get(id)?.name : undefined;
        detail.textContent = `${ctx.getPlayState()} · ${ctx.getGizmoMode()} · ${name ? `Selected ${name}` : 'Nothing selected'}`;
      };
      render();
      const offSelection = ctx.selection.subscribe(render);
      const offGizmo = ctx.bus.on('gizmo:changed', render);
      const offPlay = ctx.bus.on('play:changed', render);
      const offWorld = ctx.bus.on('world:changed', render);
      return () => {
        offSelection();
        offGizmo();
        offPlay();
        offWorld();
      };
    },
  };
}

function nodeGraphPanel(): PanelDefinition {
  return {
    id: PANEL.nodeGraph,
    title: 'Node Graph',
    mount(el) {
      const root = host(el, PANEL.nodeGraph, 'Graph editing is not implemented.');
      const graph = document.createElement('div');
      graph.className = 'je-graph';
      for (const node of [
        { title: 'On Play', x: '24px', y: '20px' },
        { title: 'Set Velocity', x: '168px', y: '72px' },
      ]) {
        const card = document.createElement('div');
        card.className = 'je-node';
        card.style.setProperty('--x', node.x);
        card.style.setProperty('--y', node.y);
        card.textContent = node.title;
        graph.append(card);
      }
      root.append(graph);
    },
  };
}

function timelinePanel(): PanelDefinition {
  return {
    id: PANEL.timeline,
    title: 'Timeline',
    mount(el) {
      const root = host(el, PANEL.timeline, 'Tracks are a static preview.');
      const timeline = document.createElement('div');
      timeline.className = 'je-timeline';
      const ruler = document.createElement('div');
      ruler.className = 'je-ruler';
      ruler.textContent = '0s          1s          2s';
      const track = document.createElement('div');
      track.className = 'je-track';
      const name = document.createElement('span');
      name.textContent = 'Player';
      const clip = document.createElement('span');
      clip.className = 'je-clip';
      clip.textContent = 'Idle';
      track.append(name, clip);
      timeline.append(ruler, track);
      root.append(timeline);
    },
  };
}

function consolePanel(): PanelDefinition {
  return {
    id: PANEL.console,
    title: 'Console',
    mount(el, ctx) {
      const root = host(el, PANEL.console, 'Lines come from status events on the editor bus.');
      const log = document.createElement('div');
      log.className = 'je-log';
      log.setAttribute('role', 'log');
      root.append(log);
      const push = (level: string, message: string): void => {
        const line = document.createElement('div');
        line.className = 'je-log-line';
        line.dataset.level = level;
        line.textContent = `[${level}] ${message}`;
        log.append(line);
        log.scrollTop = log.scrollHeight;
      };
      push('info', 'Ready.');
      const off = ctx.bus.on('status', (event) => push(event.level, event.message));
      return () => off();
    },
  };
}

function placeholderPanels(): PanelDefinition[] {
  return [
    viewportPanel(),
    hierarchyPanel(),
    inspectorPanel(),
    assetsPanel(),
    nodeGraphPanel(),
    timelinePanel(),
    consolePanel(),
  ];
}

/** Register a placeholder for any standard id that an owner has not claimed. */
export function ensurePlaceholderPanels(): void {
  for (const definition of placeholderPanels()) {
    const current = getPanel(definition.id);
    if (current && ownedByPlaceholder.get(definition.id) !== current) continue;
    registerPanel(definition);
    ownedByPlaceholder.set(definition.id, definition);
  }
}
