import { Color } from 'three';

export interface ViewportPalette {
  background: Color;
  grid: Color;
  gridAxis: Color;
  axisX: Color;
  axisY: Color;
  axisZ: Color;
  selection: Color;
  mesh: Color;
  ground: Color;
  highlight: Color;
  light: Color;
}

const VARIABLES = {
  background: '--viewport-bg',
  grid: '--viewport-grid',
  gridAxis: '--viewport-grid-axis',
  axisX: '--viewport-axis-x',
  axisY: '--viewport-axis-y',
  axisZ: '--viewport-axis-z',
  selection: '--viewport-selection',
  mesh: '--viewport-mesh',
  ground: '--viewport-ground',
  highlight: '--viewport-highlight',
  light: '--viewport-light',
} as const;

export function createPalette(): ViewportPalette {
  return {
    background: new Color(),
    grid: new Color(),
    gridAxis: new Color(),
    axisX: new Color(),
    axisY: new Color(),
    axisZ: new Color(),
    selection: new Color(),
    mesh: new Color(),
    ground: new Color(),
    highlight: new Color(),
    light: new Color(),
  };
}

/** Resolve viewport aliases through the element's computed style. No color literals in source. */
export function readPalette(host: HTMLElement, into: ViewportPalette): void {
  const probe = host.ownerDocument.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  host.append(probe);
  const keys = Object.keys(VARIABLES) as (keyof ViewportPalette)[];
  for (const key of keys) {
    probe.style.color = `var(${VARIABLES[key]})`;
    const computed = getComputedStyle(probe).color;
    if (computed) into[key].setStyle(computed);
  }
  probe.remove();
}
