import { clamp } from '@jurfi/core';
import type { GraphDocument, GraphEndpoint, GraphNode, GraphRect, PinDirection, Vec2 } from '@jurfi/script';
import type { GraphClipboard } from './clipboard';
import type { GraphController } from './controller';
import { applyDebugEvent, createDebugOverlay, edgeWireId, formatDebugValue } from './debug';
import type { DebugOverlay, DebugSource } from './debug';
import { LAYOUT, nodePos, nodeRect, normalizeRect, padRect, pinAnchor, unionRects, wireGeometry } from './geometry';
import { nodeTitle, searchNodes } from './registry';
import type { NodeDefinition, NodeRegistry } from './registry';
import { emptySelection, idsTouchingRect, mergeIds, toggleMember } from './selection';
import type { GraphSelection } from './selection';
import { evaluateConnection } from './validate';
import cssText from './node-graph.css?raw';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'jurfi-node-graph-styles';
const HINT = 'Wheel zoom · Alt-drag pan · Drag empty to box-select · Shift-click multi-select · ⌘/Ctrl+C/V copy';

const CATEGORY_COLOR: Record<string, string> = {
  Event: 'var(--accent)',
  Flow: 'var(--text-2)',
  Data: 'var(--ref-yellow-400)',
  Math: 'var(--ref-accent-200)',
  Action: 'var(--danger)',
};

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; pointerId: number; x: number; y: number }
  | { kind: 'marquee'; pointerId: number; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: 'nodes'; pointerId: number; origin: Vec2; start: Map<string, Vec2> }
  | { kind: 'comment'; pointerId: number; id: string; origin: Vec2; rect: GraphRect }
  | { kind: 'group'; pointerId: number; id: string; origin: Vec2; rect: GraphRect; nodes: Map<string, Vec2> }
  | { kind: 'resize'; pointerId: number; id: string; origin: Vec2; rect: GraphRect }
  | { kind: 'wire'; pointerId: number; origin: GraphEndpoint; dir: PinDirection; x: number; y: number }
  | { kind: 'palette'; pointerId: number; type: string; title: string; x: number; y: number; moved: boolean };

export function ensureNodeGraphStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = typeof cssText === 'string' ? cssText : '';
  doc.head.append(style);
}

export class NodeGraphView {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly world: HTMLElement;
  private readonly paletteList: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly marquee: HTMLElement;
  private readonly minimap: SVGSVGElement;
  private readonly hint: HTMLElement;
  private readonly error: HTMLElement;
  private readonly zoomLabel: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly ghost: HTMLElement;
  private readonly controller: GraphController;
  private readonly registry: NodeRegistry;
  private readonly notify?: (document: GraphDocument) => void;
  private doc: GraphDocument;
  private selection: GraphSelection = emptySelection();
  private drag: Drag = { kind: 'none' };
  private previewPos: Map<string, Vec2> | null = null;
  private previewComment: Map<string, GraphRect> | null = null;
  private previewGroup: Map<string, GraphRect> | null = null;
  private panX = 48;
  private panY = 48;
  private zoom = 1;
  private space = false;
  private didFrame = false;
  private pasteSerial = 0;
  private clipboard: GraphClipboard | null = null;
  private readonly debug: DebugOverlay = createDebugOverlay();
  private debugUnsub: (() => void) | null = null;
  private readonly stopDoc: () => void;
  private readonly stopBus: () => void;
  private readonly resizeObserver: ResizeObserver;
  private statusTimer = 0;

