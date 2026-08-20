# Colour-theming audit (toolkit dark flip)

A future ticket will ask: when the Shift browser toolkit puts `.dark` /
`[data-theme]` on `<html>`, which parts of this app will **not** follow, and
how much work is each?

Semantic design-system tokens in `src/css/shift-theme.css` `:root` (`--background-secondary`,
`--text-primary`, `--action-*`, etc.) are **not** the subject of this audit.
The toolkit themes those by name; `.dark` / `[data-theme]` out-specify `:root`.
See [TOKENS.md](./TOKENS.md).

The inverted grey ramp and accent-ink overrides on `:root` (lines 51–98 of
`shift-theme.css`) **are** themeable: Tailwind v4 compiles `bg-gray-800`,
`text-indigo-400`, and friends to `var(--color-*)`. Moving that ramp into
per-theme blocks is a CSS change, not a markup rewrite. Those utilities are
counted below as **already themeable**.

The real risk is colour no ramp can reach.

## Summary

A toolkit-driven dark flip is **mostly a ramp change**, not a large markup
rewrite. All **117** tool pages already use the grey ramp
(**3,613** `*-gray-*` utilities) plus **975** `text-white` / `bg-black` /
`bg-white` utilities that `shift-theme.css` already remaps or pins. There are
**zero** Tailwind arbitrary colours (`bg-[#…]`, `[color:#fff]`). Literal
colours in markup are concentrated: **1** `style="…"` hex
(`src/pages/form-creator.html:525`) and **80** non-`var()` hex/rgb values
inside inline `<style>` blocks, **75** of them on `compare-pdfs.html`. The
work that cannot be done by retinting `--color-*` is: (1) hardcoded
`rgb()` / hex in `src/css/` after the `:root` token block — **32** hex +
**108** `rgb()`/`rgba()` + **24** named `white`/`black`; (2) JS/canvas/SVG
chrome colours; (3) vendored pdf.js iframes that key off
`prefers-color-scheme`, not the toolkit class; (4) the missing
`color-scheme` declaration, so native controls stay light.

## Method and false positives

Counts come from `rg` (and one Python pass only where `rg` cannot exclude
`var(--token, #fallback)` spans). Excluded: `node_modules`, `dist`,
`docs/.vitepress/cache`, `.git`. Design-exploration HTML under
`design/explorations/` is out of scope.

| Trap                                               | Handling                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Hex-like ids (`#search-input`, `#preview-content`) | Cat 1 only matches `style="…"` and contents of `<style>` blocks, not `href` / `id`                      |
| `var(--token, #hex)` fallbacks                     | Counted as token references, not literals                                                               |
| `:root` token definitions in `shift-theme.css`     | Excluded from cat 4                                                                                     |
| `&#039;` and similar entities                      | Quoted-hex scan in JS; entity is not a colour                                                           |
| `rg -c` vs occurrence count                        | `-c` is **lines**; `text-white` can appear twice on one line. Occurrence counts use `rg -o` / `--pcre2` |
| PNG/OG images matching `#` in binary               | Listed only for `public/images/*.svg`; PNG “hex” hits ignored                                           |

## Category table

