# Jurfi

Browser-only game engine: TypeScript, three.js, WebGPU (WebGL2 fallback), Rust/WASM.

```
pnpm install
pnpm typecheck && pnpm build && pnpm lint && pnpm test
pnpm wasm:build   # needs rust + wasm32-unknown-unknown + wasm-pack
pnpm docs:api
```

Layout: `packages/*` libs (ui is CSS-only), `apps/{editor,samples,docs}`, `templates/`, `tooling/*` shared config, `tests/visual` Playwright.

Rule: samples/exports must never reference `@jurfi/editor` (`pnpm export-guard`).
