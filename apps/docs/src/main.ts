import '@jurfi/ui';
import './docs.css';
import MarkdownIt from 'markdown-it';

// Markdown sources are bundled as raw strings; keys look like /content/getting-started.md
const sources = import.meta.glob('../content/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface Page { slug: string; title: string; html: string }

// html:false => raw HTML in markdown is escaped, code blocks are escaped by markdown-it.
const md = new MarkdownIt({ html: false, linkify: true });

function resolveSlug(fromSlug: string, href: string): string {
  const parts = fromSlug.split('/').slice(0, -1);
  for (const seg of href.replace(/\.md$/, '').split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function render(slug: string, src: string): Page {
  const env = { slug };
  const defaultLink = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options, e, self) => {
    const token = tokens[idx]!;
    const href = String(token.attrGet('href') ?? '');
    if (/^[a-z][a-z0-9+.-]*:|^#|^\//i.test(href) === false && /\.md(#.*)?$/.test(href)) {
      token.attrSet('href', '#/' + resolveSlug((e as typeof env).slug, href.replace(/#.*$/, '')));
    } else if (/^https?:/i.test(href)) {
      token.attrSet('rel', 'noopener');
    }
    return defaultLink ? defaultLink(tokens, idx, options, e, self) : self.renderToken(tokens, idx, options);
  };
  const html = md.render(src, env);
  const title = /^#\s+(.+)$/m.exec(src)?.[1] ?? slug;
  return { slug, title, html };
}

const pages: Page[] = Object.entries(sources)
  .map(([path, src]) => render(path.replace(/^\.\.\/content\//, '').replace(/\.md$/, ''), src))
  .sort((a, b) => {
    if (a.slug === 'getting-started') return -1;
    if (b.slug === 'getting-started') return 1;
    return a.slug.localeCompare(b.slug);
  });

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<div class="docs-shell"><nav class="docs-nav" aria-label="Documentation"></nav><main class="docs-main jurfi-panel"></main></div>`;
const nav = app.querySelector<HTMLElement>('.docs-nav')!;
const main = app.querySelector<HTMLElement>('.docs-main')!;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function currentSlug(): string {
  return decodeURIComponent(location.hash.replace(/^#\/?/, ''));
}

function draw(): void {
  const slug = currentSlug();
  const page = pages.find((p) => p.slug === slug);
  nav.innerHTML =
    `<a class="docs-brand" href="#/">Jurfi docs</a><ul>` +
    pages.map((p) => `<li><a href="#/${esc(p.slug)}"${p.slug === slug ? ' aria-current="page"' : ''}>${esc(p.title)}</a></li>`).join('') +
    `<li><a href="./api/index.html">API reference</a></li></ul>`;
  if (slug === '') {
    main.innerHTML = `<h1>Jurfi docs</h1><p>Guides, tutorials and API reference.</p><ul>` +
      pages.map((p) => `<li><a href="#/${esc(p.slug)}">${esc(p.title)}</a></li>`).join('') +
      `<li><a href="./api/index.html">API reference</a></li></ul>`;
    document.title = 'Jurfi docs';
  } else if (page) {
    main.innerHTML = page.html;
    document.title = `${page.title} - Jurfi docs`;
  } else {
    main.innerHTML = `<h1>Not found</h1><p>No page <code>${esc(slug)}</code>. <a href="#/">Home</a></p>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', draw);
draw();
