# Shift PDF Mixpanel tracking specification

**Ticket:** [ST-14683](https://redbrickmedia.atlassian.net/browse/ST-14683)  
**Status:** implementation-ready specification; runtime delivery is out of scope

## Measurement goal

Measure whether people who enter the Shift PDF toolkit use a tool and return for
another PDF job.

This plan intentionally does not measure search landing-page handoff or
post-convert suggested tools. Those flows are outside ST-14683.

## Existing-event check

The Bento fork has no Mixpanel client or Shift analytics bridge. The source PRD
already proposes `PdfEngine_ExperienceStarted` and `PdfEngine_ToolUsed`; this
specification retains those names to avoid inventing near-duplicates.

Before implementation, check the current Mixpanel Lexicon for the code-side names
and their kebab-case Mixpanel equivalents. Extend an existing event if its
semantics match; do not create a duplicate only because the property set changed.

## Shared rules

- Code-side event names use `Entity_Action` casing.
- Every event includes `event_type`.
- Trigger values use kebab-case.
- `engine` is `bento` for this prototype and remains explicit for experiment
  comparison.
- `tool_id` uses the stable ID from `src/js/config/tools.ts`.
- Never send file names, paths, document text, page content, or output content.
- `session_id` is an ephemeral identifier for one open toolkit session.

## Event: `PdfEngine_ExperienceStarted`

Fire once after the toolkit shell is ready.

| Property                | Type           | Required | Values or description                                          |
| ----------------------- | -------------- | -------- | -------------------------------------------------------------- |
| `event_type`            | string literal | Yes      | `state-change`                                                 |
| `trigger`               | string literal | Yes      | `app-open` or `tool-route`                                     |
| `engine`                | string literal | Yes      | `legacy` or `bento`                                            |
| `entry_surface`         | string literal | Yes      | `toolkit-home`, `direct-tool-route`, `shift-app`, or `unknown` |
| `tool_id`               | stable tool ID | No       | Present for a direct tool route                                |
| `experiment_variant`    | string         | No       | Experiment arm supplied by the host                            |
| `session_id`            | opaque string  | Yes      | New for each open toolkit session                              |
| `is_returning`          | boolean        | Yes      | A prior toolkit session exists on this device or identity      |
| `days_since_last_visit` | integer        | No       | Whole days since the previous session; omit on first visit     |
| `previous_tool_id`      | stable tool ID | No       | Last opened tool when locally available                        |

**Lexicon description**

> A PDF toolkit session has started. The `entry_surface` and `trigger`
> properties describe how the session began. Return properties describe prior
> toolkit use without including document data.

## Event: `PdfEngine_ToolUsed`

Fire once when a tool operation reaches a terminal result. Do not fire on card
hover, route render, or file selection.

| Property             | Type                 | Required | Values or description                                                                       |
| -------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `event_type`         | string literal       | Yes      | `state-change`                                                                              |
| `trigger`            | string literal       | Yes      | `job-finished`, `job-failed`, or `job-cancelled`                                            |
| `engine`             | string literal       | Yes      | `legacy` or `bento`                                                                         |
| `tool_id`            | stable tool ID       | Yes      | Tool that attempted the operation                                                           |
| `result`             | string literal       | Yes      | `success`, `error`, or `cancelled`                                                          |
| `session_id`         | opaque string        | Yes      | Matches the current experience event                                                        |
| `duration_ms`        | non-negative integer | No       | Time from explicit process action to terminal result                                        |
| `input_count`        | non-negative integer | No       | Number of input files, never their names                                                    |
| `output_count`       | non-negative integer | No       | Number of generated files                                                                   |
| `error_category`     | string literal       | No       | `unsupported-input`, `invalid-input`, `engine-load`, `processing`, `download`, or `unknown` |
| `experiment_variant` | string               | No       | Experiment arm supplied by the host                                                         |

**Lexicon description**

> A PDF tool operation has reached a terminal result. The `tool_id` identifies
> the job, `result` records its outcome, and `duration_ms` measures processing
> time when available.

## Derived funnel and stickiness metrics

| Metric               | Events                        | Definition                                                                                     |
| -------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Session-to-use rate  | Both events                   | Unique sessions with `PdfEngine_ToolUsed` / unique sessions with `PdfEngine_ExperienceStarted` |
| Successful-use rate  | `PdfEngine_ToolUsed`          | Successful operations / all terminal operations                                                |
| Tool breadth         | `PdfEngine_ToolUsed`          | Distinct successful `tool_id` values per user or device                                        |
| D1 return            | `PdfEngine_ExperienceStarted` | Users or devices with another session on the next calendar day                                 |
| W1 return            | `PdfEngine_ExperienceStarted` | Users or devices with another session 1–7 days after first use                                 |
| Repeat-job rate      | Both events                   | Returning sessions with a successful tool operation / returning sessions                       |
| Time to first result | Both events                   | Time from experience start to first successful tool result in a session                        |

## Identity and return-state contract

Preferred identity order:

1. Shift analytics identity supplied by the host application.
2. Existing anonymous Mixpanel identity supplied by the host.
3. A toolkit-scoped anonymous device ID only if privacy review approves it.

Local return context may store:

- Last session timestamp.
- Last opened stable tool ID.
- A bounded visit count.

It must not store:

- File names or paths.
- File contents, hashes, extracted text, or document metadata.
- Error messages that can contain document data.
- Generated output names.

If storage is unavailable, send `is_returning: false` and omit return-detail
properties. Do not block the PDF job.

## Implementation notes for the follow-up story

- Add one Shift analytics adapter rather than importing Mixpanel throughout tool
  modules.
- Let the host own initialization, consent, identity, and experiment assignment.
- Emit the experience event from shared shell startup.
- Add terminal-result hooks behind shared processing helpers where possible.
- Add event-contract tests that assert allowlisted property names and reject
  document-derived values.
- Validate event names and descriptions in Lexicon before enabling production
  delivery.

## Validation checklist

- Each toolkit session emits one experience event.
- Direct routes include `tool_id`; toolkit-home entry does not invent one.
- Each explicit operation emits at most one terminal tool event.
- Cancelled and failed operations do not appear as success.
- No event payload contains a document-derived string.
- A second session can be identified as returning without requiring an account.
- Search handoff and suggested-next-tool interactions produce no events from this
  specification.
