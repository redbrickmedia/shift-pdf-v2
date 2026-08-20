# Shift PDF sticky-toolkit recommendations

**Ticket:** [ST-14683](https://redbrickmedia.atlassian.net/browse/ST-14683)  
**Input:** [competitive research](./COMPETITIVE-RESEARCH.md)  
**Prototype:** Concept A on `krislemieux-shift-experimental-shell`

## Product position

Shift PDF should be the broad, no-account PDF toolkit that makes local processing
obvious and stays fast enough to become a repeat utility.

It should not win by adding more marketing around Bento. It should win by making
the existing tool breadth easier to trust, easier to scan, and easier to return
to than ad-funded and freemium competitors.

## Prioritized 1-ups

### P0 — Make the promise verifiable

**Gap:** Competitors make strong security claims, but most web tools still upload
files. The current prototype says files stay in the browser without showing why
the user should believe it.

**Recommendation**

- Put "Files stay in your browser" beside the first file action.
- Link every standard page to a plain-language About page and an AGPL Source page.
- On the Source page, identify the Shift fork, upstream Bento project, license,
  processing model, and third-party engines.
- Avoid absolute claims for tools that use optional network services. If a tool
  needs a network request, disclose that at the action point.

**Prototype coverage:** About and Source surfaces are included in this ticket.

### P0 — Finish Shift ownership

**Gap:** The shell looks like Shift, but direct About/Licensing pages and some
entry metadata still present upstream Bento marketing.

**Recommendation**

- Use Shift PDF naming, logo, navigation, and voice on the entry and trust pages.
- Keep Bento attribution in the Source surface, where it is useful and honest.
- Remove upstream commercial-license sales copy from the Shift experience.
- Preserve the full tool catalog; Shift ownership is a product layer, not a
  reason to hide AGPL-backed capabilities.

**Prototype coverage:** Shift entry metadata, About, Source, and shared footer
links are included in this ticket.

### P1 — Reduce breadth without reducing capability

**Gap:** iLovePDF and PDF24 prove breadth with large grids, but the first choice is
hard to scan.

**Recommendation**

- Keep Compress, Merge, Convert, and E-sign pinned in the sidebar.
- Let users favorite any other tool from the catalog and pin those favorites in
  the sidebar.
- Keep catalog search above the tool grid.
- Group all remaining tools by user job, not implementation engine.
- On return visits, show up to three recently opened tools above the full catalog.
- Let users clear recent tools; store only tool identifiers and timestamps.

**Prototype coverage:** Pinned primary navigation, catalog search, and locally
persisted sidebar favorites are implemented. Recent tools are a follow-up story.

### P1 — Make the first action predictable

**Gap:** Freemium competitors often reveal limits or account gates after the user
has uploaded a file.

**Recommendation**

- State supported input, expected output, local-processing status, and known
  limits before file selection.
- Use one primary action per workspace.
- Give long-running WASM loads a named stage and progress state.
- Preserve the selected file when a recoverable setting or validation error
  occurs.

**Prototype coverage:** Validate on the four primary tools first. Broader
workspace changes are follow-up stories.

### P2 — Build return cues without an account

**Gap:** Competitor continuity usually depends on cloud storage, an account, or a
desktop install.

**Recommendation**

- Remember recent tool routes locally.
- Remember non-sensitive UI preferences, such as sidebar state and compact mode.
- Never persist file names, file contents, extracted text, or generated output.
- On return, restore navigation context but start each document job clean.

**Prototype coverage:** Sidebar and compact-mode preferences already persist.
Recent-tool context is a follow-up story.

## Key screens and states

### 1. Toolkit home

**Purpose:** prove breadth and get the user to a tool quickly.

**Required states**

- First visit: primary tools, search, categorized catalog, privacy cue.
- Return visit: the same page plus recent tools when local history exists.
- Search: immediate filtered results, clear empty state, keyboard focus retained.
- Tablet and mobile: the sidebar stays at the width the visitor last chose.
  It never auto-shrinks or auto-expands with the viewport, never closes, and
  there is no hamburger.

### 2. Tool workspace

**Purpose:** make the selected job and its processing model obvious.

**Required states**

- Ready: input/output expectations and local-processing cue.
- File selected: file summary and reversible remove/replace action.
- Processing: named progress stage and disabled duplicate submission.
- Error: actionable recovery without losing valid input.
- Complete: result and download action only.

The complete state must not suggest another tool in this ticket. Suggested next
tools belong to [ST-14708](https://redbrickmedia.atlassian.net/browse/ST-14708).

### 3. About

**Purpose:** explain why Shift PDF exists and what "private" means.

**Required content**

- Shift-owned product status.
- Files normally process in the browser.
- No account, quota, or display-ad interruption.
- Honest exceptions for optional network-backed features.
- Link to Source.

### 4. Source and licenses

**Purpose:** make AGPL compliance and upstream attribution easy to find.

**Required content**

- Corresponding Shift source repository.
- Upstream BentoPDF repository.
- AGPL-3.0 notice for the fork.
- Notices for PyMuPDF, Ghostscript, CoherentPDF, and other relevant engines.
- A reminder that the deployed revision and legal boundary need release review.

## Estimate-ready story split

| Story             | Outcome                                                         | Size | Dependencies                           | Main risk                         |
| ----------------- | --------------------------------------------------------------- | ---- | -------------------------------------- | --------------------------------- |
| Trust surfaces    | Shift About and Source pages available everywhere               | S    | Public source repo and approved copy   | Incorrect legal wording           |
| Entry ownership   | Shift metadata and removal of visible Bento marketing on entry  | S    | Final app URL                          | Generated locale/SEO drift        |
| Recent tools      | Local recent-tool row with clear/reset behavior                 | M    | Stable tool IDs                        | Storing sensitive metadata        |
| Workspace clarity | Shared pre-action privacy/limits treatment on primary tools     | M    | Audit of processing paths              | A tool may use network services   |
| Progress contract | Shared loading, error, and completion states                    | L    | Per-engine capability map              | Inconsistent tool implementations |
| Tracking hooks    | Entry, tool outcome, and return events wired to Shift analytics | M    | Approved Mixpanel spec and host bridge | Duplicate or anonymous identities |

Size guide: **S** is isolated shared UI/copy, **M** spans shared state plus several
routes, and **L** requires a cross-tool contract or migration.

## Acceptance and design checks

- A first-time user can identify the four primary jobs without scrolling.
- A user can find any long-tail tool through categories or search.
- Every standard tool page exposes About and Source without opening marketing
  navigation.
- The trust copy distinguishes local processing from optional network behavior.
- Returning context contains no document data.
- The completion state has no search handoff or suggested-next-tool treatment.
- Mobile and collapsed-sidebar layouts keep navigation and trust links usable.

## Explicitly out of scope

- Search landing-page or first-run handoff.
- Post-convert suggested-next-tool recommendations.
- Runtime Mixpanel delivery in this ticket.
- Accounts, cloud document storage, or cross-device history.
- Rewriting Bento tools as custom Shift implementations.
- Production launch before legal review of the AGPL boundary and source offer.
