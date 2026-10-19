function svg(): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 16 16');
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function path(el: SVGSVGElement, d: string): void {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  node.setAttribute('d', d);
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.5');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  el.append(node);
}

export function eyeIcon(open: boolean): SVGSVGElement {
  const el = svg();
  if (open) {
    path(el, 'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z');
    path(el, 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z');
  } else {
    path(el, 'M2 3.5l12 9');
    path(el, 'M6.2 4.2C6.8 4 7.4 3.8 8 3.8c4.1 0 6.5 4.2 6.5 4.2a12 12 0 0 1-2.2 2.6');
    path(el, 'M3.6 5.4C2.4 6.4 1.5 8 1.5 8s2.4 4.5 6.5 4.5c.7 0 1.4-.1 2-.3');
  }
  return el;
}

export function lockIcon(locked: boolean): SVGSVGElement {
  const el = svg();
  path(el, 'M4 7.2h8v6.2H4z');
  path(el, locked ? 'M5.5 7.2V5.2a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7.2V5.2a2.5 2.5 0 0 1 4.2-1.8');
  return el;
}

export function chevronIcon(expanded: boolean): SVGSVGElement {
  const el = svg();
  path(el, expanded ? 'M3.5 6.2L8 10.2l4.5-4' : 'M6.2 3.5L10.2 8l-4 4.5');
  return el;
}
