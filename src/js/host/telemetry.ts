import packageJson from '../../../package.json';
import { getHostAnalytics } from './bridge.js';
import {
  classifyAlertTitle,
  errorTypeFromPdfjs,
  handoffReasonFromError,
  inspectPdfBytes,
  readMemoryBucket,
  sizeBucket,
} from './pdf-signals.js';
import {
  PDF_ENGINE_EVENTS,
  SCHEMA_VERSION,
  prepareEvent,
  sanitizeRejectedEventName,
  type ErrorType,
  type FeatureId,
  type HandoffChannel,
  type HandoffReason,
  type HandoffResult,
  type PdfKind,
  type PerformancePhase,
  type SizeBucket,
  type TelemetryProperties,
  type TelemetryStep,
} from './telemetry-schema.js';

export {
  PDF_ENGINE_EVENTS,
  SCHEMA_VERSION,
  classifyAlertTitle,
  errorTypeFromPdfjs,
  handoffReasonFromError,
  inspectPdfBytes,
  sizeBucket,
};
export type { FeatureId, PdfKind, SizeBucket };

/**
 * Consent boundary: the only sink is the host `track` function resolved from
 * VITE_HOST_API_ROOT (integrated Shift builds set `chrome.shift`). If that
 * function is missing, events are dropped in process. Nothing is posted to
 * Mixpanel or any other vendor. See docs/telemetry.md.
 */
export const APP_VERSION: string = packageJson.version;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let rejectedCount = 0;
let rejecting = false;
let loadRecorded = false;

interface PdfContext {
  page_count?: number;
  size_bucket?: SizeBucket;
  pdf_kind?: PdfKind;
}

let pdfContext: PdfContext = {};

export function getTelemetryRejectedCount(): number {
  return rejectedCount;
}

export function resetTelemetryState(): void {
  rejectedCount = 0;
  rejecting = false;
  loadRecorded = false;
  pdfContext = {};
}

export function getToolIdFromPath(pathname = currentPathname()): string {
  const segment = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const id = segment.replace(/\.html$/i, '').toLowerCase();
  if (!id || id === 'index') return 'home';
  if (!SLUG.test(id)) return 'unknown';
  return id;
}

function currentPathname(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname;
}

export function notePdfCharacteristics(update: PdfContext): void {
  const next: PdfContext = { ...pdfContext };
  if (
    typeof update.page_count === 'number' &&
    Number.isInteger(update.page_count) &&
    update.page_count > 0 &&
    update.page_count <= 100_000
  ) {
    next.page_count = update.page_count;
  }
  if (update.size_bucket) next.size_bucket = update.size_bucket;
  if (update.pdf_kind) next.pdf_kind = update.pdf_kind;
  pdfContext = next;
}

export function pdfContextProperties(): PdfContext {
  return { ...pdfContext };
}

function rememberBytes(
  bytes: Uint8Array | undefined,
  byteLength?: number
): void {
  if (bytes) {
    notePdfCharacteristics(inspectPdfBytes(bytes));
    return;
  }
  if (typeof byteLength === 'number') {
    const bucket = sizeBucket(byteLength);
    if (bucket) notePdfCharacteristics({ size_bucket: bucket });
  }
}

export function track(
  eventName: string,
  properties: Record<string, unknown> = {}
): void {
  let prepared: ReturnType<typeof prepareEvent>;
  try {
    prepared = prepareEvent(eventName, properties, {
      appVersion: APP_VERSION,
      toolId: getToolIdFromPath(),
    });
  } catch {
    return;
  }

  if (prepared.ok === false) {
    rejectEvent(prepared.rejectedEvent, prepared.reason);
    return;
  }

  emit(prepared.name, prepared.properties);
}

function emit(eventName: string, properties: TelemetryProperties): void {
  try {
    getHostAnalytics()?.track(eventName, properties);
  } catch {
    // Host analytics must never block PDF work.
  }
}