| #   | Category                                                                                                                                    | Count                                                                                                                                                                                                                                                                                                                                 | Classification                                                                                                                                                                             | Command                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Tool pages                                                                                                                                  | **117** files                                                                                                                                                                                                                                                                                                                         | Scope                                                                                                                                                                                      | `ls src/pages/*.html \| wc -l`                                                                                                                                                                                                                        |
| —   | Already themeable: `*-gray-*` utilities in `src/pages/`                                                                                     | **3,613** matches, **117**/117 pages                                                                                                                                                                                                                                                                                                  | Move ramp into `.light` / `.dark`                                                                                                                                                          | `rg -o --glob 'src/pages/*.html' '(?:[a-z0-9:/_-]*:)*(?:bg\|text\|border\|ring\|from\|to\|via\|divide\|outline\|fill\|stroke\|decoration\|accent\|caret\|placeholder)-gray-(?:50\|100\|200\|300\|400\|500\|600\|700\|800\|900)(?:/[0-9]+)?' \| wc -l` |
| —   | Already themeable: selected grey utilities                                                                                                  | `bg-gray-800` **370**, `border-gray-700` **401**, `text-gray-400` **492**, `bg-gray-700` **446**, `text-gray-300` **399**, `border-gray-600` **360**                                                                                                                                                                                  | Same                                                                                                                                                                                       | `rg --pcre2 -o --glob 'src/pages/*.html' '(?<![\w-])bg-gray-800(?![\w-])'` (repeat per utility)                                                                                                                                                       |
| 1   | Literal colours in markup (`style="…"` + inline `<style>` not inside `var()`)                                                               | **1** style-attr hex; **0** style-attr rgb/hsl; **80** inline-block literals (**37** hex + **43** rgb/rgba) across **3** pages + `tools.html`                                                                                                                                                                                         | **Not** ramp-reachable                                                                                                                                                                     | Attr: `rg -n --glob '*.html' --glob '!public/**' --glob '!design/**' --glob '!docs/**' 'style="[^"]*#[0-9a-fA-F]{3,8}'`. Inline: Python over `<style>` bodies excluding `var(…)` spans                                                                |
| 2   | Tailwind arbitrary colour (`bg-[#…]`, `text-[rgb(…)]`, `[color:#fff]`)                                                                      | **0** in `*.html` / `src/js/**`                                                                                                                                                                                                                                                                                                       | n/a                                                                                                                                                                                        | `rg -n --glob '*.{html,ts,js}' --glob '!node_modules/**' --glob '!public/**' --glob '!design/**' '(bg\|text\|border\|…)-\[[#]\|\[(color\|background-color\|border-color\|fill\|stroke):'`                                                             |
| 3   | `text-white` / `bg-black` / `bg-white` / `divide-white` etc. (`var(--color-white)` / `var(--color-black)`, **not** overridden in this repo) | Pages: **975** matches, **117**/117 files. Partials: **22**. Root `*.html`: **178**. `src/js/**` class strings: **191**. In pages: `text-white` **844**, `bg-black` **118**, `bg-white` **12**                                                                                                                                        | Themeable in principle; currently pinned. **Caveat:** `.text-white` is already `!important`-remapped to `--text-primary` in `shift-theme.css` except on saturated buttons and black scrims | `rg --pcre2 -o --glob 'src/pages/\*.html' '(?:^                                                                                                                                                                                                       | [\s"'\''\`])((?:[a-z0-9:/_-]_:)_(?:bg\|text\|border\|ring\|from\|to\|via\|divide\|outline\|fill\|stroke\|decoration\|accent\|caret\|placeholder)-(?:white\|black)(?:/[0-9]+)?)' \| wc -l` |
| 4   | Literal colours in `src/css/*.css` that are not `var(--…)` (excluding `:root` token defs in `shift-theme.css`)                              | **32** hex + **108** `rgb()`/`rgba()` + **24** named `white`/`black`                                                                                                                                                                                                                                                                  | **Not** ramp-reachable                                                                                                                                                                     | Hex/rgb: Python over `src/css/*.css`, strip comments, skip `:root {…}` in `shift-theme.css`, skip spans inside `var()`. Named: `rg -c --glob 'src/css/*.css' ':\s*(white\|black)\b'` → `markdown-editor.css` 20, `styles.css` 2, `bookmark.css` 2     |
| 5   | Colours produced from `src/js/**`                                                                                                           | Quoted `#hex`: **96** outside `shift-tool-icons.ts`, **7** string matches inside it (the rest are `fill="#…"` inside one giant SVG string). Quoted `rgb()`/`rgba()`: **17**. `fillStyle`/`strokeStyle` named `white`: **3**. Icons: **58** entries; **62** `currentColor` attributes; **53** `fill="#…"` on branded file-type artwork | Mix of UI chrome, PDF **output** defaults (keep black/white), and brand glyphs                                                                                                             | `rg -n --glob 'src/js/**/*.ts' --glob '!src/js/config/shift-tool-icons.ts' "['\"\`]#[0-9a-fA-F]{3,8}"`                                                                                                                                                |
| 6   | Static SVG/images (app, not pdf.js)                                                                                                         | `public/images/`: **7** SVGs with baked fills (logo, favicons, GDPR/CCPA/HIPAA/badge). **0** SVGs under `src/`                                                                                                                                                                                                                        | Logo/favicons are brand-locked; compliance badges unused by current HTML                                                                                                                   | `ls public/images/*.svg`; hex scan per file                                                                                                                                                                                                           |
| 7   | Vendor surfaces                                                                                                                             | `public/pdfjs-viewer/`, `public/pdfjs-annotation-viewer/`                                                                                                                                                                                                                                                                             | Own theming; see below                                                                                                                                                                     | `rg -l 'prefers-color-scheme' public/pdfjs-viewer --glob '*.css'` → 2 files; annotation viewer → 1 file                                                                                                                                               |
| 8   | Pages with ≥1 item from cats 1–3                                                                                                            | **117** / **117**                                                                                                                                                                                                                                                                                                                     | Driven by cat 3 (`text-white` on every tool page)                                                                                                                                          | Cat 1 only: **3** pages (`compare-pdfs`, `pdf-layers`, `form-creator`)                                                                                                                                                                                |

