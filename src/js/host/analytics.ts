import { classifyAlertTitle } from './pdf-signals.js';
import {
  APP_VERSION,
  PDF_ENGINE_EVENTS,
  SCHEMA_VERSION,
  getTelemetryRejectedCount,
  getToolIdFromPath,
  pdfContextProperties,
  recordPerformance,
  reportError,
  reportFeature,
  resetTelemetryState,
  track,
} from './telemetry.js';
import type { ErrorType, FeatureId, ToolResult } from './telemetry-schema.js';

export {
  APP_VERSION,
  PDF_ENGINE_EVENTS,
  SCHEMA_VERSION,
  getTelemetryRejectedCount,
  getToolIdFromPath,
  track,
};
export type { ToolResult };

export const EXPERIENCE_SENT_STORAGE_KEY =
  'pdf-engine:analytics:experience-sent';

const PROCESS_BUTTON_SELECTOR = '#process-btn, #crop-button';

const VIEWER_TOOL_FEATURES: Record<string, FeatureId> = {
  'encrypt-pdf.html': 'lock',
  'pdf-converter.html': 'convert',
  'sign-pdf.html': 'esign',
  'compress-pdf.html': 'compress',
};

const OUTPUT_FEATURE_IDS: Record<string, FeatureId> = {
  'shift-tool-output-save': 'save',
  'shift-tool-output-overwrite': 'overwrite',
  'shift-tool-output-download': 'download',
  'shift-tool-output-print': 'print',
  'shift-pdf-viewer-print': 'print',
};

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Analytics must never block a PDF operation.
  }
}

export function trackExperienceStarted(): void {
  if (storageGet(EXPERIENCE_SENT_STORAGE_KEY) === 'true') return;
  track(PDF_ENGINE_EVENTS.experienceStarted);
  storageSet(EXPERIENCE_SENT_STORAGE_KEY, 'true');
}

let inFlight = false;
let reported = false;
let processClickActive = false;
let listening = false;
let featureListening = false;
let startEmitted = false;
let timingArmed = false;
let startedAt = 0;
let flowGeneration = 0;
let pendingError: { step: 'process'; error_type: ErrorType } | null = null;

function emitFlowStarted(): void {
  if (startEmitted) return;
  startEmitted = true;
  track(PDF_ENGINE_EVENTS.flowStarted, { step: 'process' });
}

export function beginToolUse(): void {
  inFlight = true;
  reported = false;
  startEmitted = false;
  pendingError = null;
  timingArmed = true;
  startedAt = performance.now();
  const generation = ++flowGeneration;
  queueMicrotask(() => {
    if (
      generation !== flowGeneration ||
      startEmitted ||
      reported ||
      !inFlight
    ) {
      return;
    }
    emitFlowStarted();
  });
}

/** Drop an armed job without emitting (validation returns during a process click). */
export function abandonToolUse(): void {
  if (reported) return;
  inFlight = false;
  timingArmed = false;
  flowGeneration += 1;
}

export function endToolUse(result: ToolResult): void {
  if (reported) return;
  if (result !== 'success' && !inFlight) return;

  const durationMs = timingArmed
    ? Math.max(0, Math.round(performance.now() - startedAt))
    : undefined;
  emitFlowStarted();
  reported = true;
  inFlight = false;
  timingArmed = false;
  flowGeneration += 1;

  const errorFields =
    result === 'error'
      ? (pendingError ?? {
          step: 'process' as const,
          error_type: 'process_failed' as const,
        })
      : null;
  pendingError = null;

  track(PDF_ENGINE_EVENTS.toolUsed, {
    result,
    step: 'process',
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    ...pdfContextProperties(),
    ...(errorFields ?? {}),
  });

  if (durationMs !== undefined) {
    recordPerformance('process', durationMs, { step: 'process' });
  }

  if (errorFields) {
    reportError(errorFields.step, errorFields.error_type);
  }
}

export function noteProcessAlert(type: string = 'error', title = ''): void {
  if (type === 'success') return;
  if (processClickActive) {
    abandonToolUse();
    return;
  }
  pendingError = { step: 'process', error_type: classifyAlertTitle(title) };
  endToolUse('error');
}

export function listenForToolJobs(): void {
  if (listening) return;
  listening = true;
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(PROCESS_BUTTON_SELECTOR)) return;
      processClickActive = true;
      beginToolUse();
    },
    true
  );
  document.addEventListener(
    'click',
    () => {
      processClickActive = false;
    },
    false
  );
  window.addEventListener('pagehide', () => {
    endToolUse('cancelled');
  });
}

function featureIdFromElement(element: Element): FeatureId | undefined {
  const viewerTool = element.getAttribute('data-viewer-tool');
  if (viewerTool) return VIEWER_TOOL_FEATURES[viewerTool];
  if (element.classList.contains('shift-tool-favorite')) return 'favorite';
  const id = element.id;
  return id ? OUTPUT_FEATURE_IDS[id] : undefined;
}

export function listenForFeatureUse(): void {
  if (featureListening) return;
  featureListening = true;
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const source = target.closest(
        '[data-viewer-tool], .shift-tool-favorite, #shift-tool-output-save, #shift-tool-output-overwrite, #shift-tool-output-download, #shift-tool-output-print, #shift-pdf-viewer-print'
      );
      if (!source) return;
      const featureId = featureIdFromElement(source);
      if (!featureId) return;
      reportFeature(featureId);
    },
    true
  );
}

export function resetToolUseForTests(): void {
  inFlight = false;
  reported = false;
  processClickActive = false;
  startEmitted = false;
  timingArmed = false;
  startedAt = 0;
  flowGeneration += 1;
  pendingError = null;
  resetTelemetryState();
}