function rejectEvent(rejectedEvent: string, rejectionReason: string): void {
  rejectedCount += 1;
  if (rejecting) return;
  if (rejectedEvent === PDF_ENGINE_EVENTS.telemetryRejected) return;
  rejecting = true;
  try {
    track(PDF_ENGINE_EVENTS.telemetryRejected, {
      rejected_event: sanitizeRejectedEventName(rejectedEvent),
      rejection_reason: rejectionReason,
      step: 'telemetry',
    });
  } finally {
    rejecting = false;
  }
}

function roundedDuration(durationMs: number): number | undefined {
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined;
  return Math.min(30 * 60 * 1000, Math.round(durationMs));
}

export function recordPerformance(
  phase: PerformancePhase,
  durationMs: number,
  extra: PdfContext & { step?: TelemetryStep } = {}
): void {
  const duration = roundedDuration(durationMs);
  if (duration === undefined) return;
  const memory = readMemoryBucket();
  track(PDF_ENGINE_EVENTS.performanceRecorded, {
    phase,
    duration_ms: duration,
    ...pdfContextProperties(),
    ...extra,
    ...(memory ? { memory_bucket: memory } : {}),
  });
}

export function recordDocumentLoad(options: {
  durationMs: number;
  pageCount?: number;
  byteLength?: number;
  bytes?: Uint8Array;
  failed?: boolean;
  errorType?: ErrorType;
}): void {
  try {
    rememberBytes(options.bytes, options.byteLength);
    if (
      typeof options.pageCount === 'number' &&
      Number.isInteger(options.pageCount)
    ) {
      notePdfCharacteristics({ page_count: options.pageCount });
    }
    if (loadRecorded) return;
    loadRecorded = true;
    recordPerformance('load', options.durationMs, { step: 'load' });
    if (options.failed) {
      track(PDF_ENGINE_EVENTS.error, {
        step: 'load',
        error_type: options.errorType ?? 'load_failed',
        ...pdfContextProperties(),
      });
    }
  } catch {
    // Load telemetry must not change document loading.
  }
}

export function recordRenderOutcome(
  durationMs: number,
  pageCount: number | undefined,
  failed: boolean
): void {
  try {
    if (typeof pageCount === 'number') {
      notePdfCharacteristics({ page_count: pageCount });
    }
    recordPerformance('render', durationMs, { step: 'render' });
    if (failed) {
      track(PDF_ENGINE_EVENTS.error, {
        step: 'render',
        error_type: 'render_failed',
        ...pdfContextProperties(),
      });
    }
  } catch {
    // Render telemetry must not change rendering.
  }
}

export function reportHandoff(details: {
  result: HandoffResult;
  reason: HandoffReason;
  channel: HandoffChannel;
  byteLength?: number;
  bytes?: Uint8Array;
}): void {
  try {
    const characteristics: PdfContext = details.bytes
      ? inspectPdfBytes(details.bytes)
      : {};
    if (!details.bytes && typeof details.byteLength === 'number') {
      const bucket = sizeBucket(details.byteLength);
      if (bucket) characteristics.size_bucket = bucket;
    }
    if (details.bytes || typeof details.byteLength === 'number') {
      notePdfCharacteristics(characteristics);
    }
    track(PDF_ENGINE_EVENTS.handoffFinished, {
      result: details.result,
      reason: details.reason,
      channel: details.channel,
      step: 'handoff',
      ...characteristics,
    });
  } catch {
    // Handoff telemetry must not change the transfer.
  }
}

export function reportFeature(featureId: FeatureId): void {
  track(PDF_ENGINE_EVENTS.featureUsed, {
    feature_id: featureId,
    step: 'feature',
  });
}

export function reportError(step: TelemetryStep, errorType: ErrorType): void {
  track(PDF_ENGINE_EVENTS.error, {
    step,
    error_type: errorType,
    ...pdfContextProperties(),
  });
}

export function bytesFromUnknown(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return undefined;
}