### Cat 4 breakdown (file:hex / rgb / named)

| File                  | Hex (not `var()`, not `:root` tokens)                | `rgb()`/`rgba()`                    | Named `white`/`black` |
| --------------------- | ---------------------------------------------------- | ----------------------------------- | --------------------- |
| `shift-theme.css`     | 8 (alert tints + forced `#ffffff` on buttons/scrims) | 9 (mostly `rgba(0,0,0,…)` shadows)  | 0                     |
| `styles.css`          | 5 (`#39a0ed`, indigo gradient, `#ffffff`, `#818cf8`) | 12                                  | 2                     |
| `markdown-editor.css` | 13 (GitHub-preview `!important` hex)                 | 82 (default **dark** editor chrome) | 20                    |
| `bookmark.css`        | 6                                                    | 5                                   | 2                     |

### Shift tool icons (`src/js/config/shift-tool-icons.ts`)

Most glyphs use `fill="currentColor"` / `stroke="currentColor"` and will
follow `color` on the grid. Branded Office/file-type artwork bakes MS-style
fills (`#41A5EE`, `#21A366`, `#ED6C47`, Pages orange gradient, greyscale
`#CECECE`). `prepare-pdf-for-ai` uses `var(--action-text-link-active)` /
`--action-text-link-hover` and **will** follow tokens if the DS sheet defines
them.

## Per-page impact (cats 1–3)

Every tool page has cat 3. Cat 1 is three pages. Worst **15** by combined
occurrence count (inline-style literals + white/black utilities):

| Page                    | Total | Cat 1 | Cat 3 |
| ----------------------- | ----- | ----- | ----- |
| `compare-pdfs.html`     | 82    | 75    | 7     |
| `form-creator.html`     | 31    | 1     | 30    |
| `pdf-workflow.html`     | 27    | 0     | 27    |
| `digital-sign-pdf.html` | 23    | 0     | 23    |
| `bookmark.html`         | 22    | 0     | 22    |
| `pdf-multi-tool.html`   | 21    | 0     | 21    |
| `posterize-pdf.html`    | 19    | 0     | 19    |
| `ocr-pdf.html`          | 19    | 0     | 19    |
| `wasm-settings.html`    | 17    | 0     | 17    |
| `add-watermark.html`    | 17    | 0     | 17    |
| `edit-metadata.html`    | 16    | 0     | 16    |
| `split-pdf.html`        | 15    | 0     | 15    |
| `bates-numbering.html`  | 15    | 0     | 15    |
| `pdf-layers.html`       | 13    | 4     | 9     |
| `header-footer.html`    | 13    | 0     | 13    |

