# Visual audit: Shift PDF vs Bento (shift-pdf-v2)

## shift-pdf (Shift integrated app)

| Concern              | Current                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Layout               | Sticky left sidebar (276px) + main content                                                |
| Nav                  | Compress, Merge, Convert, E-sign + My PDFs folders                                        |
| Tokens               | `@redbrickmedia/shift-design-system/styles.css`                                           |
| Shell colors (light) | Sidebar `--background-bar-primary` → `#f3f4f6`; main `--background-secondary` → `#ffffff` |
| Accent               | Brand blue `#2563eb` (`--brand-600`)                                                      |
| Text                 | `--text-primary` `#111827`, `--text-secondary` `#374151`                                  |
| Chrome               | Logo + app name "PDF"; no marketing nav                                                   |

## Bento (this fork)

| Concern        | Current                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| Layout         | Top sticky navbar + centered marketing/home + tool grid                 |
| Nav            | Home / About / Contact / Licensing / Docs + GitHub stars                |
| Theme          | Dark Tailwind: body `#111827`, cards `#1f2937`, accent indigo `#4f46e5` |
| Font           | DM Sans                                                                 |
| Branding hooks | `VITE_BRAND_NAME`, `VITE_BRAND_LOGO`, `VITE_FOOTER_TEXT`                |
| Tools          | 7 categories, ~127 tools, rendered in `main.ts`                         |

## Gap for CSS-token reskin

- Structural: top bar → Shift-like sidebar (Concept A) or keep top bar (B/C)
- Palette: dark indigo → light grey + brand blue
- Chrome: strip marketing/GitHub; Shift logo + name
- Keep full Bento tool catalog reachable

## ST-14683 follow-up audit

The shell branch closes the structural and visual gaps above, but the complete
ticket also needs research, trust, stickiness, and measurement deliverables.

| Ticket need                    | Shell baseline          | ST-14683 follow-up                                                         |
| ------------------------------ | ----------------------- | -------------------------------------------------------------------------- |
| Display-ad competitor set      | Not covered             | [`COMPETITIVE-RESEARCH.md`](./COMPETITIVE-RESEARCH.md)                     |
| Prioritized Shift 1-ups        | Shell concept only      | [`STICKY-TOOLKIT-RECOMMENDATIONS.md`](./STICKY-TOOLKIT-RECOMMENDATIONS.md) |
| Estimate-ready key screens     | Static shell concepts   | States and story split in the recommendations                              |
| Shift ownership                | Sidebar, tokens, logo   | Shift About, Source, entry metadata, and footer links                      |
| Entry → use → return analytics | Not covered             | [`MIXPANEL-TRACKING.md`](./MIXPANEL-TRACKING.md)                           |
| Scope boundary                 | Related-tool UI removed | Search handoff and next tools explicitly excluded                          |

The remaining upstream About and commercial Licensing pages are not appropriate
trust surfaces for Shift PDF. ST-14683 replaces their user-facing
content while retaining clear Bento attribution on the Source page.
