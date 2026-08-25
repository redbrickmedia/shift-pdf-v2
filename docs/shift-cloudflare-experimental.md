# Cloudflare Pages (experimental) — Shift PDF v2

This fork deploys as a **static MPA** to Cloudflare Pages. Do not use SPA
fallback redirects (`/* /index.html 200`) — each tool is its own HTML file.

## Quick deploy

```bash
npm ci
npm run build
npx wrangler pages deploy dist --project-name=shift-pdf-v2
```

Or connect the GitHub repo in the Cloudflare dashboard:

| Setting                | Value           |
| ---------------------- | --------------- |
| Framework preset       | None            |
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Root directory         | `/`             |
| `NODE_VERSION`         | `20`            |

## Environment variables (Pages)

| Variable           | Suggested experimental value                          |
| ------------------ | ----------------------------------------------------- |
| `VITE_BRAND_NAME`  | `Shift PDF`                                           |
| `VITE_BRAND_LOGO`  | `images/shift-pdf-logo.svg`                           |
| `VITE_FOOTER_TEXT` | `Shift PDF experimental — files stay in your browser` |
| `NODE_VERSION`     | `20`                                                  |

## Headers

`public/_headers` is copied into `dist/` and regenerated at build time by
`scripts/generate-security-headers.mjs` with:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless` (SharedArrayBuffer / LibreOffice)
- CSP allowing default jsDelivr WASM origins

## MPA note

Do **not** add a catch-all `_redirects` SPA rule. Tool URLs like `/merge-pdf`
and `/merge-pdf.html` must resolve to their own files.

## Visual shell

The app uses a persistent sidebar shell (not a top-bar-only layout).
