# Commit actions live in a bottom Commit Bar, not the header

Supersedes the "commit from the top-right header" part of [ADR 0003](0003-unified-tool-output-and-save-lifecycle.md).

Testing the header-only commit surface showed it is not discoverable: Compress could only be started from the top-right actions, Convert's export button was out of sight after choosing a format, and `Reset` / `Download` sat far from where the flow ends. Tool Surfaces read top to bottom, so the last action belongs at the bottom.

## Decision

- One shared **Commit Bar** (`Reset` left; `Overwrite`, `Save`, `Download`, `Print` right) is built by `viewer-chrome` from the same feature map as before and mounted at the bottom of every Tool Surface in three layouts: card pages, viewer-mode pages, and mobile. It is hidden on the empty state.
- The header keeps the title, `Back`, `Undo` / `Redo`, and tool-specific extras. The `View PDF` launchpad keeps its header actions (it is a viewer, not a processing flow).
- The primary label is tool-specific through the Output Session (`primaryLabel`, for example `Compress` or `Convert`), falling back to `Download`.
- Which actions appear is still decided by the per-surface action matrix (non-PDF output hides `Save` / `Overwrite` / `Print`, read-only modes disable them). That matrix is the acceptance test for the bar.

## Unchanged from ADR 0003

- Commit is one step: `applyToolOutput()` runs the tool fresh on every `Save`, `Overwrite`, `Download` and `Print`.
- `downloadFile()` is pure staging; `Save` adds `My PDFs` entries, `Overwrite` updates in place, `Download` only downloads.
- In-card `#process-btn` stays hidden and is driven by the Output Session.

## Performance

A staged-output cache was considered to make a second commit cheaper and rejected: it would make commit stop meaning "run now" and add invalidation for every option. Slow Compress on a tiny PDF is the cold PyMuPDF + Ghostscript WASM load, so the engine is preloaded when a file is added and the Condense run logs `load` and `compress` timings. A Compress-only cache is reconsidered only if measurement shows compute dominates.