`pdf-workflow.html` and `pdf-multi-tool.html` have inline `<style>` blocks
that already use `var(--…)` (hex only as fallbacks) — they inflate cat 3, not
cat 1.

## `color-scheme` / `theme-color`

Confirmed against this tree:

- **No** `<meta name="color-scheme">` or `<meta name="theme-color">` in app
  HTML (`rg` over `*.html` excluding pdf.js: **0** hits).
- **No** `color-scheme` in `src/` CSS (`rg -n 'color-scheme' src`: **0**).

Without `color-scheme: dark` on the document, UA form controls, scrollbars,
and `<input type="file">` chrome stay in the light appearance even if
semantic tokens and the grey ramp both flip. That claim matches the codebase:
nothing currently opts the document into a dark colour scheme.

pdf.js **does** declare `color-scheme` internally (`color-scheme: only light`
on `.annotationLayer` in `public/pdfjs-viewer/viewer.css` around lines
1158–1159; `color-scheme: light dark` on comment buttons). That is vendor CSS
inside the iframe, not the app shell.

## Blockers

Ordered by how broken dark mode looks if only DS tokens + the grey ramp move.
None of these are fixed by retinting `--color-gray-*` / `--color-indigo-*`.

1. **`markdown-editor.css` is a second, hardcoded theme.** Default chrome is
   dark `rgb(31, 41, 55)` / `rgb(55, 65, 81)` (`src/css/markdown-editor.css:48–50`).
   `.md-editor.light-mode` (the JS default in `markdown-editor.ts:338`) uses a
   mix of tokens **and** GitHub light hex (`#0366d6`, `#f6f8fa`, `#24292e` from
   line 688). The in-editor theme toggle does not read the toolkit class.
   **Severity:** high on Markdown → PDF. **Work:** replace rgb/hex with DS
   tokens (or drive the existing `.light-mode` class from `<html>` theme).

2. **`compare-pdfs.html` inline CSS is a private palette.** Overlay canvas
   `background: #ffffff` (`src/pages/compare-pdfs.html:76`), slate legend
   colours (`#cbd5e1`, `#64748b`, `#e2e8f0`, …) and status `rgba(34, 197, 94, 0.28)`
   etc. **75** literals. The compare engine also fills canvases with
   `#ffffff` (`src/js/compare/engine/visual-diff.ts:29`). **Severity:** high
   on one heavy page. **Work:** page-local CSS variables mapped to DS tokens;
   decide whether the PDF raster itself stays white (document, not chrome).

3. **Light-only `!important` tints in `shift-theme.css`.** `.bg-red-900` →
   `#fee2e2`, green `#dcfce7`, blue `#dbeafe`, yellow `#fef9c3`
   (`src/css/shift-theme.css:664–683`); star gold `#d97706` (line 695);
   forced `#ffffff` on saturated buttons (752) and black scrims (764). Correct
   for the **light** shell; in toolkit dark they become pastel islands / keep
   white labels. **Severity:** high, global. **Work:** split these rules into
   `.light` / `.dark` (or drop them once the ramp is per-theme).

4. **Missing `color-scheme`.** Native inputs, scrollbars, file picker stay
   light. **Severity:** medium-high, every page. **Work:** `html { color-scheme: light dark; }`
   plus per-theme `color-scheme: dark` when `.dark` is on.

5. **`bookmark.css` and leftover `styles.css` hex.** Bookmark UI
   `color: #374151`, dashed `#2b7fff`, tracks `#e5e7eb`
   (`src/css/bookmark.css:2–7, 59`). `#tool-interface { color: #39a0ed; }`
   (`src/css/styles.css:214`); `.legal-content` still uses `color: white` and
   `rgb(129 140 248)` (535–544); indigo CTA gradient `#6366f1, #8b5cf6` (335).
   **Severity:** medium, few surfaces.

