## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` and `docs/adr/` at the repo root). See `docs/agents/domain.md`.

### Architecture pointers

- **HTML layout**: Workspace shell pages (`index.html`, `my-pdfs.html`, `all-tools.html`) and the Convert **Tool Surface** (`pdf-converter.html`) live at the repo root; all other 31 canonical **Tool Surface** `.html` pages live under `src/pages/`. Rollup inputs are registered in `vite.config.ts`.
- **Pre-paint sidebar mirror**: When editing `PRUNED_TOOL_IDS`, `SURFACE_BY_ENTRY_ID`, or `SIDEBAR_FAVORITE_LIMIT` in `src/js/config/tools.ts` / `src/js/logic/tool-favorites.ts`, update the ES5 pre-paint mirror in `public/sidebar-boot.js` (`src/tests/tool-favorites.test.ts` enforces parity).
- **Review standards**: `/code-review` reads `CODING_STANDARDS.md` at the repo root.
