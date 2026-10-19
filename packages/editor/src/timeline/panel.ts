import {
  ClipPlayer,
  sampleClip,
  validateClip,
  type Clip,
  type KeyValue,
  type Tangent,
  type Track,
} from '@jurfi/anim';
import type { EditorContext } from '../context';
import { sampleCurve } from './curve';
import {
  deleteEvent,
  deleteKeys,
  insertEvent,
  insertKey,
  insertNumberTrack,
  patchEvent,
  readMeta,
  recordEdit,
  replaceClip,
  setKeyTangent,
  setKeysInterp,
  writeMeta,
  cloneClip,
} from './commands';
import { handlePoint, linearFallback, pointInRect, rangeOf, timeToX, valueToY, xToTime, yToValue, type ValueRange } from './geometry';
import { applyKeyMoves, type KeyMove } from './moves';
import { buildRows, type TimelineRow, type ViewMode } from './rows';
import { addRef, hasRef, toggleRef, uniqueKeyTimes, type KeyRef } from './selection';
import { clampTime, niceStep, snapTime, snapValue } from './snap';
import { isWholeQuat, readComponent, writeComponent } from './values';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PART_COLOR = ['var(--danger)', 'var(--ref-yellow-400)', 'var(--accent)', 'var(--text-2)'];

interface Hit {
  kind: 'key' | 'handle-in' | 'handle-out' | 'event';
  x: number;
  y: number;
  ref?: KeyRef;
  eventIndex?: number;
}

interface Geom {
  row: TimelineRow;
  top: number;
  height: number;
  range: ValueRange | null;
}

interface KeyDrag {
  kind: 'keys';
  pointerId: number;
  before: Clip;
  refs: KeyRef[];
  grabbed: KeyRef;
  startX: number;
  startY: number;
  range: ValueRange | null;
  rowTop: number;
  rowHeight: number;
  quat: boolean;
  moved: boolean;
  lastMoves: KeyMove[];
}

interface HandleDrag {
  kind: 'handle';
  pointerId: number;
  before: Clip;
  ref: KeyRef;
  side: 'in' | 'out';
  moved: boolean;
}

interface EventDrag {
  kind: 'event';
  pointerId: number;
  before: Clip;
  index: number;
  startX: number;
  origin: number;
  moved: boolean;
}

interface PlayDrag {
  kind: 'playhead';
  pointerId: number;
}

interface MarqueeDrag {
  kind: 'marquee';
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  additive: boolean;
}

type Drag = KeyDrag | HandleDrag | EventDrag | PlayDrag | MarqueeDrag;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function formatValue(value: KeyValue): string {
  if (typeof value === 'number') return value.toFixed(3);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  return value.map((item) => item.toFixed(2)).join(' ');
}

function refFor(row: TimelineRow, time: number, mode: ViewMode): KeyRef | null {
  if (!row.trackId) return null;
  if (row.kind === 'curve') return { trackId: row.trackId, t: time, part: row.part ?? 0 };
  if (mode === 'curves') return { trackId: row.trackId, t: time };
  return { trackId: row.trackId, t: time };
}

/**
 * Mount the timeline into a shell zone.
 * `clip` is mutated in place and kept by the caller across remounts.
 */
