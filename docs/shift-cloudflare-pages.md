# Cloudflare Pages — Shift PDF v2

This fork deploys as a **static MPA** to Cloudflare Pages. Do not use SPA
fallback redirects (`/* /index.html 200`) — each tool is its own HTML file.

## Quick deploy

```bash
npm ci
npm run build
npx wrangler pages deploy dist --project-name=shift-pdf-v2
```

Preview the current git branch (does not publish production):

```bash
npx wrangler login
npm run pages:preview
```

## GitHub Actions (preview)

`.github/workflows/deploy-development.yml` builds `dist/` with npm and deploys via Wrangler.

| Trigger             | Pages `--branch`                             | Result                                    |
| ------------------- | -------------------------------------------- | ----------------------------------------- |
| Pull request        | PR head branch                               | Preview + PR comment with URL             |
| Push to `main`      | `development`                                | Shared development alias (not production) |
| `workflow_dispatch` | current git ref (or `development` on `main`) | Manual preview                            |

Required GitHub secret: `CLOUDFLARE_API_TOKEN` (same token used by other Shift Pages apps). The workflow uses Shift account `4bff8d4d2bb0eb90fd63b5149bbf96c5`.

Create the Pages project once (production branch `main`; CI still publishes previews to non-`main` aliases):

```bash
npx wrangler pages project create shift-pdf-v2 --production-branch=main
```

Do **not** use the shared `integrated-apps-deploy-cloudflare` action here. It runs `pnpm pages:build` and uploads `.vercel/output/static` (Next.js). This app is a Vite MPA.

Or connect the GitHub repo in the Cloudflare dashboard:

| Setting                | Value           |
| ---------------------- | --------------- |
| Framework preset       | None            |
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Root directory         | `/`             |
| `NODE_VERSION`         | `22`            |

## Environment variables (Pages)

| Variable           | Suggested value                          |
| ------------------ | ---------------------------------------- |
| `VITE_BRAND_NAME`  | `Shift PDF`                              |
| `VITE_BRAND_LOGO`  | `images/shift-pdf-logo.svg`              |
| `VITE_FOOTER_TEXT` | `Shift PDF — files stay in your browser` |
| `NODE_VERSION`     | `22`                                     |

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

Concept A (sidebar) — see `design/explorations/DECISION.md`.
