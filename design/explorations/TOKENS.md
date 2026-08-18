# Shift design-system tokens (light / default theme)

This app consumes the **same CSS custom property names** as
`@redbrickmedia/shift-design-system` (`dist/css-exports/variables.css`). The
Shift browser toolkit themes embedded apps by toggling `.light` / `.dark` and
`data-theme` on `<html>`; those updates only land if our styles reference the
DS names — not invented `--shift-*` aliases.

Hex values are the light / default-brand resolutions used as standalone
fallbacks in `src/css/shift-theme.css` until the design-system stylesheet is
loaded.

| Design-system token                       | Resolved (light / default) | Usage                      |
| ----------------------------------------- | -------------------------- | -------------------------- |
| `--background-bar-primary`                | `#f3f4f6` (`light-100`)    | Sidebar / page chrome      |
| `--background-secondary`                  | `#ffffff` (`basic-white`)  | Main panel                 |
| `--text-primary`                          | `#111827` (`light-900`)    | Headings, body             |
| `--text-secondary`                        | `#374151` (`light-700`)    | Subtitles, muted copy      |
| `--border-divider-secondary`              | `#e6e9ef` (`light-200`)    | Chrome dividers            |
| `--border-outer-primary`                  | `#d1d5db` (`light-300`)    | Tool cards, inputs         |
| `--action-button-surface-primary-default` | `#2563eb` (`brand-600`)    | CTAs, focus, card hover    |
| `--action-button-surface-primary-hover`   | `#1d4ed8` (`brand-700`)    | CTA hover                  |
| `--brand-500`                             | `#3b82f6`                  | Icons / accent ink         |
| `--brand-50`                              | `#eff6ff`                  | Soft selected / hover fill |
| `--radius-8`                              | `8px`                      | Cards, nav items           |
| `--radius-12`                             | `12px`                     | Larger rounded surfaces    |

## Sidebar item states (`.nav-item` parity)

| Design-system token                                   | Resolved  | Usage              |
| ----------------------------------------------------- | --------- | ------------------ |
| `--action-controls-surface-primary-default`           | `#f3f4f6` | Nav item rest      |
| `--action-controls-surface-primary-hover`             | `#e6e9ef` | Nav item hover     |
| `--action-controls-surface-secondary-active-tertiary` | `#d1d5db` | Nav item selected  |
| `--action-text-neutral-default`                       | `#374151` | Nav label rest     |
| `--action-text-neutral-hover`                         | `#1f2937` | Nav label hover    |
| `--action-text-neutral-selected`                      | `#111827` | Nav label selected |

## App-local only (`--shift-*`)

These are geometry / type choices for this shell, not themed by the toolkit:

| Token                             | Value       | Usage                                                  |
| --------------------------------- | ----------- | ------------------------------------------------------ |
| `--shift-radius-panel`            | `10px`      | Main content panel corners (shift-pdf `.main-content`) |
| `--shift-sidebar-width`           | `276px`     | Expanded rail                                          |
| `--shift-sidebar-width-collapsed` | `64px`      | Icon rail                                              |
| `--shift-sidebar-pad`             | `30px`      | Expanded rail padding                                  |
| `--shift-sidebar-pad-collapsed`   | `12px`      | Collapsed rail padding                                 |
| `--shift-font`                    | Inter stack | Shell typeface                                         |

Geometry copied from `shift-pdf`: item 40px tall, padding `8px 8px 8px 12px`,
gap 8px, radius 8px, 24px icon slot. Hover adds a 1px inset ring; selected adds
the light-theme drop shadow pair plus inset ring.

## Typography

- **Inter** (`@fontsource/inter`) — matches the design system, which declares
  `font-family: Inter`. Replaces DM Sans for the shell.

## Branding env

```
VITE_BRAND_NAME=Shift PDF
VITE_BRAND_LOGO=images/shift-pdf-logo.svg
VITE_FOOTER_TEXT=Shift PDF experimental
```