export function mountTimeline(host: HTMLElement, ctx: EditorContext, clip: Clip, initialTime = 0): { dispose: () => void; time: () => number } {
  host.classList.add('tl-host');
  const root = el('div', 'tl-root');
  root.tabIndex = 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', `${clip.name} timeline`);
  host.append(root);

  const toolbar = el('div', 'tl-toolbar');
  const body = el('div', 'tl-body');
  const labels = el('div', 'tl-labels');
  const labelHead = el('div', 'tl-label-head');
  labelHead.textContent = clip.name;
  const labelClip = el('div', 'tl-label-clip');
  const labelList = el('div', 'tl-label-list');
  labelClip.append(labelList);
  labels.append(labelHead, labelClip);
  const sheet = el('div', 'tl-sheet');
  const canvas = el('div', 'tl-canvas');
  const ruler = el('div', 'tl-ruler');
  const rulerSvg = svg('svg');
  ruler.append(rulerSvg);
  const plot = svg('svg');
  plot.classList.add('tl-plot');
  const playhead = el('div', 'tl-playhead');
  canvas.append(ruler, plot, playhead);
  sheet.append(canvas);
  body.append(labels, sheet);
  const footer = el('div', 'tl-footer');
  const readout = el('span', 'tl-readout');
  const eventsLine = el('span', 'tl-events');
  const errorLine = el('span', 'tl-errors');
  footer.append(readout, eventsLine, errorLine);
  const probe = el('div', 'tl-probe');
  root.append(toolbar, body, footer, probe);

  const playBtn = el('button', 'tl-btn');
  playBtn.type = 'button';
  const stopBtn = el('button', 'tl-btn');
  stopBtn.type = 'button';
  stopBtn.textContent = 'Stop';
  const loopBtn = el('button', 'tl-btn');
  loopBtn.type = 'button';
  loopBtn.textContent = 'Loop';
  const loopMode = el('select', 'tl-field');
  loopMode.innerHTML = '<option value="loop">Loop</option><option value="pingpong">Ping-pong</option>';
  const timeInput = el('input', 'tl-field');
  timeInput.type = 'number';
  timeInput.step = '0.001';
  timeInput.setAttribute('aria-label', 'Time in seconds');
  const snapBtn = el('button', 'tl-btn');
  snapBtn.type = 'button';
  snapBtn.textContent = 'Snap';
  const fpsLabel = el('span', 'tl-fps');
  const speed = el('select', 'tl-field');
  speed.setAttribute('aria-label', 'Playback speed');
  for (const value of ['0.25', '0.5', '1', '2', '-1']) {
    const option = el('option');
    option.value = value;
    option.textContent = `${value}×`;
    if (value === '1') option.selected = true;
    speed.append(option);
  }
  const dopeBtn = el('button', 'tl-btn');
  dopeBtn.type = 'button';
  dopeBtn.textContent = 'Dopesheet';
  const curveBtn = el('button', 'tl-btn');
  curveBtn.type = 'button';
  curveBtn.textContent = 'Curves';
  const addKeyBtn = el('button', 'tl-btn');
  addKeyBtn.type = 'button';
  addKeyBtn.textContent = 'Add key';
  const addEventBtn = el('button', 'tl-btn');
  addEventBtn.type = 'button';
  addEventBtn.textContent = 'Add event';
  const deleteBtn = el('button', 'tl-btn');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete';
  const interp = el('select', 'tl-field');
  interp.setAttribute('aria-label', 'Interpolation');
  interp.innerHTML = '<option value="">Interp</option><option value="step">Step</option><option value="linear">Linear</option><option value="bezier">Bezier</option>';
  const nameInput = el('input', 'tl-field');
  nameInput.type = 'text';
  nameInput.placeholder = 'Event name';
  nameInput.setAttribute('aria-label', 'Event name');
  const addTrackBtn = el('button', 'tl-btn');
  addTrackBtn.type = 'button';
  addTrackBtn.textContent = 'Add track';
  const zoomOut = el('button', 'tl-btn');
  zoomOut.type = 'button';
  zoomOut.textContent = '−';
  zoomOut.setAttribute('aria-label', 'Zoom out');
  const zoomIn = el('button', 'tl-btn');
  zoomIn.type = 'button';
  zoomIn.textContent = '+';
  zoomIn.setAttribute('aria-label', 'Zoom in');
  const fitBtn = el('button', 'tl-btn');
  fitBtn.type = 'button';
  fitBtn.textContent = 'Fit';
  toolbar.append(playBtn, stopBtn, loopBtn, loopMode, timeInput, snapBtn, fpsLabel, speed, dopeBtn, curveBtn, addKeyBtn, addEventBtn, deleteBtn, interp, nameInput, addTrackBtn, zoomOut, zoomIn, fitBtn);

  const player = new ClipPlayer(clip, { time: initialTime });
  const view: { mode: ViewMode; pps: number; snap: boolean } = { mode: 'dopesheet', pps: 160, snap: true };
  let selection: KeyRef[] = [];
  let activeTrackId = clip.tracks[0]?.id;
  const collapsed = new Set<string>();
  let selectedEvent: number | null = null;
  let eventLog: string[] = [];
  let drag: Drag | null = null;
  let geoms: Geom[] = [];
  let hits: Hit[] = [];
  let rulerH = 28;
  let raf = 0;
  let lastFrame = 0;

  const locked = (): Set<string> => new Set(readMeta(clip).locked);
  const muted = (): Set<string> => new Set(readMeta(clip).muted);

  function measure(curve: boolean): number {
    probe.classList.toggle('is-curve', curve);
    const height = probe.getBoundingClientRect().height;
    return height > 0 ? height : curve ? 56 : 28;
  }

  function syncPlayer(): void {
    player.loop = clip.loop;
    player.loopMode = clip.loopMode ?? 'loop';
    player.speed = Number(speed.value) || 1;
  }

  function commit(before: Clip, label: string): void {
    const after = cloneClip(clip);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    ctx.undo.push({
      label,
      undo() {
        replaceClip(clip, before);
      },
      redo() {
        replaceClip(clip, after);
      },
    });
  }

  function seekTo(time: number): void {
    const next = clampTime(snapTime(time, clip.fps, view.snap), clip.duration);
    player.seek(next);
    render();
  }

  function togglePlay(): void {
    if (player.playing) {
      player.pause();
      stopRaf();
    } else {
      player.play();
      startRaf();
    }
    render();
  }

  function startRaf(): void {
    if (raf !== 0) return;
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }

  function stopRaf(): void {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!player.playing) return;
    const dt = lastFrame === 0 ? 0 : Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (dt > 0) player.update(dt);
    render();
  }

  function svgPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top - rulerH };
  }

  function colorFor(row: TimelineRow): string {
    if (row.part !== undefined) return PART_COLOR[row.part] ?? 'var(--text-2)';
    return row.quat ? 'var(--accent)' : 'var(--text-1)';
  }

  function render(): void {
    root.dataset.mode = view.mode;
    syncPlayer();
    const rowH = measure(view.mode === 'curves');
    rulerH = measure(false);
    const rows = buildRows(clip, collapsed, view.mode);
    const width = Math.max(sheet.clientWidth, timeToX(clip.duration, view.pps) + 48);
    const height = rulerH + rows.length * rowH;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    labelHead.style.height = `${rulerH}px`;
    drawLabels(rows, rowH);
    drawRuler(width);
    drawPlot(rows, rowH, width);
    playhead.style.left = `${timeToX(player.time, view.pps)}px`;
    playhead.style.top = `${rulerH}px`;
    playhead.style.height = `${Math.max(0, height - rulerH)}px`;
    syncChrome();
    drawFooter();
  }

  function drawLabels(rows: TimelineRow[], rowH: number): void {
    labelList.replaceChildren();
    const flags = readMeta(clip);
    for (const row of rows) {
      const line = el('div', 'tl-label');
      line.style.height = `${rowH}px`;
      line.style.paddingLeft = `calc(var(--space-2) + ${row.depth} * var(--space-3))`;
      if (row.trackId && row.trackId === activeTrackId) line.classList.add('is-active');
      if (row.trackId && flags.muted.includes(row.trackId)) line.classList.add('is-muted');
      if (row.kind === 'group') {
        const twist = el('button', 'tl-twist');
        twist.type = 'button';
        twist.textContent = collapsed.has(row.id) ? '▸' : '▾';
        twist.setAttribute('aria-label', collapsed.has(row.id) ? `Expand ${row.label}` : `Collapse ${row.label}`);
        twist.addEventListener('click', () => {
          if (collapsed.has(row.id)) collapsed.delete(row.id);
          else collapsed.add(row.id);
          render();
        });
        line.append(twist);
      }
      const name = el('button', 'tl-name');
      name.type = 'button';
      name.textContent = row.label;
      name.addEventListener('click', () => {
        if (row.trackId) activeTrackId = row.trackId;
        if (row.kind === 'events' && selectedEvent === null && (clip.events?.length ?? 0) > 0) selectedEvent = 0;
        render();
      });
      line.append(name);
      if (row.trackId && (row.kind === 'track' || row.kind === 'group')) {
        const mute = el('button', 'tl-flag');
        mute.type = 'button';
        mute.textContent = 'M';
        mute.title = 'Mute';
        mute.setAttribute('aria-pressed', String(flags.muted.includes(row.trackId)));
        const trackId = row.trackId;
        mute.addEventListener('click', () => toggleFlag(trackId, 'muted'));
        const lock = el('button', 'tl-flag');
        lock.type = 'button';
        lock.textContent = 'L';
        lock.title = 'Lock';
        lock.setAttribute('aria-pressed', String(flags.locked.includes(row.trackId)));
        lock.addEventListener('click', () => toggleFlag(trackId, 'locked'));
        line.append(mute, lock);
      }
      labelList.append(line);
    }
  }

  function drawRuler(width: number): void {
    ruler.style.height = `${rulerH}px`;
    rulerSvg.setAttribute('width', String(width));
    rulerSvg.setAttribute('height', String(rulerH));
    rulerSvg.replaceChildren();
    const step = Math.max(niceStep(Math.max(clip.duration, 0.001), 8), 1 / clip.fps);
    const count = Math.ceil(clip.duration / step);
    for (let i = 0; i <= count; i++) {
      const time = Math.min(clip.duration, i * step);
      const x = timeToX(time, view.pps);
      const tick = svg('line');
      tick.setAttribute('x1', String(x));
      tick.setAttribute('x2', String(x));
      tick.setAttribute('y1', String(rulerH - 8));
      tick.setAttribute('y2', String(rulerH));
      tick.setAttribute('stroke', 'var(--border-strong)');
      rulerSvg.append(tick);
      const label = svg('text');
      label.setAttribute('x', String(x + 4));
      label.setAttribute('y', String(rulerH - 12));
      label.setAttribute('fill', 'var(--text-3)');
      label.textContent = time.toFixed(2);
      rulerSvg.append(label);
    }
  }

  function drawPlot(rows: TimelineRow[], rowH: number, width: number): void {
    plot.setAttribute('width', String(width));
    plot.setAttribute('height', String(rows.length * rowH));
    plot.style.top = `${rulerH}px`;
    plot.replaceChildren();
    geoms = [];
    hits = [];
    const mute = muted();
    rows.forEach((row, index) => {
      const top = index * rowH;
      const band = svg('rect');
      band.setAttribute('x', '0');
      band.setAttribute('y', String(top));
      band.setAttribute('width', String(width));
      band.setAttribute('height', String(rowH));
      band.setAttribute('fill', index % 2 === 0 ? 'var(--surface-1)' : 'var(--surface-0)');
      band.classList.add('tl-rowband');
      plot.append(band);
      const track = row.trackId ? clip.tracks.find((item) => item.id === row.trackId) : undefined;
      const geom = buildGeom(row, track, top, rowH);
      geoms.push(geom);
      const group = svg('g');
      if (row.trackId && mute.has(row.trackId)) group.dataset.muted = 'true';
      plot.append(group);
      if (row.kind === 'events') drawEvents(group, top, rowH);
      else if (track && (row.kind === 'curve' || (row.kind === 'track' && view.mode === 'curves' && !row.quat))) drawCurveRow(group, row, track, geom);
      else if (track && row.kind === 'track') drawDopesheetRow(group, row, track, geom);
    });
    if (drag?.kind === 'marquee') {
      const box = svg('rect');
      box.classList.add('tl-marquee');
      const x = Math.min(drag.startX, drag.x);
      const y = Math.min(drag.startY, drag.y);
      box.setAttribute('x', String(x));
      box.setAttribute('y', String(y));
      box.setAttribute('width', String(Math.abs(drag.x - drag.startX)));
      box.setAttribute('height', String(Math.abs(drag.y - drag.startY)));
      plot.append(box);
    }
  }

  function buildGeom(row: TimelineRow, track: Track | undefined, top: number, height: number): Geom {
    if (!track || row.kind === 'group' || row.kind === 'events') return { row, top, height, range: null };
    if (view.mode === 'dopesheet' || (row.kind === 'track' && row.quat)) return { row, top, height, range: null };
    const values: number[] = [];
    for (const key of track.keys) {
      const value = readComponent(track, key, row.kind === 'curve' ? row.part : undefined);
      if (value !== null) values.push(value);
    }
    const samples = sampleCurve(track, row.kind === 'curve' ? row.part : undefined, 0, clip.duration, 24);
    for (const point of samples) values.push(point.v);
    return { row, top, height, range: rangeOf(values) };
  }

  function drawCurveRow(group: SVGGElement, row: TimelineRow, track: Track, geom: Geom): void {
    const range = geom.range;
    if (!range) return;
    const part = row.kind === 'curve' ? row.part : undefined;
    const samples = sampleCurve(track, part, 0, clip.duration, 48);
    if (samples.length > 1) {
      const line = svg('polyline');
      line.classList.add('tl-curve');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', colorFor(row));
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('points', samples.map((point) => `${timeToX(point.t, view.pps)},${geom.top + valueToY(point.v, range, geom.height)}`).join(' '));
      group.append(line);
    }
    track.keys.forEach((key, keyIndex) => {
      const value = readComponent(track, key, part);
      if (value === null) return;
      const x = timeToX(key.t, view.pps);
      const y = geom.top + valueToY(value, range, geom.height);
      const ref = refFor(row, key.t, view.mode);
      if (!ref) return;
      if (!isWholeQuat(track)) drawHandles(group, track, keyIndex, part, range, geom, ref);
      drawKey(group, x, y, ref, colorFor(row));
    });
  }

  function drawHandles(group: SVGGElement, track: Track, keyIndex: number, part: number | undefined, range: ValueRange, geom: Geom, ref: KeyRef): void {
    const key = track.keys[keyIndex];
    if (!key || !isSelected(ref)) return;
    const component = readComponent(track, key, part);
    if (component === null) return;
    const previous = track.keys[keyIndex - 1];
    const next = track.keys[keyIndex + 1];
    if (next && (key.interp === 'bezier' || key.outTan)) {
      const delta = (readComponent(track, next, part) ?? component) - component;
      const tangent = key.outTan ?? linearFallback(next.t - key.t, delta, 'out');
      const point = handlePoint(key.t, component, tangent);
      drawHandle(group, ref, 'out', point.t, point.v, range, geom, colorFor(geom.row));
    }
    if (previous && (previous.interp === 'bezier' || key.inTan)) {
      const delta = component - (readComponent(track, previous, part) ?? component);
      const tangent = key.inTan ?? linearFallback(key.t - previous.t, delta, 'in');
      const point = handlePoint(key.t, component, tangent);
      drawHandle(group, ref, 'in', point.t, point.v, range, geom, colorFor(geom.row));
    }
  }

  function drawHandle(group: SVGGElement, ref: KeyRef, side: 'in' | 'out', time: number, value: number, range: ValueRange, geom: Geom, color: string): void {
    const x = timeToX(time, view.pps);
    const y = geom.top + valueToY(value, range, geom.height);
    const keyX = timeToX(ref.t, view.pps);
    const keyValue = (() => {
      const track = clip.tracks.find((item) => item.id === ref.trackId);
      const key = track?.keys.find((item) => item.t === ref.t);
      if (!track || !key) return value;
      return readComponent(track, key, ref.part) ?? value;
    })();
    const keyY = geom.top + valueToY(keyValue, range, geom.height);
    const stem = svg('line');
    stem.setAttribute('x1', String(keyX));
    stem.setAttribute('y1', String(keyY));
    stem.setAttribute('x2', String(x));
    stem.setAttribute('y2', String(y));
    stem.setAttribute('stroke', color);
    group.append(stem);
    const dot = svg('circle');
    dot.classList.add('tl-handle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', 'var(--surface-0)');
    dot.setAttribute('stroke', color);
    group.append(dot);
    hits.push({ kind: side === 'in' ? 'handle-in' : 'handle-out', x, y, ref });
  }

  function drawDopesheetRow(group: SVGGElement, row: TimelineRow, track: Track, geom: Geom): void {
    for (const key of track.keys) {
      const ref = refFor(row, key.t, 'dopesheet');
      if (!ref) continue;
      drawKey(group, timeToX(key.t, view.pps), geom.top + geom.height / 2, ref, colorFor(row));
    }
  }

  function drawKey(group: SVGGElement, x: number, y: number, ref: KeyRef, color: string): void {
    const selected = isSelected(ref);
    const diamond = svg('rect');
    diamond.classList.add('tl-key');
    if (selected) diamond.classList.add('is-selected');
    diamond.setAttribute('x', String(x - 5));
    diamond.setAttribute('y', String(y - 5));
    diamond.setAttribute('width', '10');
    diamond.setAttribute('height', '10');
    diamond.setAttribute('transform', `rotate(45 ${x} ${y})`);
    diamond.setAttribute('stroke', color);
    group.append(diamond);
    hits.push({ kind: 'key', x, y, ref });
  }

  function drawEvents(group: SVGGElement, top: number, height: number): void {
    const events = clip.events ?? [];
    events.forEach((event, index) => {
      const x = timeToX(event.t, view.pps);
      const y = top + height / 2;
      const marker = svg('circle');
      marker.classList.add('tl-event');
      if (selectedEvent === index) marker.classList.add('is-selected');
      marker.setAttribute('cx', String(x));
      marker.setAttribute('cy', String(y));
      marker.setAttribute('r', '5');
      group.append(marker);
      const label = svg('text');
      label.setAttribute('x', String(x + 8));
      label.setAttribute('y', String(y + 4));
      label.setAttribute('fill', 'var(--text-2)');
      label.textContent = event.name;
      group.append(label);
      hits.push({ kind: 'event', x, y, eventIndex: index });
    });
  }

  function syncChrome(): void {
    playBtn.textContent = player.playing ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(player.playing));
    loopBtn.setAttribute('aria-pressed', String(clip.loop));
    snapBtn.setAttribute('aria-pressed', String(view.snap));
    dopeBtn.setAttribute('aria-pressed', String(view.mode === 'dopesheet'));
    curveBtn.setAttribute('aria-pressed', String(view.mode === 'curves'));
    if (document.activeElement !== timeInput) timeInput.value = player.time.toFixed(3);
    loopMode.value = clip.loopMode ?? 'loop';
    loopMode.disabled = !clip.loop;
    fpsLabel.textContent = `${clip.fps} fps`;
    const event = selectedEvent !== null ? clip.events?.[selectedEvent] : undefined;
    nameInput.disabled = event === undefined;
    if (event && document.activeElement !== nameInput) nameInput.value = event.name;
    const errors = validateClip(clip);
    errorLine.textContent = errors[0] ?? '';
  }

  function drawFooter(): void {
    const sampled = sampleClip(clip, player.time);
    const skip = muted();
    const parts: string[] = [];
    for (const [id, sample] of sampled) {
      if (skip.has(id)) continue;
      parts.push(`${id} ${formatValue(sample.value)}`);
    }
    readout.textContent = parts.join('   ');
    eventsLine.textContent = eventLog.length > 0 ? `Events: ${eventLog.join(', ')}` : '';
  }

  function toggleFlag(trackId: string, flag: 'muted' | 'locked'): void {
    recordEdit(ctx.undo, flag === 'muted' ? 'Mute track' : 'Lock track', clip, () => {
      const current = readMeta(clip);
      const list = new Set(flag === 'muted' ? current.muted : current.locked);
      if (list.has(trackId)) list.delete(trackId);
      else list.add(trackId);
      const values = [...list];
      writeMeta(clip, flag === 'muted' ? { muted: values, locked: current.locked } : { muted: current.muted, locked: values });
    });
  }

  function addKeyAtPlayhead(): void {
    const id = activeTrackId ?? clip.tracks[0]?.id;
    if (!id || locked().has(id)) return;
    const time = clampTime(snapTime(player.time, clip.fps, view.snap), clip.duration);
    recordEdit(ctx.undo, 'Add key', clip, () => insertKey(clip, id, time));
    selection = [{ trackId: id, t: time }];
    render();
  }

  function removeSelection(): void {
    const keys = uniqueKeyTimes(selection).filter((key) => !locked().has(key.trackId));
    const eventIndex = selectedEvent;
    if (keys.length === 0 && eventIndex === null) return;
    recordEdit(ctx.undo, 'Delete', clip, () => {
      deleteKeys(clip, keys);
      if (eventIndex !== null) deleteEvent(clip, eventIndex);
    });
    selection = [];
    selectedEvent = null;
    render();
  }

  function isSelected(ref: KeyRef): boolean {
    return selection.some((item) => item.trackId === ref.trackId && item.t === ref.t && (item.part === undefined || ref.part === undefined || item.part === ref.part));
  }

  function hitTest(x: number, y: number): Hit | null {
    let best: Hit | null = null;
    let bestDistance = Infinity;
    for (const hit of hits) {
      const radius = hit.kind === 'key' || hit.kind === 'event' ? 8 : 7;
      const distance = Math.hypot(hit.x - x, hit.y - y);
      if (distance <= radius && distance < bestDistance) {
        best = hit;
        bestDistance = distance;
      }
    }
    return best;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (ruler.contains(event.target instanceof Node ? event.target : null)) return;
    const point = svgPoint(event);
    const hit = hitTest(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
    if (hit?.kind === 'key' && hit.ref) {
      const ref = hit.ref;
      if (event.shiftKey) selection = toggleRef(selection, ref);
      else if (!hasRef(selection, ref)) selection = [ref];
      selectedEvent = null;
      activeTrackId = ref.trackId;
      if (!hasRef(selection, ref) || locked().has(ref.trackId)) {
        drag = null;
        render();
        return;
      }
      const geom = geoms.find((item) => item.row.trackId === ref.trackId && (ref.part === undefined || item.row.part === ref.part));
      drag = {
        kind: 'keys',
        pointerId: event.pointerId,
        before: cloneClip(clip),
        refs: selection.map((item) => ({ ...item })),
        grabbed: { ...ref },
        startX: point.x,
        startY: point.y,
        range: view.mode === 'curves' ? (geom?.range ?? null) : null,
        rowTop: geom?.top ?? 0,
        rowHeight: geom?.height ?? 1,
        quat: geom?.row.quat === true,
        moved: false,
        lastMoves: [],
      };
      render();
      return;
    }
    if ((hit?.kind === 'handle-in' || hit?.kind === 'handle-out') && hit.ref) {
      const geom = geoms.find((item) => item.row.trackId === hit.ref?.trackId && item.row.part === hit.ref?.part);
      if (!geom?.range || geom.row.quat || (hit.ref && locked().has(hit.ref.trackId))) return;
      drag = {
        kind: 'handle',
        pointerId: event.pointerId,
        before: cloneClip(clip),
        ref: { ...hit.ref },
        side: hit.kind === 'handle-in' ? 'in' : 'out',
        moved: false,
      };
      return;
    }
    if (hit?.kind === 'event' && hit.eventIndex !== undefined) {
      selectedEvent = hit.eventIndex;
      selection = [];
      const origin = clip.events?.[hit.eventIndex]?.t ?? 0;
      drag = { kind: 'event', pointerId: event.pointerId, before: cloneClip(clip), index: hit.eventIndex, startX: point.x, origin, moved: false };
      render();
      return;
    }
    drag = {
      kind: 'marquee',
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      moved: false,
      additive: event.shiftKey,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = svgPoint(event);
    if (drag.kind === 'playhead') {
      seekTo(xToTime(point.x, view.pps));
      return;
    }
    if (drag.kind === 'marquee') {
      if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > 3) drag.moved = true;
      drag.x = point.x;
      drag.y = point.y;
      render();
      return;
    }
    if (Math.hypot(point.x - (drag.kind === 'keys' ? drag.startX : drag.kind === 'event' ? drag.startX : 0), point.y) > 3) {
      drag.moved = true;
    }
    if (drag.kind === 'keys') {
      if (Math.hypot(point.x - drag.startX, point.y - drag.startY) < 3) return;
      drag.moved = true;
      applyKeyDrag(drag, point.x, point.y);
      render();
      return;
    }
    if (drag.kind === 'handle') {
      drag.moved = true;
      applyHandleDrag(drag, point);
      render();
      return;
    }
    if (drag.kind === 'event') {
      if (Math.abs(point.x - drag.startX) < 3) return;
      drag.moved = true;
      const time = clampTime(snapTime(drag.origin + xToTime(point.x - drag.startX, view.pps), clip.fps, view.snap), clip.duration);
      replaceClip(clip, drag.before);
      selectedEvent = patchEvent(clip, drag.index, { t: time });
      render();
    }
  }

  function applyKeyDrag(current: KeyDrag, x: number, y: number): void {
    const dt = xToTime(x, view.pps) - xToTime(current.startX, view.pps);
    let dv = 0;
    if (current.range) {
      const at = (py: number) => yToValue(py - current.rowTop, current.range as ValueRange, current.rowHeight);
      dv = at(y) - at(current.startY);
    }
    const moves: KeyMove[] = [];
    const blocked = locked();
    for (const ref of uniqueKeyTimes(current.refs)) {
      if (blocked.has(ref.trackId)) continue;
      const sourceTrack = current.before.tracks.find((item) => item.id === ref.trackId);
      const origin = sourceTrack?.keys.find((key) => key.t === ref.t);
      if (!sourceTrack || !origin) continue;
      const to = clampTime(snapTime(origin.t + dt, clip.fps, view.snap), clip.duration);
      const grabbed = current.grabbed.trackId === ref.trackId && current.grabbed.t === ref.t;
      let value: KeyValue | undefined;
      if (grabbed && current.range && view.mode === 'curves') {
        const component = readComponent(sourceTrack, origin, current.grabbed.part);
        if (component !== null) {
          const step = current.quat ? 1 : niceStep(current.range.max - current.range.min, 10);
          const written = writeComponent(sourceTrack, origin, current.grabbed.part, snapValue(component + dv, step, view.snap));
          if (written !== null) value = written;
        }
      }
      moves.push(value === undefined ? { trackId: ref.trackId, from: ref.t, to } : { trackId: ref.trackId, from: ref.t, to, v: value });
    }
    replaceClip(clip, current.before);
    try {
      applyKeyMoves(clip, moves);
    } catch {
      replaceClip(clip, current.before);
      return;
    }
    current.lastMoves = moves;
    selection = current.refs.map((ref) => {
      const move = moves.find((item) => item.trackId === ref.trackId && item.from === ref.t);
      return move ? { ...ref, t: move.to } : ref;
    });
  }

  function applyHandleDrag(current: HandleDrag, point: { x: number; y: number }): void {
    const track = current.before.tracks.find((item) => item.id === current.ref.trackId);
    const key = track?.keys.find((item) => item.t === current.ref.t);
    if (!track || !key || isWholeQuat(track)) return;
    const geom = geoms.find((item) => item.row.trackId === current.ref.trackId && item.row.part === current.ref.part && item.range);
    if (!geom?.range) return;
    const component = readComponent(track, key, current.ref.part);
    if (component === null) return;
    const tangent: Tangent = {
      dt: xToTime(point.x, view.pps) - key.t,
      dv: yToValue(point.y - geom.top, geom.range, geom.height) - component,
    };
    replaceClip(clip, current.before);
    try {
      setKeyTangent(clip, current.ref.trackId, current.ref.t, current.side, tangent);
    } catch {
      replaceClip(clip, current.before);
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = drag;
    drag = null;
    if (current.kind === 'keys' && current.moved) commit(current.before, 'Move keys');
    else if (current.kind === 'handle' && current.moved) commit(current.before, 'Edit tangent');
    else if (current.kind === 'event' && current.moved) commit(current.before, 'Move event');
    else if (current.kind === 'marquee') {
      finishMarquee(current);
      return;
    }
    render();
  }

  function finishMarquee(current: MarqueeDrag): void {
    const point = { x: current.x, y: current.y };
    if (!current.moved) {
      if (!current.additive) {
        selection = [];
        selectedEvent = null;
      }
      seekTo(xToTime(point.x, view.pps));
      return;
    }
    const rect = { x: current.startX, y: current.startY, w: current.x - current.startX, h: current.y - current.startY };
    const picked = hits.filter((hit) => hit.kind === 'key' && hit.ref && pointInRect(hit.x, hit.y, rect)).map((hit) => hit.ref as KeyRef);
    selection = current.additive ? picked.reduce((list, ref) => addRef(list, ref), selection) : picked;
    render();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === ' ') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeSelection();
    } else if (event.key === 'f') {
      fit();
    }
  }

  function fit(): void {
    const available = Math.max(160, sheet.clientWidth - 32);
    view.pps = Math.min(800, Math.max(24, available / Math.max(clip.duration, 0.001)));
    sheet.scrollLeft = 0;
    render();
  }

  playBtn.addEventListener('click', togglePlay);
  stopBtn.addEventListener('click', () => {
    player.stop();
    stopRaf();
    render();
  });
  loopBtn.addEventListener('click', () => {
    recordEdit(ctx.undo, clip.loop ? 'Disable loop' : 'Enable loop', clip, () => {
      clip.loop = !clip.loop;
    });
    syncPlayer();
    render();
  });
  loopMode.addEventListener('change', () => {
    const mode = loopMode.value === 'pingpong' ? 'pingpong' : 'loop';
    recordEdit(ctx.undo, 'Loop mode', clip, () => {
      clip.loopMode = mode;
    });
    syncPlayer();
    render();
  });
  timeInput.addEventListener('change', () => {
    const value = Number(timeInput.value);
    if (Number.isFinite(value)) seekTo(value);
  });
  snapBtn.addEventListener('click', () => {
    view.snap = !view.snap;
    render();
  });
  speed.addEventListener('change', () => {
    player.speed = Number(speed.value) || 1;
  });
  dopeBtn.addEventListener('click', () => {
    view.mode = 'dopesheet';
    selection = uniqueKeyTimes(selection).map((key) => ({ trackId: key.trackId, t: key.t }));
    render();
  });
  curveBtn.addEventListener('click', () => {
    view.mode = 'curves';
    render();
  });
  addKeyBtn.addEventListener('click', addKeyAtPlayhead);
  addEventBtn.addEventListener('click', () => {
    const time = clampTime(snapTime(player.time, clip.fps, view.snap), clip.duration);
    const name = nameInput.value.trim() || 'event';
    recordEdit(ctx.undo, 'Add event', clip, () => {
      insertEvent(clip, time, name);
      selectedEvent = (clip.events ?? []).findIndex((item) => item.t === time && item.name === name);
    });
    render();
  });
  deleteBtn.addEventListener('click', removeSelection);
  interp.addEventListener('change', () => {
    const value = interp.value;
    interp.value = '';
    if (value !== 'step' && value !== 'linear' && value !== 'bezier') return;
    const keys = uniqueKeyTimes(selection).filter((key) => !locked().has(key.trackId));
    if (keys.length === 0) return;
    recordEdit(ctx.undo, 'Interpolation', clip, () => setKeysInterp(clip, keys, value));
  });
  nameInput.addEventListener('input', () => {
    if (selectedEvent === null) return;
    const index = selectedEvent;
    const name = nameInput.value.trim();
    if (name === '') return;
    recordEdit(ctx.undo, 'Rename event', clip, () => {
      selectedEvent = patchEvent(clip, index, { name });
    }, 'event-name');
  });
  addTrackBtn.addEventListener('click', () => {
    const entity = clip.tracks.find((track) => track.id === activeTrackId)?.target.entity ?? clip.tracks[0]?.target.entity ?? 'hero';
    let id = '';
    recordEdit(ctx.undo, 'Add track', clip, () => {
      id = insertNumberTrack(clip, entity);
    });
    if (id) activeTrackId = id;
    render();
  });
  zoomOut.addEventListener('click', () => {
    view.pps = Math.max(24, view.pps / 1.25);
    render();
  });
  zoomIn.addEventListener('click', () => {
    view.pps = Math.min(800, view.pps * 1.25);
    render();
  });
  fitBtn.addEventListener('click', fit);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  ruler.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    ruler.setPointerCapture(event.pointerId);
    drag = { kind: 'playhead', pointerId: event.pointerId };
    const rect = canvas.getBoundingClientRect();
    seekTo(xToTime(event.clientX - rect.left, view.pps));
  });
  ruler.addEventListener('pointermove', (event) => {
    if (drag?.kind !== 'playhead' || drag.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    seekTo(xToTime(event.clientX - rect.left, view.pps));
  });
  ruler.addEventListener('pointerup', (event) => {
    if (drag?.kind === 'playhead' && drag.pointerId === event.pointerId) drag = null;
  });
  sheet.addEventListener('scroll', () => {
    labelList.style.transform = `translateY(${-sheet.scrollTop}px)`;
  });
  sheet.addEventListener(
    'wheel',
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      view.pps = Math.min(800, Math.max(24, view.pps * (event.deltaY > 0 ? 0.9 : 1.1)));
      render();
    },
    { passive: false },
  );
  root.addEventListener('keydown', onKeyDown);

  const offEvents = player.onEvent((event) => {
    eventLog = [event.name, ...eventLog].slice(0, 4);
    ctx.bus.emit('status', { message: event.name, level: 'info' });
  });
  const offUndo = ctx.undo.subscribe(() => {
    if (drag && (drag.kind === 'keys' || drag.kind === 'handle' || drag.kind === 'event')) drag = null;
    syncPlayer();
    render();
  });
  let observedWidth = -1;
  const observer = new ResizeObserver(() => {
    const width = sheet.clientWidth;
    if (Math.abs(width - observedWidth) < 1) return;
    observedWidth = width;
    render();
  });
  observer.observe(sheet);

  render();

  return {
    time: () => player.time,
    dispose() {
      stopRaf();
      offEvents();
      offUndo();
      observer.disconnect();
      player.pause();
      host.replaceChildren();
      host.classList.remove('tl-host');
    },
  };
}
