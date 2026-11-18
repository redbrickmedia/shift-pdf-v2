# Shift PDF

Shift PDF (v2 / Neo) is a browser-based PDF workspace and toolkit for viewing, editing, converting, and organizing PDFs locally.

## Language

**Catalog Entry**:
A specific, intent-named item in the `All tools` directory (such as "Delete Pages", "Rotate PDF", or "JPG to PDF") that a user searches for or browses to accomplish a task.
_Avoid_: Tool (when referring specifically to the directory listing rather than the editor UI), tool card

**Tool Surface**:
The interactive editor or workspace UI that fulfills one or more Catalog Entries, optionally pre-configured or focused for the entry that launched it.
_Avoid_: Tool page, editor page

**Tool Launcher**:
Any shortcut outside the `All tools` directory that opens a Tool Surface — either a global sidebar pin (which opens an empty Tool Surface) or the contextual `Open with` menu in `My PDFs` and `View PDF` (which seeds the selected or open PDF into the chosen Tool Surface).
_Avoid_: Shortcut, pin, quick action, header launcher

**Favorites**:
The user-ordered shortlist of starred Catalog Entries that populates the top spotlight section of `All tools`, the Left Sidebar `Tools` rail (capped to the top 6), and the leading entries of the `Open with` menu.
_Avoid_: Pinned tools, starred tools, prepinned tools

**Launch Context**:
The identity of the specific Catalog Entry that opened a shared Tool Surface, determining its initial header heading, pre-selected mode or target format, accepted file types, active navigation state, and telemetry attribution.
_Avoid_: Entry mode, route alias, tool preset

**Output Session**:
The active contract between a Tool Surface and the shared Commit Bar that reports action readiness (`canSave`, `canUndo`, `canRedo`, `canReset`, `canPrint`), supplies the tool-specific primary label, and generates fresh staged output on demand when the user commits via `Save`, `Overwrite`, `Download`, or `Print`.
_Avoid_: Process handler, completion modal, auto-save listener

**Commit Bar**:
The single bottom action bar of a Tool Surface holding `Reset` (left) and `Overwrite`, `Save`, `Download`, `Print` (right), shown only once there is something to commit. The header keeps the title, `Back`, `Undo` / `Redo`, and tool-specific extras.
_Avoid_: Action row, footer, header actions, export bar
