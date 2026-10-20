# Coding Standards

Standards enforced during `/code-review`. Domain terms follow [`GLOSSARY.md`](GLOSSARY.md) and architectural decisions live in [`docs/adr/`](docs/adr/).

## Domain & ADR Contracts

- **Vocabulary (`GLOSSARY.md`)**: Use **Catalog Entry**, **Tool Surface**, **Tool Launcher**, **Favorites**, **Launch Context**, **Output Session**, and **Commit Bar** in identifiers, comments, tests, and PR descriptions.
- **Launch Context & i18n (`ADR-0001`)**:
  - Consolidated **Catalog Entries** route to their canonical **Tool Surface** via `?entry=<catalog-entry-id>` and synchronize in-place mode/destination changes via `setLaunchContext(entryId)` (`history.replaceState`).
  - When updating header `<h1>` or `[data-viewer-chrome="subtitle"]` for a **Launch Context**, rebind `data-i18n` via `getCatalogEntryI18nPrefix(entryId)` (or remove `data-i18n` when the entry has no `tools:*` key) so subsequent `applyTranslations()` calls translate the active **Catalog Entry** rather than reverting to the surface's default copy.
- **Tool Launchers & File Seeding (`ADR-0002`)**:
  - Global Left Sidebar links (`#shift-favorite-tools`, capped to the top 6 **Favorites**, and `All tools`) always clear `shiftOpenWithSelection` (`clearOpenWithSelection()`) and open an empty **Tool Surface**.
  - Only the contextual `Open with` menu in `My PDFs` and `View PDF` (including its `Browse all tools…` hop) arms `markOpenWithSelection()` to seed files into a **Tool Surface**.
- **Commit Bar & Pure Staging (`ADR-0003`, `ADR-0004`)**:
  - Every **Tool Surface** commits primary output from the bottom **Commit Bar** (`Reset`, `Overwrite`, `Save`, `Download`, `Print`) via `registerToolOutputSession`, executing `applyToolOutput()` fresh on every commit. The header keeps only title, `Back`, `Undo`/`Redo`, and tool extras.
  - Primary output stages via `downloadFile(blob, filename, summary)` (which dispatches `PDF_OUTPUT_READY_EVENT` without auto-saving to `My PDFs`, prompting disk handles, or opening completion modals).
  - Secondary granular inline exports (such as `.txt` in OCR, `.csv` in Page Dimensions, or per-item image/attachment downloads) must call `downloadBlob()` directly so they never overwrite the staged **Output Session**.

## Page Controller Hygiene

- **Idempotent initialization**: Page controllers that bind `document.addEventListener('DOMContentLoaded', init)` and also call `init()` when `document.readyState !== 'loading'` must guard against double execution when `readyState === 'interactive'`.
- **Observable-contract tests**: Unit and page tests under `src/tests/` assert observable DOM state, URL query parameters, staged **Output Session** blobs (`getLatestPdfOutput()`), `My PDFs` IndexedDB records, and telemetry payloads at the module boundary rather than reading private implementation strings.