  constructor(
    host: HTMLElement,
    controller: GraphController,
    registry: NodeRegistry,
    onChange?: (document: GraphDocument) => void,
  ) {
    this.controller = controller;
    this.registry = registry;
    this.notify = onChange;
    this.doc = controller.getDocument();
    const doc = host.ownerDocument;
    ensureNodeGraphStyles(doc);

    this.root = h(doc, 'div', 'ng-root');
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Node graph');
    this.root.style.setProperty('--ng-node-w', `${LAYOUT.nodeWidth}px`);
    this.root.style.setProperty('--ng-header-h', `${LAYOUT.header}px`);
    this.root.style.setProperty('--ng-row-h', `${LAYOUT.row}px`);
    this.root.style.setProperty('--ng-pin-size', `${LAYOUT.pin}px`);

    const toolbar = h(doc, 'div', 'ng-toolbar');
    this.undoButton = button(doc, 'Undo');
    this.redoButton = button(doc, 'Redo');
    const commentButton = button(doc, 'Comment');
    const groupButton = button(doc, 'Group');
    const frameButton = button(doc, 'Frame');
    const zoomOut = button(doc, '−');
    const zoomIn = button(doc, '+');
    zoomOut.setAttribute('aria-label', 'Zoom out');
    zoomIn.setAttribute('aria-label', 'Zoom in');
    this.zoomLabel = h(doc, 'span', 'ng-zoom', '100%');
    toolbar.append(this.undoButton, this.redoButton, commentButton, groupButton, frameButton, zoomOut, zoomIn, this.zoomLabel);

    const body = h(doc, 'div', 'ng-body');
    const palette = h(doc, 'aside', 'ng-palette');
    palette.setAttribute('aria-label', 'Node palette');
    this.searchInput = h(doc, 'input', 'ng-search');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search nodes';
    this.searchInput.setAttribute('aria-label', 'Search nodes');
    this.searchInput.autocomplete = 'off';
    this.searchInput.spellcheck = false;
    this.paletteList = h(doc, 'div', 'ng-palette-list');
    palette.append(this.searchInput, this.paletteList);

    this.stage = h(doc, 'div', 'ng-stage');
    this.world = h(doc, 'div', 'ng-world');
    this.marquee = h(doc, 'div', 'ng-marquee');
    this.minimap = doc.createElementNS(SVG_NS, 'svg');
    this.minimap.setAttribute('class', 'ng-minimap');
    this.minimap.setAttribute('aria-label', 'Minimap');
    const status = h(doc, 'div', 'ng-status');
    this.hint = h(doc, 'span', 'ng-hint', HINT);
    this.error = h(doc, 'span', 'ng-error');
    status.append(this.hint, this.error);
    this.stage.append(this.world, this.marquee, this.minimap, status);
    body.append(palette, this.stage);
    this.ghost = h(doc, 'div', 'ng-ghost');
    this.ghost.hidden = true;
    this.root.append(toolbar, body, this.ghost);
    host.replaceChildren(this.root);

    this.undoButton.addEventListener('click', () => this.undo());
    this.redoButton.addEventListener('click', () => this.redo());
    commentButton.addEventListener('click', () => this.addComment());
    groupButton.addEventListener('click', () => this.addGroup());
    frameButton.addEventListener('click', () => this.frame());
    zoomOut.addEventListener('click', () => this.zoomBy(1 / 1.1));
    zoomIn.addEventListener('click', () => this.zoomBy(1.1));
    this.searchInput.addEventListener('input', () => this.renderPalette());
    this.paletteList.addEventListener('pointerdown', (event) => this.onPalettePointerDown(event));
    this.stage.addEventListener('pointerdown', (event) => this.onStagePointerDown(event));
    this.root.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.root.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.root.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    this.stage.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.stage.addEventListener('contextmenu', (event) => event.preventDefault());
    this.stage.addEventListener('dblclick', (event) => this.onDoubleClick(event));
    this.minimap.addEventListener('pointerdown', (event) => this.onMinimapPointerDown(event));
    this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.root.addEventListener('keyup', (event) => {
      if (event.code === 'Space') this.space = false;
    });
    this.root.addEventListener('copy', (event) => this.onCopy(event));
    this.root.addEventListener('paste', (event) => this.onPaste(event));
    this.root.addEventListener('focusout', (event) => this.onFocusOut(event));
    this.root.addEventListener('change', (event) => this.onFieldChange(event));

    this.stopDoc = controller.subscribe(() => {
      this.doc = controller.getDocument();
      this.notify?.(this.doc);
      if (this.drag.kind === 'none') this.render();
      else this.syncFrame();
    });
    this.stopBus = controller.undo.subscribe(() => this.syncHistory());
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.didFrame && this.stage.clientWidth > 40 && this.stage.clientHeight > 40) {
        this.didFrame = true;
        this.frame();
      } else this.syncMinimap();
    });
    this.resizeObserver.observe(this.stage);
    this.render();
    this.notify?.(this.doc);
  }

  destroy(): void {
    window.clearTimeout(this.statusTimer);
    this.resizeObserver.disconnect();
    this.debugUnsub?.();
    this.stopDoc();
    this.stopBus();
    this.root.remove();
  }

  getDocument(): GraphDocument {
    return this.controller.getDocument();
  }

  setDocument(document: GraphDocument): void {
    this.controller.replaceDocument(document);
  }

  onChange(listener: (document: GraphDocument) => void): () => void {
    return this.controller.subscribe(() => listener(this.controller.getDocument()));
  }

  select(ids: readonly string[]): void {
    const wanted = new Set(ids);
    this.selection = {
      nodes: this.doc.nodes.filter((node) => wanted.has(node.id)).map((node) => node.id),
      comments: this.doc.comments.filter((comment) => wanted.has(comment.id)).map((comment) => comment.id),
      groups: this.doc.groups.filter((group) => wanted.has(group.id)).map((group) => group.id),
      edge: null,
    };
    this.render();
  }

  getSelection(): string[] {
    return [...this.selection.nodes, ...this.selection.comments, ...this.selection.groups];
  }

  frame(ids?: readonly string[]): void {
    const wanted = ids ? new Set(ids) : null;
    const selected =
      !wanted &&
      (this.selection.nodes.length > 0 || this.selection.comments.length > 0 || this.selection.groups.length > 0);
    const rects: GraphRect[] = [];
    for (const node of this.doc.nodes) {
      if (!includeId(node.id, wanted, selected, this.selection.nodes)) continue;
      rects.push(nodeRect(this.positioned(node), this.fieldCount(node.type)));
    }
    for (const comment of this.doc.comments) {
      if (!includeId(comment.id, wanted, selected, this.selection.comments)) continue;
      rects.push(this.commentRect(comment.id, comment.rect));
    }
    for (const group of this.doc.groups) {
      if (!includeId(group.id, wanted, selected, this.selection.groups)) continue;
      rects.push(this.groupRect(group.id, group.rect));
    }
    const bounds = unionRects(rects);
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    if (!bounds || width < 1 || height < 1) return;
    const pad = 72;
    this.zoom = clamp(Math.min(width / (bounds.w + pad * 2), height / (bounds.h + pad * 2), 1), 0.25, 2);
    this.panX = (width - bounds.w * this.zoom) / 2 - bounds.x * this.zoom;
    this.panY = (height - bounds.h * this.zoom) / 2 - bounds.y * this.zoom;
    this.applyCamera();
    this.syncMinimap();
  }

  setDebugSource(source: DebugSource | null): void {
    this.debugUnsub?.();
    this.debugUnsub = null;
    this.debug.executing.clear();
    this.debug.values.clear();
    if (source) {
      this.debugUnsub = source.subscribe((event) => {
        applyDebugEvent(this.debug, event);
        this.syncFrame();
      });
    }
    this.syncFrame();
  }

  undo(): void {
    this.controller.undo.undo();
  }

  redo(): void {
    this.controller.undo.redo();
  }

  private render(): void {
    this.renderPalette();
    this.renderWorld();
    this.syncFrame();
    this.syncHistory();
  }

  private renderPalette(): void {
    const doc = this.root.ownerDocument;
    const matches = searchNodes(this.registry, this.searchInput.value);
    const groups = new Map<string, NodeDefinition[]>();
    for (const definition of matches) {
      const list = groups.get(definition.category) ?? [];
      list.push(definition);
      groups.set(definition.category, list);
    }
    this.paletteList.replaceChildren();
    if (matches.length === 0) {
      this.paletteList.append(h(doc, 'p', 'ng-empty', 'No matching nodes'));
      return;
    }
    for (const [category, definitions] of groups) {
      const block = h(doc, 'section', 'ng-cat');
      block.append(h(doc, 'h3', 'ng-cat-title', category));
      for (const definition of definitions) {
        const item = button(doc, '');
        item.className = 'ng-palette-item';
        item.dataset.nodeType = definition.typeId;
        item.title = definition.doc;
        item.append(
          h(doc, 'span', 'ng-palette-title', nodeTitle(definition, definition.typeId)),
          h(doc, 'span', 'ng-palette-doc', definition.doc),
        );
        block.append(item);
      }
      this.paletteList.append(block);
    }
  }

  private renderWorld(): void {
    const doc = this.root.ownerDocument;
    const fragment = doc.createDocumentFragment();
    for (const group of this.doc.groups) fragment.append(this.renderGroup(doc, group.id, group.title, this.groupRect(group.id, group.rect)));
    for (const comment of this.doc.comments) {
      fragment.append(this.renderComment(doc, comment.id, comment.text, this.commentRect(comment.id, comment.rect)));
    }
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ng-wires');
    fragment.append(svg);
    for (const node of this.doc.nodes) fragment.append(this.renderNode(doc, node));
    this.world.replaceChildren(fragment);
  }

  private renderGroup(doc: Document, id: string, title: string, rect: GraphRect): HTMLElement {
    const el = h(doc, 'div', 'ng-group');
    el.dataset.id = id;
    if (this.selection.groups.includes(id)) el.classList.add('is-selected');
    placeRect(el, rect);
    const label = h(doc, 'div', 'ng-group-title', title);
    el.append(label);
    return el;
  }

  private renderComment(doc: Document, id: string, text: string, rect: GraphRect): HTMLElement {
    const el = h(doc, 'div', 'ng-comment');
    el.dataset.id = id;
    if (this.selection.comments.includes(id)) el.classList.add('is-selected');
    placeRect(el, rect);
    el.append(h(doc, 'div', 'ng-comment-bar', 'Comment'));
    const area = h(doc, 'textarea', 'ng-comment-text') as HTMLTextAreaElement;
    area.value = text;
    area.setAttribute('aria-label', 'Comment text');
    const handle = button(doc, '');
    handle.className = 'ng-resize';
    handle.dataset.resize = id;
    handle.setAttribute('aria-label', 'Resize comment');
    el.append(area, handle);
    return el;
  }

  private renderNode(doc: Document, node: GraphNode): HTMLElement {
    const definition = this.registry.get(node.type);
    const title = nodeTitle(definition, node.type);
    const el = h(doc, 'article', 'ng-node');
    el.dataset.id = node.id;
    el.dataset.category = definition?.category ?? '';
    el.style.setProperty('--ng-cat', CATEGORY_COLOR[definition?.category ?? ''] ?? 'var(--border-strong)');
    el.title = definition?.doc ?? title;
    if (this.selection.nodes.includes(node.id)) el.classList.add('is-selected');
    const positioned = this.positioned(node);
    const rect = nodeRect(positioned, definition?.fields?.length ?? 0);
    el.style.transform = `translate(${positioned.pos.x}px, ${positioned.pos.y}px)`;
    el.style.minHeight = `${rect.h}px`;
    el.append(h(doc, 'header', 'ng-node-title', title));

    const inputs = node.pins.filter((pin) => pin.direction === 'in');
    const outputs = node.pins.filter((pin) => pin.direction === 'out');
    const rows = Math.max(inputs.length, outputs.length, 1);
    for (let index = 0; index < rows; index += 1) {
      const row = h(doc, 'div', 'ng-pin-row');
      row.style.top = `${LAYOUT.header + index * LAYOUT.row}px`;
      const input = inputs[index];
      const output = outputs[index];
      if (input) row.append(this.renderPin(doc, node.id, input));
      if (input) row.append(h(doc, 'span', 'ng-pin-label', input.name));
      const label = row.lastElementChild;
      if (label instanceof HTMLElement && input) label.dataset.direction = 'in';
      row.append(h(doc, 'span', 'ng-pin-gap'));
      if (output) {
        const name = h(doc, 'span', 'ng-pin-label', output.name);
        name.dataset.direction = 'out';
        row.append(name, this.renderPin(doc, node.id, output));
      }
      el.append(row);
    }
    const pinSpace = h(doc, 'div');
    pinSpace.style.height = `${rows * LAYOUT.row}px`;
    el.append(pinSpace);

    const fields = definition?.fields ?? [];
    if (fields.length > 0) {
      const box = h(doc, 'div', 'ng-fields');
      for (const field of fields) {
        const line = h(doc, 'label', 'ng-field');
        line.append(h(doc, 'span', 'ng-field-label', field.label));
        const input = h(doc, 'input') as HTMLInputElement;
        input.dataset.nodeId = node.id;
        input.dataset.fieldKey = field.key;
        input.dataset.fieldKind = field.kind;
        input.setAttribute('aria-label', `${title} ${field.label}`);
        if (field.kind === 'boolean') {
          input.type = 'checkbox';
          input.checked = node.props[field.key] === true;
        } else {
          input.type = field.kind === 'number' ? 'number' : 'text';
          const value = node.props[field.key];
          input.value = value == null ? '' : String(value);
          input.spellcheck = false;
        }
        line.append(input);
        box.append(line);
      }
      el.append(box);
    }
    return el;
  }

  private renderPin(doc: Document, nodeId: string, pin: GraphNode['pins'][number]): HTMLButtonElement {
    const buttonEl = button(doc, '');
    buttonEl.className = 'ng-pin';
    buttonEl.dataset.pinNode = nodeId;
    buttonEl.dataset.pinId = pin.id;
    buttonEl.dataset.kind = pin.kind;
    buttonEl.dataset.direction = pin.direction;
    buttonEl.dataset.type = pin.kind === 'exec' ? 'exec' : (pin.dataType ?? 'any');
    buttonEl.setAttribute('aria-label', `${pin.name || pin.id} ${pin.kind} ${pin.direction}`);
    return buttonEl;
  }

  private syncFrame(): void {
    for (const el of this.world.querySelectorAll<HTMLElement>('.ng-node')) {
      const node = this.doc.nodes.find((item) => item.id === el.dataset.id);
      if (!node) continue;
      const pos = this.positioned(node).pos;
      el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      el.classList.toggle('is-executing', this.debug.executing.has(node.id));
    }
    for (const el of this.world.querySelectorAll<HTMLElement>('.ng-comment')) {
      const comment = this.doc.comments.find((item) => item.id === el.dataset.id);
      if (!comment) continue;
      placeRect(el, this.commentRect(comment.id, comment.rect));
    }
    for (const el of this.world.querySelectorAll<HTMLElement>('.ng-group')) {
      const group = this.doc.groups.find((item) => item.id === el.dataset.id);
      if (!group) continue;
      placeRect(el, this.groupRect(group.id, group.rect));
    }
    this.drawWires();
    this.markCompatiblePins();
    this.applyCamera();
    this.syncMinimap();
    this.root.classList.toggle('is-wiring', this.drag.kind === 'wire');
    this.root.classList.toggle('is-panning', this.drag.kind === 'pan' || this.space);
  }

  private drawWires(): void {
    const svg = this.world.querySelector('.ng-wires');
    if (!svg) return;
    const doc = this.root.ownerDocument;
    svg.replaceChildren();
    for (const label of this.world.querySelectorAll('.ng-wire-label')) label.remove();
    for (const edge of this.doc.edges) {
      const ends = this.edgeEnds(edge.from.node, edge.from.pin, edge.to.node, edge.to.pin);
      if (!ends) continue;
      const source = this.doc.nodes.find((node) => node.id === edge.from.node)?.pins.find((pin) => pin.id === edge.from.pin);
      const wire = wireGeometry(ends.from, ends.to, 'out');
      const hit = doc.createElementNS(SVG_NS, 'path');
      hit.setAttribute('class', 'ng-wire-hit');
      hit.setAttribute('d', wire.path);
      hit.dataset.fromNode = edge.from.node;
      hit.dataset.fromPin = edge.from.pin;
      hit.dataset.toNode = edge.to.node;
      hit.dataset.toPin = edge.to.pin;
      const path = doc.createElementNS(SVG_NS, 'path');
      const selectedEdge = this.selection.edge;
      const selected = Boolean(
        selectedEdge &&
          selectedEdge.fromNode === edge.from.node &&
          selectedEdge.fromPin === edge.from.pin &&
          selectedEdge.toNode === edge.to.node &&
          selectedEdge.toPin === edge.to.pin,
      );
      path.setAttribute('class', selected ? 'ng-wire is-selected' : 'ng-wire');
      path.dataset.kind = source?.kind ?? 'data';
      path.dataset.type = source?.kind === 'exec' ? 'exec' : (source?.dataType ?? 'any');
      path.setAttribute('d', wire.path);
      svg.append(hit, path);
      const value = formatDebugValue(this.debug.values.get(edgeWireId(edge)));
      if (value) {
        const tag = h(doc, 'div', 'ng-wire-label', value);
        tag.style.left = `${wire.mid.x}px`;
        tag.style.top = `${wire.mid.y}px`;
        this.world.append(tag);
      }
    }
    if (this.drag.kind === 'wire') {
      const origin = pinAnchor(this.nodeById(this.drag.origin.node), this.drag.origin.pin);
      if (origin) {
        const wire = wireGeometry(origin, { x: this.drag.x, y: this.drag.y }, this.drag.dir);
        const path = doc.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'ng-wire');
        path.dataset.kind = this.drag.dir === 'in' || this.drag.dir === 'out' ? this.pinKind(this.drag.origin) : 'exec';
        path.dataset.type = this.pinType(this.drag.origin);
        path.setAttribute('d', wire.path);
        svg.append(path);
      }
    }
  }

  private syncMinimap(): void {
    const doc = this.root.ownerDocument;
    const rects: GraphRect[] = [];
    for (const node of this.doc.nodes) rects.push(nodeRect(this.positioned(node), this.fieldCount(node.type)));
    for (const comment of this.doc.comments) rects.push(this.commentRect(comment.id, comment.rect));
    for (const group of this.doc.groups) rects.push(this.groupRect(group.id, group.rect));
    const bounds = padRect(unionRects(rects) ?? { x: 0, y: 0, w: 800, h: 480 }, 80);
    this.minimap.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
    this.minimap.replaceChildren();
    for (const group of this.doc.groups) this.minimap.append(this.mapRect(doc, this.groupRect(group.id, group.rect), 'ng-mm-group'));
    for (const comment of this.doc.comments) this.minimap.append(this.mapRect(doc, this.commentRect(comment.id, comment.rect), 'ng-mm-comment'));
    for (const node of this.doc.nodes) {
      this.minimap.append(this.mapRect(doc, nodeRect(this.positioned(node), this.fieldCount(node.type)), 'ng-mm-node'));
    }
    const width = this.stage.clientWidth / this.zoom;
    const height = this.stage.clientHeight / this.zoom;
    const view = this.mapRect(doc, { x: -this.panX / this.zoom, y: -this.panY / this.zoom, w: width, h: height }, 'ng-mm-view');
    view.setAttribute('vector-effect', 'non-scaling-stroke');
    view.setAttribute('stroke-width', '2');
    this.minimap.append(view);
  }

  private mapRect(doc: Document, rect: GraphRect, className: string): SVGRectElement {
    const el = doc.createElementNS(SVG_NS, 'rect');
    el.setAttribute('class', className);
    el.setAttribute('x', String(rect.x));
    el.setAttribute('y', String(rect.y));
    el.setAttribute('width', String(Math.max(rect.w, 1)));
    el.setAttribute('height', String(Math.max(rect.h, 1)));
    return el;
  }

  private applyCamera(): void {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  private syncHistory(): void {
    this.undoButton.disabled = !this.controller.undo.canUndo();
    this.redoButton.disabled = !this.controller.undo.canRedo();
  }

  private onStagePointerDown(event: PointerEvent): void {
    if (this.drag.kind === 'palette') return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.ng-minimap')) return;
    if (this.wantsPan(event)) {
      this.beginPan(event);
      return;
    }
    if (event.button !== 0) return;
    this.focusGraph(target);
    if (isEditableTarget(target)) return;
    const resize = target?.closest<HTMLElement>('[data-resize]');
    if (resize?.dataset.resize) {
      this.beginResize(event, resize.dataset.resize);
      return;
    }
    const pin = target?.closest<HTMLElement>('[data-pin-id]');
    if (pin?.dataset.pinNode && pin.dataset.pinId) {
      this.beginWire(event, { node: pin.dataset.pinNode, pin: pin.dataset.pinId }, (pin.dataset.direction as PinDirection) || 'out');
      return;
    }
    const node = target?.closest<HTMLElement>('.ng-node');
    if (node?.dataset.id) {
      this.beginNodeDrag(event, node.dataset.id);
      return;
    }
    const comment = target?.closest<HTMLElement>('.ng-comment');
    if (comment?.dataset.id && target?.closest('.ng-comment-bar')) {
      this.beginCommentDrag(event, comment.dataset.id);
      return;
    }
    const group = target?.closest<HTMLElement>('.ng-group');
    if (group?.dataset.id) {
      this.beginGroupDrag(event, group.dataset.id);
      return;
    }
    const wire = target?.closest<SVGElement>('.ng-wire-hit');
    if (wire?.dataset.fromNode && wire.dataset.fromPin && wire.dataset.toNode && wire.dataset.toPin) {
      this.selection = {
        nodes: [],
        comments: [],
        groups: [],
        edge: {
          fromNode: wire.dataset.fromNode,
          fromPin: wire.dataset.fromPin,
          toNode: wire.dataset.toNode,
          toPin: wire.dataset.toPin,
        },
      };
      this.render();
      return;
    }
    this.beginMarquee(event);
  }

  private onPalettePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-node-type]') : null;
    if (!item?.dataset.nodeType) return;
    event.preventDefault();
    this.capture(event);
    this.drag = {
      kind: 'palette',
      pointerId: event.pointerId,
      type: item.dataset.nodeType,
      title: item.querySelector('.ng-palette-title')?.textContent ?? item.dataset.nodeType,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag.kind === 'none' || drag.pointerId !== event.pointerId) return;
    if (drag.kind === 'pan') {
      this.panX += event.clientX - drag.x;
      this.panY += event.clientY - drag.y;
      this.drag = { ...drag, x: event.clientX, y: event.clientY };
      this.didFrame = true;
      this.applyCamera();
      this.syncMinimap();
      return;
    }
    if (drag.kind === 'marquee') {
      this.drag = { ...drag, x1: event.clientX, y1: event.clientY };
      this.paintMarquee();
      return;
    }
    if (drag.kind === 'nodes') {
      const world = this.screenToWorld(event.clientX, event.clientY);
      const dx = world.x - drag.origin.x;
      const dy = world.y - drag.origin.y;
      this.previewPos = new Map([...drag.start].map(([id, pos]) => [id, { x: pos.x + dx, y: pos.y + dy }]));
      this.syncFrame();
      return;
    }
    if (drag.kind === 'comment' || drag.kind === 'resize') {
      const world = this.screenToWorld(event.clientX, event.clientY);
      const dx = world.x - drag.origin.x;
      const dy = world.y - drag.origin.y;
      const rect =
        drag.kind === 'comment'
          ? { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy }
          : { ...drag.rect, w: Math.max(80, drag.rect.w + dx), h: Math.max(48, drag.rect.h + dy) };
      this.previewComment = new Map([[drag.id, rect]]);
      this.syncFrame();
      return;
    }
    if (drag.kind === 'group') {
      const world = this.screenToWorld(event.clientX, event.clientY);
      const dx = world.x - drag.origin.x;
      const dy = world.y - drag.origin.y;
      this.previewGroup = new Map([[drag.id, { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy }]]);
      this.previewPos = new Map([...drag.nodes].map(([id, pos]) => [id, { x: pos.x + dx, y: pos.y + dy }]));
      this.syncFrame();
      return;
    }
    if (drag.kind === 'wire') {
      const world = this.screenToWorld(event.clientX, event.clientY);
      this.drag = { ...drag, x: world.x, y: world.y };
      this.syncFrame();
      return;
    }
    if (drag.kind === 'palette') {
      const moved = drag.moved || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4;
      this.drag = { ...drag, moved };
      this.ghost.hidden = !moved;
      this.ghost.textContent = drag.title;
      this.ghost.style.left = `${event.clientX + 12}px`;
      this.ghost.style.top = `${event.clientY + 12}px`;
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (drag.kind === 'none' || drag.pointerId !== event.pointerId) return;
    this.drag = { kind: 'none' };
    this.ghost.hidden = true;
    this.marquee.classList.remove('is-on');
    if (drag.kind === 'nodes' && this.previewPos) {
      const positions = Object.fromEntries(this.previewPos);
      this.previewPos = null;
      this.controller.moveNodes(positions);
    } else if (drag.kind === 'comment' && this.previewComment) {
      const rects = Object.fromEntries(this.previewComment);
      this.previewComment = null;
      this.controller.moveComments(rects);
    } else if (drag.kind === 'resize' && this.previewComment) {
      const rects = Object.fromEntries(this.previewComment);
      this.previewComment = null;
      this.controller.moveComments(rects);
    } else if (drag.kind === 'group') {
      const rects = Object.fromEntries(this.previewGroup ?? []);
      const positions = Object.fromEntries(this.previewPos ?? []);
      this.previewGroup = null;
      this.previewPos = null;
      this.controller.moveGroups(rects, positions);
    } else if (drag.kind === 'wire') {
      this.finishWire(event, drag.origin);
    } else if (drag.kind === 'marquee') {
      this.finishMarquee(drag);
    } else if (drag.kind === 'palette') {
      this.finishPalette(event, drag);
    } else {
      this.previewPos = null;
      this.previewComment = null;
      this.previewGroup = null;
    }
    if (this.drag.kind === 'none') this.render();
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.didFrame = true;
    const rect = this.stage.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    if (event.shiftKey) {
      this.panX -= event.deltaX || event.deltaY;
      this.panY -= event.deltaX ? event.deltaY : 0;
    } else {
      const worldX = (sx - this.panX) / this.zoom;
      const worldY = (sy - this.panY) / this.zoom;
      const next = clamp(this.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), 0.25, 2);
      this.panX = sx - worldX * next;
      this.panY = sy - worldY * next;
      this.zoom = next;
    }
    this.applyCamera();
    this.syncMinimap();
  }

  private onMinimapPointerDown(event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.didFrame = true;
    this.centerOnMinimap(event);
    this.stage.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId) this.centerOnMinimap(next);
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      this.stage.removeEventListener('pointermove', move);
      this.stage.removeEventListener('pointerup', up);
    };
    this.stage.addEventListener('pointermove', move);
    this.stage.addEventListener('pointerup', up);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Space' && !isEditableTarget(event.target instanceof Element ? event.target : null)) {
      this.space = true;
      this.root.classList.add('is-panning');
      event.preventDefault();
      return;
    }
    if (isEditableTarget(event.target instanceof Element ? event.target : null)) {
      if (event.key === 'Escape' && event.target instanceof HTMLElement) event.target.blur();
      return;
    }
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      event.stopPropagation();
      this.redo();
      return;
    }
    if (meta && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.selection = {
        nodes: this.doc.nodes.map((node) => node.id),
        comments: this.doc.comments.map((comment) => comment.id),
        groups: this.doc.groups.map((group) => group.id),
        edge: null,
      };
      this.render();
      return;
    }
    if (meta && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.duplicate();
      return;
    }
    if (event.key === 'Escape') {
      this.drag = { kind: 'none' };
      this.selection = emptySelection();
      this.render();
      return;
    }
    if (event.key === 'f' || event.key === 'F') {
      this.frame();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
    }
  }

  private onCopy(event: ClipboardEvent): void {
    if (isEditableTarget(event.target instanceof Element ? event.target : null)) return;
    const payload = this.controller.copy(this.selection);
    if (payload.nodes.length === 0 && payload.comments.length === 0 && payload.groups.length === 0) return;
    this.clipboard = payload;
    this.pasteSerial = 0;
    event.clipboardData?.setData('application/x-jurfi-graph', JSON.stringify(payload));
    event.preventDefault();
  }

  private onPaste(event: ClipboardEvent): void {
    if (isEditableTarget(event.target instanceof Element ? event.target : null)) return;
    const raw = event.clipboardData?.getData('application/x-jurfi-graph');
    const payload = raw ? safeClipboard(raw) : this.clipboard;
    if (!payload) return;
    event.preventDefault();
    this.pastePayload(payload);
  }

  private onDoubleClick(event: MouseEvent): void {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target?.classList.contains('ng-group-title')) return;
    target.contentEditable = 'true';
    target.focus();
  }

  private onFocusOut(event: FocusEvent): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains('ng-group-title')) {
      target.contentEditable = 'false';
      const id = target.closest('.ng-group')?.getAttribute('data-id');
      if (id) this.controller.setGroupTitle(id, target.textContent ?? '');
      return;
    }
    if (target instanceof HTMLTextAreaElement && target.classList.contains('ng-comment-text')) {
      const id = target.closest('.ng-comment')?.getAttribute('data-id');
      if (id) this.controller.setCommentText(id, target.value);
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.nodeId && target.dataset.fieldKey && target.dataset.fieldKind !== 'boolean') {
      if (target.dataset.fieldKind === 'number') {
        const value = Number(target.value);
        if (!Number.isFinite(value)) {
          this.setStatus('Enter a number');
          return;
        }
        this.controller.setProp(target.dataset.nodeId, target.dataset.fieldKey, value);
        return;
      }
      this.controller.setProp(target.dataset.nodeId, target.dataset.fieldKey, target.value);
    }
  }

  private onFieldChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
    if (!target.dataset.nodeId || !target.dataset.fieldKey) return;
    this.controller.setProp(target.dataset.nodeId, target.dataset.fieldKey, target.checked);
  }

  private beginPan(event: PointerEvent): void {
    this.didFrame = true;
    this.capture(event);
    this.drag = { kind: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    this.root.classList.add('is-panning');
  }

  private beginMarquee(event: PointerEvent): void {
    this.capture(event);
    this.drag = {
      kind: 'marquee',
      pointerId: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      x1: event.clientX,
      y1: event.clientY,
      additive: event.shiftKey,
    };
    if (!event.shiftKey) this.selection = emptySelection();
    this.paintMarquee();
    this.render();
    this.drag = {
      kind: 'marquee',
      pointerId: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      x1: event.clientX,
      y1: event.clientY,
      additive: event.shiftKey,
    };
  }

  private beginNodeDrag(event: PointerEvent, id: string): void {
    if (event.shiftKey) {
      this.selection = { ...this.selection, edge: null, nodes: toggleMember(this.selection.nodes, id) };
      this.render();
      return;
    }
    if (!this.selection.nodes.includes(id)) {
      this.selection = { nodes: [id], comments: [], groups: [], edge: null };
    }
    this.render();
    const origin = this.screenToWorld(event.clientX, event.clientY);
    const ids = this.selection.nodes.length > 0 ? this.selection.nodes : [id];
    const start = new Map<string, Vec2>();
    for (const nodeId of ids) {
      const node = this.doc.nodes.find((item) => item.id === nodeId);
      if (node) start.set(nodeId, { ...nodePos(node) });
    }
    this.capture(event);
    this.drag = { kind: 'nodes', pointerId: event.pointerId, origin, start };
  }

  private beginCommentDrag(event: PointerEvent, id: string): void {
    if (event.shiftKey) {
      this.selection = { ...this.selection, edge: null, comments: toggleMember(this.selection.comments, id) };
      this.render();
      return;
    }
    if (!this.selection.comments.includes(id)) this.selection = { nodes: [], comments: [id], groups: [], edge: null };
    const comment = this.doc.comments.find((item) => item.id === id);
    if (!comment) return;
    this.render();
    this.capture(event);
    this.drag = {
      kind: 'comment',
      pointerId: event.pointerId,
      id,
      origin: this.screenToWorld(event.clientX, event.clientY),
      rect: { ...comment.rect },
    };
  }

  private beginGroupDrag(event: PointerEvent, id: string): void {
    if (event.shiftKey) {
      this.selection = { ...this.selection, edge: null, groups: toggleMember(this.selection.groups, id) };
      this.render();
      return;
    }
    if (!this.selection.groups.includes(id)) this.selection = { nodes: [], comments: [], groups: [id], edge: null };
    const group = this.doc.groups.find((item) => item.id === id);
    if (!group) return;
    this.render();
    const nodes = new Map<string, Vec2>();
    for (const nodeId of group.nodeIds) {
      const node = this.doc.nodes.find((item) => item.id === nodeId);
      if (node) nodes.set(nodeId, { ...nodePos(node) });
    }
    this.capture(event);
    this.drag = {
      kind: 'group',
      pointerId: event.pointerId,
      id,
      origin: this.screenToWorld(event.clientX, event.clientY),
      rect: { ...group.rect },
      nodes,
    };
  }

  private beginResize(event: PointerEvent, id: string): void {
    const comment = this.doc.comments.find((item) => item.id === id);
    if (!comment) return;
    event.preventDefault();
    this.capture(event);
    this.drag = {
      kind: 'resize',
      pointerId: event.pointerId,
      id,
      origin: this.screenToWorld(event.clientX, event.clientY),
      rect: { ...comment.rect },
    };
  }

  private beginWire(event: PointerEvent, origin: GraphEndpoint, dir: PinDirection): void {
    event.preventDefault();
    const world = this.screenToWorld(event.clientX, event.clientY);
    this.capture(event);
    this.drag = { kind: 'wire', pointerId: event.pointerId, origin, dir, x: world.x, y: world.y };
    this.syncFrame();
  }

  private finishWire(event: PointerEvent, origin: GraphEndpoint): void {
    const direct = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pin-id]') : null;
    const fallen = this.root.ownerDocument.elementFromPoint(event.clientX, event.clientY);
    const pin = direct ?? (fallen instanceof Element ? fallen.closest<HTMLElement>('[data-pin-id]') : null);
    if (!pin?.dataset.pinNode || !pin.dataset.pinId) {
      this.setStatus('');
      return;
    }
    const error = this.controller.connect(origin, { node: pin.dataset.pinNode, pin: pin.dataset.pinId });
    this.setStatus(error && error !== 'Cannot connect a pin to itself' ? error : '');
  }

  private finishMarquee(drag: Extract<Drag, { kind: 'marquee' }>): void {
    const start = this.screenToWorld(drag.x0, drag.y0);
    const end = this.screenToWorld(drag.x1, drag.y1);
    const rect = normalizeRect(start.x, start.y, end.x, end.y);
    if (rect.w < 3 && rect.h < 3) {
      if (!drag.additive) this.selection = emptySelection();
      return;
    }
    const nodes = idsTouchingRect(
      this.doc.nodes.map((node) => ({ id: node.id, rect: nodeRect(node, this.fieldCount(node.type)) })),
      rect,
    );
    const comments = idsTouchingRect(
      this.doc.comments.map((comment) => ({ id: comment.id, rect: comment.rect })),
      rect,
    );
    const groups = idsTouchingRect(
      this.doc.groups.map((group) => ({ id: group.id, rect: group.rect })),
      rect,
    );
    this.selection = {
      nodes: mergeIds(drag.additive ? this.selection.nodes : [], nodes, drag.additive),
      comments: mergeIds(drag.additive ? this.selection.comments : [], comments, drag.additive),
      groups: mergeIds(drag.additive ? this.selection.groups : [], groups, drag.additive),
      edge: null,
    };
  }

  private finishPalette(event: PointerEvent, drag: Extract<Drag, { kind: 'palette' }>): void {
    const rect = this.stage.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    const world = drag.moved && inside
      ? this.screenToWorld(event.clientX, event.clientY)
      : this.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const id = this.controller.addNode(drag.type, { x: world.x - LAYOUT.nodeWidth / 2, y: world.y - 20 });
    if (id) this.selection = { nodes: [id], comments: [], groups: [], edge: null };
  }

  private paintMarquee(): void {
    if (this.drag.kind !== 'marquee') return;
    const rect = this.stage.getBoundingClientRect();
    const box = normalizeRect(this.drag.x0 - rect.left, this.drag.y0 - rect.top, this.drag.x1 - rect.left, this.drag.y1 - rect.top);
    this.marquee.classList.add('is-on');
    this.marquee.style.left = `${box.x}px`;
    this.marquee.style.top = `${box.y}px`;
    this.marquee.style.width = `${box.w}px`;
    this.marquee.style.height = `${box.h}px`;
  }

  private addComment(): void {
    const rect = this.stage.getBoundingClientRect();
    const world = this.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const id = this.controller.addComment({ x: world.x - 100, y: world.y - 40, w: 200, h: 96 }, 'Comment');
    if (id) this.selection = { nodes: [], comments: [id], groups: [], edge: null };
  }

  private addGroup(): void {
    if (this.selection.nodes.length === 0) {
      this.setStatus('Select nodes to group');
      return;
    }
    const rects = this.selection.nodes.flatMap((id) => {
      const node = this.doc.nodes.find((item) => item.id === id);
      return node ? [nodeRect(node, this.fieldCount(node.type))] : [];
    });
    const bounds = unionRects(rects);
    if (!bounds) return;
    const id = this.controller.addGroup(this.selection.nodes, padRect(bounds, 24), 'Group');
    if (id) this.selection = { ...this.selection, groups: [id], edge: null };
  }

  private deleteSelection(): void {
    this.controller.remove(this.selection);
    this.selection = emptySelection();
  }

  private duplicate(): void {
    const payload = this.controller.copy(this.selection);
    if (payload.nodes.length === 0 && payload.comments.length === 0 && payload.groups.length === 0) return;
    this.pasteSerial = 0;
    this.pastePayload(payload);
  }

  private pastePayload(payload: GraphClipboard): void {
    this.pasteSerial += 1;
    const offset = { x: 32 * this.pasteSerial, y: 32 * this.pasteSerial };
    const created = this.controller.paste(payload, offset);
    if (!created) return;
    this.selection = { nodes: created.nodes, comments: created.comments, groups: created.groups, edge: null };
  }

  private zoomBy(factor: number): void {
    this.didFrame = true;
    const sx = this.stage.clientWidth / 2;
    const sy = this.stage.clientHeight / 2;
    const worldX = (sx - this.panX) / this.zoom;
    const worldY = (sy - this.panY) / this.zoom;
    const next = clamp(this.zoom * factor, 0.25, 2);
    this.panX = sx - worldX * next;
    this.panY = sy - worldY * next;
    this.zoom = next;
    this.applyCamera();
    this.syncMinimap();
  }

  private centerOnMinimap(event: PointerEvent): void {
    const point = this.minimap.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = this.minimap.getScreenCTM();
    if (!matrix) return;
    const world = point.matrixTransform(matrix.inverse());
    this.panX = this.stage.clientWidth / 2 - world.x * this.zoom;
    this.panY = this.stage.clientHeight / 2 - world.y * this.zoom;
    this.applyCamera();
    this.syncMinimap();
  }

  private markCompatiblePins(): void {
    for (const pin of this.world.querySelectorAll<HTMLElement>('[data-pin-id]')) {
      pin.classList.remove('is-compatible', 'is-incompatible');
      if (this.drag.kind !== 'wire' || !pin.dataset.pinNode || !pin.dataset.pinId) continue;
      const result = evaluateConnection(this.doc, this.drag.origin, { node: pin.dataset.pinNode, pin: pin.dataset.pinId });
      pin.classList.add(result.ok ? 'is-compatible' : 'is-incompatible');
    }
  }

  private capture(event: PointerEvent): void {
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone if the browser cancelled the gesture.
    }
  }

  private wantsPan(event: PointerEvent): boolean {
    return event.button === 1 || event.button === 2 || event.altKey || this.space;
  }

  private focusGraph(target: Element | null): void {
    if (isEditableTarget(target)) return;
    this.root.focus();
  }

  private screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.zoom,
      y: (clientY - rect.top - this.panY) / this.zoom,
    };
  }

  private positioned(node: GraphNode): GraphNode & { pos: Vec2 } {
    const pos = this.previewPos?.get(node.id) ?? nodePos(node);
    if (node.pos === pos) return node as GraphNode & { pos: Vec2 };
    return { ...node, pos };
  }

  private commentRect(id: string, rect: GraphRect): GraphRect {
    return this.previewComment?.get(id) ?? rect;
  }

  private groupRect(id: string, rect: GraphRect): GraphRect {
    return this.previewGroup?.get(id) ?? rect;
  }

  private fieldCount(type: string): number {
    return this.registry.get(type)?.fields?.length ?? 0;
  }

  private nodeById(id: string): GraphNode {
    const node = this.doc.nodes.find((item) => item.id === id);
    if (!node) return { id, type: '', pins: [], props: {}, pos: { x: 0, y: 0 } };
    return this.positioned(node);
  }

  private edgeEnds(fromNode: string, fromPin: string, toNode: string, toPin: string): { from: Vec2; to: Vec2 } | null {
    const from = pinAnchor(this.nodeById(fromNode), fromPin);
    const to = pinAnchor(this.nodeById(toNode), toPin);
    if (!from || !to) return null;
    return { from, to };
  }

  private pinKind(endpoint: GraphEndpoint): string {
    return this.doc.nodes.find((node) => node.id === endpoint.node)?.pins.find((pin) => pin.id === endpoint.pin)?.kind ?? 'exec';
  }

  private pinType(endpoint: GraphEndpoint): string {
    const pin = this.doc.nodes.find((node) => node.id === endpoint.node)?.pins.find((item) => item.id === endpoint.pin);
    if (!pin || pin.kind === 'exec') return 'exec';
    return pin.dataType ?? 'any';
  }

  private setStatus(message: string): void {
    this.error.textContent = message;
    window.clearTimeout(this.statusTimer);
    if (!message) return;
    this.statusTimer = window.setTimeout(() => {
      this.error.textContent = '';
    }, 2400);
  }
}

function includeId(id: string, wanted: Set<string> | null, selected: boolean, selection: readonly string[]): boolean {
  if (wanted) return wanted.has(id);
  if (selected) return selection.includes(id);
  return true;
}

function isEditableTarget(target: Element | null): boolean {
  if (!target) return false;
  return Boolean(target.closest('input, textarea, [contenteditable="true"]'));
}

function placeRect(el: HTMLElement, rect: GraphRect): void {
  el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
}

function safeClipboard(raw: string): GraphClipboard | null {
  try {
    const value = JSON.parse(raw) as GraphClipboard;
    if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
    return {
      nodes: value.nodes,
      edges: value.edges,
      comments: Array.isArray(value.comments) ? value.comments : [],
      groups: Array.isArray(value.groups) ? value.groups : [],
    };
  } catch {
    return null;
  }
}

function h<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(doc: Document, label: string): HTMLButtonElement {
  const el = doc.createElement('button');
  el.type = 'button';
  el.textContent = label;
  return el;
}
