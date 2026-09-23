# Unified tool output toolbar

Branch intent: one output surface on every tool. Visual iteration first (Sign PDF), then the same component everywhere. All other download/save/reset chrome is removed.

This is not a design-team handoff. You iterate visually in the product.

## Decisions

- Primary action is **Save**. On this branch it stores a **copy in My PDFs**. It does not overwrite a file handle and does not update-in-place the source.
- **Download** is progressive disclosure on Save (chevron / split). It is how you get a browser copy. It is not the default.
- **Reset**, **Undo**, and **Redo** are always visible, on every tool, not inside the Save menu.
- Undo/Redo are **enabled only** where a history stack already exists (Sign via PDF.js, Merge via its snapshot stack). Elsewhere they stay visible and disabled.
- **Process / Apply** still runs the tool. It must not auto-download. Save is enabled when a result exists in memory.
- File System Access / file handling is a later backend swap behind the same Save button.
- Leave-site, convert reliability, print-all-pages, signature color, large-file rendering, and My PDFs layout are **not** this branch.

## Surface (every tool)

Default order, right-weighted like a document app:

`Undo` `Redo` … `Reset` `Save ▾`

Save disclosure:

- Download

Process/Apply stays tool-specific (Merge, Compress, Convert, apply signatures). It is not an output control.

## What gets destroyed

- `downloadFile()` as a side effect of Process
- Completion panel **Download again** / **Start over** as a second output path
- One-off labels: Download Signed PDF, Download Edited PDF
- Implicit “download also saves to library” as the only save path
- Merge-only or Sign-only save/download chrome that is not this toolbar

Library save on Download (today’s `shift:pdf-output-downloaded` listener) should not compete with Save. Download is a browser copy. Save is the library copy.

## Build order

1. Shared toolbar component (Shift tokens, progressive disclosure on Save).
2. Sign PDF: iterate visually. Process produces bytes in memory. Save → My PDFs. Download in the menu. Reset / Undo / Redo on the bar.
3. Merge, Compress, Convert hub destinations, Edit, then remaining tools that call `downloadFile`.
4. Delete leftover completion-panel output actions and per-tool download buttons.

## Enablement

| Control         | When enabled                  |
| --------------- | ----------------------------- |
| Undo / Redo     | Tool has history and can step |
| Reset           | A job or file is loaded       |
| Save            | A result blob exists          |
| Download        | Same as Save (menu item)      |
| Process / Apply | Tool inputs are valid         |

## Out of scope

- Leave-site prompt (host + when “saved” means saved)
- File handling / original disk file
- Updating the existing library row instead of adding a copy
- Full undo stacks for one-shot convert tools
- Track A smoke bugs (convert guards already exist; print, signature color, large PDFs, My PDFs min-height)
