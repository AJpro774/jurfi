import type { EditorContext } from './context';
import { PANEL } from './layout';
import { registerPanel } from './registry';

export interface ConsoleEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  source?: string;
}

const logs = new WeakMap<EditorContext, ConsoleEntry[]>();

function entriesFor(ctx: EditorContext): ConsoleEntry[] {
  const existing = logs.get(ctx);
  if (existing) return existing;
  const created: ConsoleEntry[] = [];
  logs.set(ctx, created);
  return created;
}

function remember(ctx: EditorContext, entry: ConsoleEntry): void {
  const entries = entriesFor(ctx);
  const last = entries.at(-1);
  if (last && last.level === entry.level && last.message === entry.message && last.source === entry.source) return;
  entries.push(entry);
}

/**
 * Replace the Console placeholder.
 * Safe to call before `createEditor`. The shell also calls this when `console` is still unclaimed.
 */
export function registerConsolePanel(): () => void {
  return registerPanel({
    id: PANEL.console,
    title: 'Console',
    mount(el, ctx) {
      const entries = entriesFor(ctx);
      const root = document.createElement('div');
      root.className = 'je-console';
      const bar = document.createElement('div');
      bar.className = 'je-console-bar';
      const filter = document.createElement('input');
      filter.className = 'je-field';
      filter.type = 'search';
      filter.placeholder = 'Filter';
      filter.setAttribute('aria-label', 'Filter console');
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'je-console-clear';
      clear.textContent = 'Clear';
      clear.setAttribute('aria-label', 'Clear console');
      bar.append(filter, clear);
      const log = document.createElement('div');
      log.className = 'je-log';
      log.setAttribute('role', 'log');
      log.setAttribute('aria-label', 'Console output');
      root.append(bar, log);
      el.append(root);

      const render = (): void => {
        const query = filter.value.trim().toLowerCase();
        log.replaceChildren();
        const visible = entries.filter((entry) => {
          if (!query) return true;
          const haystack = `${entry.source ?? ''} ${entry.message}`.toLowerCase();
          return haystack.includes(query);
        });
        if (visible.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'je-log-line';
          empty.textContent = entries.length === 0 ? 'No messages.' : 'No matching messages.';
          log.append(empty);
          return;
        }
        for (const entry of visible) {
          const line = document.createElement('div');
          line.className = 'je-log-line';
          line.dataset.level = entry.level;
          const prefix = entry.source ? `${entry.source}: ` : '';
          line.textContent = `[${entry.level}] ${prefix}${entry.message}`;
          log.append(line);
        }
        log.scrollTop = log.scrollHeight;
      };

      filter.addEventListener('input', render);
      clear.addEventListener('click', () => {
        entries.length = 0;
        render();
      });

      const push = (entry: ConsoleEntry): void => {
        remember(ctx, entry);
        render();
      };
      const offLog = ctx.bus.on('log', (event) => {
        push({ level: event.level, message: event.message, source: event.source });
      });
      const offStatus = ctx.bus.on('status', (event) => {
        push({ level: event.level, message: event.message });
      });
      render();
      return () => {
        offLog();
        offStatus();
        root.remove();
      };
    },
  });
}