6. **JS/canvas chrome.** Booklet folding preview
   `fillStyle = '#1f2937'` (`src/js/logic/pdf-booklet-page.ts:252`); form
   creator preview greys (`form-creator.ts:576` `#374151`, `:697` `#e5e7eb`);
   workflow editor category colours (`workflow/editor.ts:29–45`); canvas
   editor stroke `rgba(79, 70, 229, 0.9)` (`canvasEditor.ts:133`). **Do not
   theme** PDF **output** defaults (`#000000` text / `#ffffff` page fill in
   watermark, header-footer, redact nodes) — those are document colours.

7. **`bg-white` canvases.** Form creator page surface
   `class="bg-white"` (`src/pages/form-creator.html:527`) plus
   `style="border: 1px solid #374151"` (525). `--color-white` is never
   overridden. In dark, the PDF sheet may stay white on purpose; the border
   will not follow.

8. **Vendored pdf.js iframes (never follow the app theme class).** Loaded
   from `form-filler-page.ts`, `sign-pdf-page.ts` (`public/pdfjs-viewer/viewer.html`)
   and `add-stamps.ts` (`public/pdfjs-annotation-viewer/web/viewer.html`).
   Viewer CSS uses `@media (prefers-color-scheme: dark)` (`pdfjs-viewer/viewer.css:623`
   and four more; `pdf_viewer.css:518`; annotation `web/viewer.css:60`). The
   iframe is a separate document: toolkit `.dark` on the parent `<html>` does
   **not** apply. OS light + toolkit dark → **light viewer inside a dark
   shell**. Annotation layers also force `color-scheme: only light`.
   **Work:** pass a theme query/hash if pdf.js supports it, restyle via a thin
   overlay, or accept the mismatch. Do not fork viewer CSS in the first
   ticket unless product requires it.

## Cheap wins

These follow a successful token flip **without** editing 117 HTML files:

- Move the grey ramp and accent-ink overrides (`shift-theme.css` 51–98) out of
  `:root` into `.light` / `[data-theme=light]` (keep today’s inverted values)
  and `.dark` / `[data-theme=dark]` (restore stock Tailwind greys / pale
  accent ink). That re-themes **3,613** grey utilities and the indigo/blue/…
  ink overrides at once.
- Keep the existing `.text-white { color: var(--text-primary) }` remap for
  light, and invert or drop it in dark so button labels stay contrast-safe.
- Split the `.bg-red-900` / `.bg-green-900` pastel `!important` rules by
  theme (blocker 3).
- Set `color-scheme` on `html` to match the toolkit class (blocker 4).
- Optionally set `--color-white` / `--color-black` per theme if any remaining
  `bg-white` chrome (not PDF paper) should move.

## Estimate-ready story split

| Story                       | What                                                                                                                        | Size                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A — Ramp + chrome CSS       | Per-theme `--color-gray-*` / accent-ink; split alert tints; `color-scheme`; leftover `styles.css` / `bookmark.css` literals | **S** (one CSS file + small leftovers). Unblocks the catalog. |
| B — Markdown editor         | Replace `markdown-editor.css` rgb/hex (and preview `!important` hex) with tokens; wire `.light-mode` to toolkit theme       | **M**. One feature surface (`markdown-to-pdf`).               |
| C — Compare PDFs            | Tokenise the 75 inline literals; keep raster fill white unless product wants a dark stage                                   | **M**. One page.                                              |
| D — JS/canvas chrome        | Booklet preview, form-creator preview, workflow node colours, canvas editor stroke                                          | **M**. Do not change PDF output defaults.                     |
| E — Vendor pdf.js           | Iframe vs `prefers-color-scheme` vs toolkit class; annotation `only light`                                                  | **L** or **won’t do**. Product call.                          |
| F — Brand glyphs / favicons | Office-coloured tool icons, `shift-pdf-logo.svg`, `favicon.svg` (`#111827` disc)                                            | **S** cosmetic / **won’t do** (brand).                        |

Suggested first ticket: **A only**. That is the difference between “the
shell went dark and 117 tool pages stayed a light grey island” and “the app
follows the toolkit except known holdouts (markdown, compare, pdf.js,
native widgets until `color-scheme` lands).”
