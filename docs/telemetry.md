# Shift PDF telemetry catalog

Schema version: **1**. Event names stay stable. Add properties under a new `schema_version` instead of renaming an event.

An automated reader can treat this file as the contract. The same names and property keys are enforced at runtime by `src/js/host/telemetry-schema.ts`. Invalid events are dropped and counted as `PdfEngine_TelemetryRejected`. They do not throw into PDF work.

## Consent

The only sink is the host `track` function resolved from `VITE_HOST_API_ROOT`. Integrated Shift builds set that variable to `chrome.shift`, which forwards to Shift's analytics API and then Mixpanel. That host API is the consent boundary: if the user has opted out, or this origin is not an allowlisted integrated app, `track` is absent and the PDF app emits nothing.

The production origin is `https://shift-pdf-neo.integrated-apps.tryshift.com`. `http://shift-pdf-neo.integrated-apps.tryshift.com/` redirects there, and the loaded document origin is the https URL. On that origin the app resolves `chrome.shift` even when `VITE_HOST_API_ROOT` is empty. `pages.dev` and local builds do not. Do not set the variable in Wrangler, Pages, or CI.

When `track` is missing the PDF app does not POST, send a beacon, or call a second analytics vendor.

## Privacy

Never send file names, file contents, paths, passwords, page text, handoff ids, or raw byte lengths. Strings that look like a path, an email, or a filename are removed. If a required value is unsafe, the whole event is dropped.

Allowed document characteristics:

