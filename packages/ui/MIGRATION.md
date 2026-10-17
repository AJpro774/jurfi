# Migrating off `--jurfi-*` tokens

The legacy `--jurfi-*` namespace (`src/tokens/tokens.css`, `src/tokens/themes.css`) is replaced by the
layered tokens in `src/tokens/` (primitives -> semantic -> component, plus motion).
Every old variable remains as a **deprecated alias** in `src/tokens/deprecated.css`.
`@jurfi/ui/tokens.css` (primitives, motion, component, deprecated) and `@jurfi/ui/themes.css` (semantic)
still resolve. `base.css` now uses only new tokens.

| Old name | Old value | New name | Note |
|---|---|---|---|
| `--jurfi-bg` | `#14161a` dark / `#fafafa` light | `--surface-0` | now themed (dark/light/hc) |
| `--jurfi-fg` | `#e8eaed` dark / `#1b1b1f` light | `--text-1` | |
| `--jurfi-space-1` | `4px` | `--space-1` | density-aware |
| `--jurfi-space-2` | `8px` | `--space-2` | compact density: 4px |
| `--jurfi-space-3` | `16px` | `--space-4` | `--space-3` is 12px; compact: 12px |
| `--jurfi-radius` | `6px` | `--ref-radius-3` | no semantic radius token exists yet |
| `--jurfi-font` | `system-ui, sans-serif` | `--ref-font-sans` | |
| `--jurfi-white` | `#fff` | `--ref-white` | primitive |
| `--jurfi-black` | `#000` | `--ref-black` | primitive |
| `--jurfi-accent` | `rgb(80 140 255)` | `--accent` | now `#5a92ff` dark / `#2c62d1` light |
| `@custom-media --jurfi-compact` | `(max-width: 600px)` | `--compact` | defined in `base.css` |

## `.jurfi-panel` (base.css)

| Property | Before | After |
|---|---|---|
| background | `--jurfi-bg` | `--panel-bg` (`--surface-1`) |
| color | `--jurfi-fg` | `--panel-fg` (`--text-1`) |
| padding | `--jurfi-space-3` | `--panel-pad` (`--space-3`, 12px cozy) |
| border-radius | `--jurfi-radius` (6px) | `--panel-radius` (0) |
| outline on hover | `--jurfi-accent` | `--accent` |
| compact padding | `--jurfi-space-2` | `--space-2` |

Values are not pixel-identical in several places (see Note columns).

## Removal

No alias in the old files was marked as targeted for the next release, so none were removed in this change;
all ten variables are still defined. Nothing is scheduled for removal until the maintainers choose a release;
when they do, delete the entries from `src/tokens/deprecated.css` and this table.

## Default theme (no `data-theme`)

Dark is the true default: `semantic.css` applies the dark tokens on `:root, [data-theme='dark']`
(cozy density likewise on `:root`), so `--jurfi-*` aliases resolve with no `data-theme` attribute.
`[data-theme='light']` and `[data-theme='hc']` still override it. `@jurfi/ui/tokens.css` now also imports
`semantic.css`, so the aliases work even if `themes.css` is not loaded.
