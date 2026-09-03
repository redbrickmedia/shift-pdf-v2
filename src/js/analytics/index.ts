import { categories } from '../config/tools.js';

export const PDF_ENGINE_EVENTS = {
  experienceStarted: 'PdfEngine_ExperienceStarted',
  toolUsed: 'PdfEngine_ToolUsed',
} as const;

export type PdfEngineEventName =
  (typeof PDF_ENGINE_EVENTS)[keyof typeof PDF_ENGINE_EVENTS];
export type ToolResult = 'success' | 'error' | 'cancelled';
export type ErrorCategory =
  | 'unsupported-input'
  | 'invalid-input'
  | 'engine-load'
  | 'processing'
  | 'download'
  | 'unknown';

type AnalyticsPayload = Record<string, string | number | boolean>;
export type AnalyticsTransport = (
  eventName: PdfEngineEventName,
  payload: AnalyticsPayload
) => void;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface AnalyticsDependencies {
  sessionStorage: StorageLike;
  localStorage: StorageLike;
  transport: AnalyticsTransport;
  now: () => number;
  createId: () => string;
}

export interface ExperienceStartedInput {
  trigger: 'app-open' | 'tool-route';
  entrySurface: 'toolkit-home' | 'direct-tool-route' | 'shift-app' | 'unknown';
  toolId?: string;
  experimentVariant?: string;
}

export interface ToolOperationResult {
  result: ToolResult;
  inputCount?: number;
  outputCount?: number;
  errorCategory?: ErrorCategory;
}

export interface ToolOperation {
  finish(result: ToolOperationResult): boolean;
}

const SESSION_ID_KEY = 'shift-pdf:analytics:session-id';
const EXPERIENCE_SENT_KEY = 'shift-pdf:analytics:experience-sent';
const LAST_VISIT_KEY = 'shift-pdf:analytics:last-visit';
const PREVIOUS_TOOL_KEY = 'shift-pdf:analytics:previous-tool';
const DAY_MS = 86_400_000;
const TOOL_RESULTS = new Set<ToolResult>(['success', 'error', 'cancelled']);
const ERROR_CATEGORIES = new Set<ErrorCategory>([
  'unsupported-input',
  'invalid-input',
  'engine-load',
  'processing',
  'download',
  'unknown',
]);
const EXPERIENCE_TRIGGERS = new Set(['app-open', 'tool-route']);
const ENTRY_SURFACES = new Set([
  'toolkit-home',
  'direct-tool-route',
  'shift-app',
  'unknown',
]);
const STABLE_TOOL_IDS = new Set(
  categories.flatMap((category) => category.tools.map((tool) => tool.id))
);

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function optionalSafeId(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('-') ||
    value.endsWith('-') ||
    value.includes('--')
  ) {
    return undefined;
  }
  return [...value].every(
    (character) =>
      (character >= 'a' && character <= 'z') ||
      (character >= '0' && character <= '9') ||
      character === '-'
  )
    ? value
    : undefined;
}

function optionalVariant(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return undefined;
  }
  return [...value].every(
    (character) =>
      (character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z') ||
      (character >= '0' && character <= '9') ||
      character === '_' ||
      character === '-'
  )
    ? value
    : undefined;
}

function storageGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: StorageLike, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Analytics must never block a PDF operation.
  }
}

export class PdfEngineAnalytics {
  private readonly sessionId: string;

  constructor(private readonly deps: AnalyticsDependencies) {
    const storedSessionId = storageGet(deps.sessionStorage, SESSION_ID_KEY);
    this.sessionId = storedSessionId || deps.createId();
    if (!storedSessionId) {
      storageSet(deps.sessionStorage, SESSION_ID_KEY, this.sessionId);
    }
  }

  private emit(eventName: PdfEngineEventName, payload: AnalyticsPayload): void {
    try {
      this.deps.transport(eventName, payload);
    } catch {
      // Host analytics failures must never block a PDF operation.
    }
  }