| Property         | Values                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page_count`     | Integer page count. Byte scans sample the head and tail of the file and can miss pages; pdf.js `numPages` overwrites that once a document loads. |
| `size_bucket`    | `lt_1mb`, `1_8mb`, `gt_8mb`. Thresholds are 1 MiB and 8 MiB.                                                                                     |
| `pdf_kind`       | `text`, `image`, `form`, `encrypted`, `unknown`. Structure markers only.                                                                         |
| `tool_id`        | Route slug such as `merge-pdf` or `home`. Anything that is not a slug becomes `unknown`.                                                         |
| `result`         | Tool jobs: `success` (completed), `error`, `cancelled` (abandoned). Handoff: `success` or `fail`.                                                |
| `error_type`     | `process_failed`, `encrypted`, `malformed`, `missing_input`, `restricted`, `load_failed`, `render_failed`, `unsupported`, `unknown`.             |
| `step`           | `bootstrap`, `process`, `load`, `render`, `handoff`, `feature`, `telemetry`.                                                                     |
| `app_version`    | `package.json` version.                                                                                                                          |
| `schema_version` | `1`.                                                                                                                                             |

Every event also has `event_type`: `state-change` or `user-interaction`. Properties are snake*case. Names follow Shift's `Object_Action` style as `PdfEngine*<ObjectOrAction>`.

## Flow map

| Stage                    | Event                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Session opened           | `PdfEngine_ExperienceStarted`                                      |
| Process job stayed armed | `PdfEngine_FlowStarted`                                            |
| Process job completed    | `PdfEngine_ToolUsed` with `result` `success`                       |
| Process job abandoned    | `PdfEngine_ToolUsed` with `result` `cancelled`                     |
| Process job failed       | `PdfEngine_ToolUsed` with `result` `error`, plus `PdfEngine_Error` |

A click that fails validation in the same turn calls `abandonToolUse` and emits neither start nor terminal event. That keeps empty-file checks out of the funnel.

## Events

### `PdfEngine_ExperienceStarted`

|                  |                                                                 |
| ---------------- | --------------------------------------------------------------- |
| When             | Once per browser tab session, when host integration bootstraps. |
| Question         | Did a Shift PDF session start, and on which tool page?          |
| `schema_version` | `1`                                                             |
| `app_version`    | Package version                                                 |
| `event_type`     | `state-change`                                                  |
| `tool_id`        | Current route slug                                              |

### `PdfEngine_FlowStarted`

|                  |                                                               |
| ---------------- | ------------------------------------------------------------- |
| When             | A process job is still armed after the click that started it. |
| Question         | Which tool flows are actually started?                        |
| `schema_version` | `1`                                                           |
| `app_version`    | Package version                                               |
| `event_type`     | `state-change`                                                |
| `tool_id`        | Current route slug                                            |
| `step`           | `process`                                                     |

### `PdfEngine_ToolUsed`

|                  |                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------- |
| When             | A process job reaches a terminal result. This is the existing event.                  |
| Question         | Did the tool flow complete, fail, or get abandoned, and how long did processing take? |
| `schema_version` | `1`                                                                                   |
| `app_version`    | Package version                                                                       |
| `event_type`     | `state-change`                                                                        |
| `tool_id`        | Current route slug                                                                    |
| `result`         | `success`, `error`, or `cancelled`                                                    |
| `step`           | `process`                                                                             |
| `duration_ms`    | Process time when the job was armed. Omitted if success is reported with no start.    |
| `error_type`     | Present when `result` is `error`.                                                     |
| `page_count`     | Optional                                                                              |
| `size_bucket`    | Optional                                                                              |
| `pdf_kind`       | Optional                                                                              |

### `PdfEngine_FeatureUsed`

|                  |                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| When             | Save, overwrite, download, print, favorite, or a viewer launcher (lock, convert, esign, compress) is clicked. |
| Question         | Which PDF features are used, separate from process-job success?                                               |
| `schema_version` | `1`                                                                                                           |
| `app_version`    | Package version                                                                                               |
| `event_type`     | `user-interaction`                                                                                            |
| `tool_id`        | Current route slug                                                                                            |
| `feature_id`     | `save`, `overwrite`, `download`, `print`, `favorite`, `lock`, `convert`, `esign`, `compress`                  |
| `step`           | `feature`                                                                                                     |

### `PdfEngine_Error`

|                  |                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When             | Load, render, or process fails. Alert titles are classified locally and are not sent. pdf.js errors contribute only `PasswordException` or `InvalidPDFException`. |
| Question         | Where do PDF operations fail, and what class of failure was it?                                                                                                   |
| `schema_version` | `1`                                                                                                                                                               |
| `app_version`    | Package version                                                                                                                                                   |
| `event_type`     | `state-change`                                                                                                                                                    |
| `tool_id`        | Current route slug                                                                                                                                                |
| `step`           | `load`, `render`, or `process`                                                                                                                                    |
| `error_type`     | See the privacy table                                                                                                                                             |
| `page_count`     | Optional                                                                                                                                                          |
| `size_bucket`    | Optional                                                                                                                                                          |
| `pdf_kind`       | Optional                                                                                                                                                          |

A failed process job emits this event and `PdfEngine_ToolUsed` with `result` `error`. Count failures with one of them, not the sum.

### `PdfEngine_PerformanceRecorded`

|                  |                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| When             | A load, render, or process interval finishes. Load is recorded once per page. Render wraps progressive page render. Process wraps an armed tool job. |
| Question         | How long do load, render, and process take, and how heavy is the heap?                                                                               |
| `schema_version` | `1`                                                                                                                                                  |
| `app_version`    | Package version                                                                                                                                      |
| `event_type`     | `state-change`                                                                                                                                       |
| `tool_id`        | Current route slug                                                                                                                                   |
| `phase`          | `load`, `render`, or `process`                                                                                                                       |
| `duration_ms`    | Integer milliseconds, capped at 30 minutes                                                                                                           |
| `step`           | Same phase name                                                                                                                                      |
| `memory_bucket`  | `lt_50mb`, `50_200mb`, `gt_200mb` only when `performance.memory.usedJSHeapSize` exists. Omitted otherwise. Not a raw byte count.                     |
| `page_count`     | Optional                                                                                                                                             |
| `size_bucket`    | Optional                                                                                                                                             |
| `pdf_kind`       | Optional                                                                                                                                             |

### `PdfEngine_HandoffFinished`

|                  |                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| When             | The Shift file handoff replies ready to an offer, or a payload is accepted or rejected. Ignored foreign messages are not events. |
| Question         | Did the handoff channel succeed or fail, why, and how large was the payload?                                                     |
| `schema_version` | `1`                                                                                                                              |
| `app_version`    | Package version                                                                                                                  |
| `event_type`     | `state-change`                                                                                                                   |
| `tool_id`        | Current route slug                                                                                                               |
| `result`         | `success` or `fail`                                                                                                              |
| `reason`         | `offer_accepted`, `accepted`, `missing_bytes`, `empty`, `too_large`, `wrong_mime`, `load_rejected`, `load_failed`                |
| `channel`        | `offer`, `accepted`, or `rejected`                                                                                               |
| `step`           | `handoff`                                                                                                                        |
| `size_bucket`    | Payload size when the bytes are known. Raw lengths are not sent.                                                                 |
| `pdf_kind`       | Optional, from the payload structure                                                                                             |
| `page_count`     | Optional                                                                                                                         |

### `PdfEngine_TelemetryRejected`

|                    |                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------- |
| When               | Validation refuses an event. The refused payload is not forwarded.                          |
| Question           | How often does the PDF app produce telemetry that does not match the schema?                |
| `schema_version`   | `1`                                                                                         |
| `app_version`      | Package version                                                                             |
| `event_type`       | `state-change`                                                                              |
| `tool_id`          | Optional route slug                                                                         |
| `rejected_event`   | Catalog name, or `unknown` when the name itself is unsafe                                   |
| `rejection_reason` | `unknown_event`, `unknown_property`, `invalid_value`, `missing_property`, `forbidden_value` |
| `step`             | `telemetry`                                                                                 |

## Delivery gap

Mixpanel receives these events only after an allowlisted integrated-app origin loads a build with `VITE_HOST_API_ROOT=chrome.shift`. `https://shift-pdf-neo.pages.dev` does not. Browser PDF-panel events live on `PdfViewerTracker` in shift-browser PR 5660, not in this catalog.
