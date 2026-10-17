# Getting Started

> Draft. Jurfi is a browser-only game engine (TypeScript, three.js, WebGPU with a WebGL2 fallback).

## Requirements

- Node >= 20.19
- pnpm 10

## Install and run

```sh
pnpm install
pnpm --filter @jurfi/samples dev     # open /pong/
pnpm --filter @jurfi/docs dev
```

## Verify your checkout

```sh
pnpm typecheck
pnpm build        # the @jurfi/wasm build needs the Rust toolchain; it may fail locally
pnpm lint
pnpm export-guard # fails if a bundle imports @jurfi/editor
```

## Project layout

| Path | Purpose |
| --- | --- |
| `packages/core`, `render`, `physics`, `anim`, `script`, `ui`, `wasm`, `input`, `audio`, `perf` | Engine packages |
| `packages/editor` | Editor code. Never import it from games or samples |
| `apps/samples` | Runnable samples |
| `apps/docs` | These docs |
| `templates/` | Starter templates |

## Conventions

- Input, audio and profiling come from `@jurfi/input` (`Input.update()` once per frame, then `action()` / `axis2()`; up is `y = -1`), `@jurfi/audio` (`AudioEngine` with `master`/`sfx`/`music`/`ui` buses, muted under `?test=1`) and `@jurfi/perf` (`Profiler`).
- Colors come from CSS tokens (semantic tokens such as `--surface-0`, `--text-1`, `--accent`; see `packages/ui/MIGRATION.md`). Raw hex/rgb is banned outside `packages/ui/src/tokens`.
- Next: [Build Pong](./tutorials/pong.md).