  trackExperienceStarted(input: ExperienceStartedInput): boolean {
    const candidateToolId = optionalSafeId(input.toolId);
    const toolId =
      candidateToolId && STABLE_TOOL_IDS.has(candidateToolId)
        ? candidateToolId
        : undefined;
    if (
      storageGet(this.deps.sessionStorage, EXPERIENCE_SENT_KEY) === 'true' ||
      !EXPERIENCE_TRIGGERS.has(input.trigger) ||
      !ENTRY_SURFACES.has(input.entrySurface) ||
      (input.trigger === 'tool-route' && !toolId)
    ) {
      return false;
    }

    const now = this.deps.now();
    const previousVisitRaw = storageGet(this.deps.localStorage, LAST_VISIT_KEY);
    const previousVisit = previousVisitRaw
      ? Number.parseInt(previousVisitRaw, 10)
      : Number.NaN;
    const isReturning = Number.isFinite(previousVisit);
    const payload: AnalyticsPayload = {
      event_type: 'state-change',
      trigger: input.trigger,
      engine: 'bento',
      entry_surface: input.entrySurface,
      session_id: this.sessionId,
      is_returning: isReturning,
    };

    if (toolId) payload.tool_id = toolId;

    const variant = optionalVariant(input.experimentVariant);
    if (variant) payload.experiment_variant = variant;

    if (isReturning) {
      payload.days_since_last_visit = Math.max(
        0,
        Math.floor((now - previousVisit) / DAY_MS)
      );
      const previousToolId = optionalSafeId(
        storageGet(this.deps.localStorage, PREVIOUS_TOOL_KEY)
      );
      if (previousToolId && STABLE_TOOL_IDS.has(previousToolId)) {
        payload.previous_tool_id = previousToolId;
      }
    }

    this.emit(PDF_ENGINE_EVENTS.experienceStarted, payload);
    storageSet(this.deps.sessionStorage, EXPERIENCE_SENT_KEY, 'true');
    storageSet(this.deps.localStorage, LAST_VISIT_KEY, String(now));
    if (toolId) {
      storageSet(this.deps.localStorage, PREVIOUS_TOOL_KEY, toolId);
    }
    return true;
  }

  startToolOperation(toolId: string): ToolOperation {
    const safeToolId = optionalSafeId(toolId);
    const startedAt = this.deps.now();
    let finished = false;

    return {
      finish: (result) => {
        if (
          finished ||
          !safeToolId ||
          !STABLE_TOOL_IDS.has(safeToolId) ||
          !TOOL_RESULTS.has(result.result as ToolResult)
        ) {
          return false;
        }
        finished = true;

        const durationMs = Math.max(0, Math.round(this.deps.now() - startedAt));
        const trigger =
          result.result === 'success'
            ? 'job-finished'
            : result.result === 'cancelled'
              ? 'job-cancelled'
              : 'job-failed';
        const payload: AnalyticsPayload = {
          event_type: 'state-change',
          trigger,
          engine: 'bento',
          tool_id: safeToolId,
          result: result.result,
          session_id: this.sessionId,
          duration_ms: durationMs,
        };

        const inputCount = optionalCount(result.inputCount);
        const outputCount = optionalCount(result.outputCount);
        if (inputCount !== undefined) payload.input_count = inputCount;
        if (outputCount !== undefined) payload.output_count = outputCount;
        if (
          result.result === 'error' &&
          result.errorCategory &&
          ERROR_CATEGORIES.has(result.errorCategory)
        ) {
          payload.error_category = result.errorCategory;
        }

        this.emit(PDF_ENGINE_EVENTS.toolUsed, payload);
        return true;
      },
    };
  }
}

interface ShiftAnalyticsBridge {
  track(eventName: string, payload: AnalyticsPayload): void;
}

interface ShiftWindow extends Window {
  shift?: { analytics?: ShiftAnalyticsBridge };
  Shift?: { analytics?: ShiftAnalyticsBridge };
  shiftAnalytics?: ShiftAnalyticsBridge;
}

function browserTransport(
  eventName: PdfEngineEventName,
  payload: AnalyticsPayload
): void {
  const shiftWindow = window as ShiftWindow;
  const bridge =
    shiftWindow.shift?.analytics ??
    shiftWindow.Shift?.analytics ??
    shiftWindow.shiftAnalytics;

  try {
    if (bridge?.track) {
      bridge.track(eventName, payload);
    } else if (import.meta.env.DEV) {
      console.debug('[Shift PDF analytics]', eventName, payload);
    }
  } catch {
    // The host bridge is optional and cannot affect local PDF processing.
  }
}

function browserId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function browserStorage(name: 'sessionStorage' | 'localStorage'): StorageLike {
  try {
    return window[name];
  } catch {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
  }
}

export const pdfEngineAnalytics =
  typeof window === 'undefined'
    ? null
    : new PdfEngineAnalytics({
        sessionStorage: browserStorage('sessionStorage'),
        localStorage: browserStorage('localStorage'),
        transport: browserTransport,
        now: () => Date.now(),
        createId: browserId,
      });

export function trackPdfEngineExperience(
  validToolIds?: ReadonlySet<string>
): void {
  if (!pdfEngineAnalytics) return;
  const route = window.location.pathname
    .replace(/\/+$/, '')
    .split('/')
    .pop()
    ?.replace(/\.html$/, '');
  const isHome =
    !route || route === 'index' || route === 'my-pdfs' || route === 'all-tools';
  const routeToolId = isHome ? undefined : optionalSafeId(route);
  const toolId =
    routeToolId && (!validToolIds || validToolIds.has(routeToolId))
      ? routeToolId
      : undefined;
  pdfEngineAnalytics.trackExperienceStarted({
    trigger: toolId ? 'tool-route' : 'app-open',
    entrySurface: isHome
      ? 'toolkit-home'
      : toolId
        ? 'direct-tool-route'
        : 'unknown',
    toolId,
  });
}
