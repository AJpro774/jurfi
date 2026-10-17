import '@jurfi/ui';
import './editor.css';
import { createDemoGraph, mountNodeGraph } from '@jurfi/editor';
import type { NodeGraphDebugSource } from '@jurfi/editor';

const app = document.querySelector('#app');
if (!app) throw new Error('Missing #app');

app.innerHTML = `
  <header class="editor-bar">
    <strong>Jurfi Node Graph</strong>
    <button type="button" id="debug" aria-pressed="false">Play debug</button>
    <span id="stats"></span>
  </header>
  <div id="graph"></div>
`;

const host = document.querySelector('#graph');
const stats = document.querySelector('#stats');
const debugButton = document.querySelector('#debug');
if (!(host instanceof HTMLElement) || !(stats instanceof HTMLElement) || !(debugButton instanceof HTMLButtonElement)) {
  throw new Error('Editor shell failed to render');
}

const graph = mountNodeGraph(host, createDemoGraph(), {
  onChange(doc) {
    stats.textContent = `${doc.nodes.length} nodes · ${doc.edges.length} wires`;
  },
});

let timer = 0;
let step = 0;

debugButton.addEventListener('click', () => {
  const playing = debugButton.getAttribute('aria-pressed') === 'true';
  if (playing) {
    window.clearInterval(timer);
    debugButton.setAttribute('aria-pressed', 'false');
    debugButton.textContent = 'Play debug';
    graph.setDebugSource(null);
    return;
  }
  debugButton.setAttribute('aria-pressed', 'true');
  debugButton.textContent = 'Stop debug';
  const tick = () => {
    const doc = graph.getDocument();
    const ids = doc.nodes.map((node) => node.id);
    const current = ids[step % Math.max(ids.length, 1)] ?? '';
    step += 1;
    const values: Record<string, unknown> = {};
    for (const edge of doc.edges) {
      const source = doc.nodes.find((node) => node.id === edge.from.node);
      const pin = source?.pins.find((item) => item.id === edge.from.pin);
      if (pin?.kind !== 'data') continue;
      values[`${edge.from.node}:${edge.from.pin}`] = source?.props.value ?? source?.props.name ?? pin.dataType;
    }
    const source: NodeGraphDebugSource = { executingNodeIds: current ? [current] : [], values };
    graph.setDebugSource(source);
  };
  tick();
  timer = window.setInterval(tick, 700);
});
