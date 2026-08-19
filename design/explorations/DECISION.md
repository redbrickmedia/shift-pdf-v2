# Concept decision

**Chosen: Concept A — Sidebar shell**

## Why

- Closest to production `shift-pdf` chrome (sticky 276px sidebar + main).
- Matches experiment goal of “light Shift shell cues” while keeping the **full** Bento tool catalog in the main pane.
- Primary five (Home / Compress / Merge / Convert / E-sign) live in the sidebar; category jump links expose all tools.
- Reduces the grid-first overload found across broad competitor suites without
  hiding long-tail capability.
- Gives Shift a stable place for global trust and source links.

## Primary-nav treatment inside full catalog

- Sidebar **primary**: Home, Compress → `compress-pdf.html`, Merge → `merge-pdf.html`, Convert → `pdf-converter.html`, E-sign → `sign-pdf.html`.
- Sidebar **All tools**: anchor links to each category on the home grid.
- No tools hidden or disabled.

## Artifacts

- [concept-a-sidebar.html](./concept-a-sidebar.html)
- [concept-b-topbar.html](./concept-b-topbar.html)
- [concept-c-tokens.html](./concept-c-tokens.html)
- [TOKENS.md](./TOKENS.md)
- [AUDIT.md](./AUDIT.md)
- [COMPETITIVE-RESEARCH.md](./COMPETITIVE-RESEARCH.md)
- [STICKY-TOOLKIT-RECOMMENDATIONS.md](./STICKY-TOOLKIT-RECOMMENDATIONS.md)
- [MIXPANEL-TRACKING.md](./MIXPANEL-TRACKING.md)

## Product decisions

- The experiment competes on local processing, no account, no display ads, broad
  coverage, and fast access to the first job.
- Shift owns the experience; Bento is credited on the trusted Source surface
  instead of appearing as the product's marketing brand.
- The completion state ends with the result and download action.
- Search landing-page handoff and suggested next tools are excluded from this
  work. Suggested next tools belong to
  [ST-14708](https://redbrickmedia.atlassian.net/browse/ST-14708).
- Runtime analytics wiring follows the approved tracking specification in a
  separate implementation story.
