/**
 * Versioned PdfEngine event schema.
 *
 * The human catalog is docs/telemetry.md. Runtime validation uses this module
 * and drops anything that does not match, instead of throwing into PDF work.
 */
export const SCHEMA_VERSION = 1;

export const PDF_ENGINE_EVENTS = {
  experienceStarted: 'PdfEngine_ExperienceStarted',
  flowStarted: 'PdfEngine_FlowStarted',
  toolUsed: 'PdfEngine_ToolUsed',
  featureUsed: 'PdfEngine_FeatureUsed',
  error: 'PdfEngine_Error',
  performanceRecorded: 'PdfEngine_PerformanceRecorded',
  handoffFinished: 'PdfEngine_HandoffFinished',
  telemetryRejected: 'PdfEngine_TelemetryRejected',
} as const;

export type PdfEngineEventName =
  (typeof PDF_ENGINE_EVENTS)[keyof typeof PDF_ENGINE_EVENTS];

export const EVENT_TYPES = {
  [PDF_ENGINE_EVENTS.experienceStarted]: 'state-change',
  [PDF_ENGINE_EVENTS.flowStarted]: 'state-change',
  [PDF_ENGINE_EVENTS.toolUsed]: 'state-change',
  [PDF_ENGINE_EVENTS.featureUsed]: 'user-interaction',
  [PDF_ENGINE_EVENTS.error]: 'state-change',
  [PDF_ENGINE_EVENTS.performanceRecorded]: 'state-change',
  [PDF_ENGINE_EVENTS.handoffFinished]: 'state-change',
  [PDF_ENGINE_EVENTS.telemetryRejected]: 'state-change',
} as const;

export type EventType = 'state-change' | 'user-interaction';

export const SIZE_BUCKETS = ['lt_1mb', '1_8mb', 'gt_8mb'] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

export const PDF_KINDS = [
  'text',
  'image',
  'form',
  'encrypted',
  'unknown',
] as const;
export type PdfKind = (typeof PDF_KINDS)[number];

export const MEMORY_BUCKETS = ['lt_50mb', '50_200mb', 'gt_200mb'] as const;
export type MemoryBucket = (typeof MEMORY_BUCKETS)[number];

export const TOOL_RESULTS = ['success', 'error', 'cancelled'] as const;
export type ToolResult = (typeof TOOL_RESULTS)[number];

export const HANDOFF_RESULTS = ['success', 'fail'] as const;
export type HandoffResult = (typeof HANDOFF_RESULTS)[number];

export const ERROR_TYPES = [
  'process_failed',
  'encrypted',
  'malformed',
  'missing_input',
  'restricted',
  'load_failed',
  'render_failed',
  'unsupported',
  'unknown',
] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

export const STEPS = [
  'bootstrap',
  'process',
  'load',
  'render',
  'handoff',
  'feature',
  'telemetry',
] as const;
export type TelemetryStep = (typeof STEPS)[number];

export const FEATURE_IDS = [
  'save',
  'overwrite',
  'download',
  'print',
  'favorite',
  'lock',
  'convert',
  'esign',
  'compress',
] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export const PERFORMANCE_PHASES = ['load', 'render', 'process'] as const;
export type PerformancePhase = (typeof PERFORMANCE_PHASES)[number];

export const HANDOFF_REASONS = [
  'offer_accepted',
  'accepted',
  'missing_bytes',
  'empty',
  'too_large',
  'wrong_mime',
  'load_rejected',
  'load_failed',
] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export const HANDOFF_CHANNELS = [
  'offer',
  'payload',
  'accepted',
  'rejected',
] as const;
export type HandoffChannel = (typeof HANDOFF_CHANNELS)[number];

export const REJECTION_REASONS = [
  'unknown_event',
  'unknown_property',
  'invalid_value',
  'missing_property',
  'forbidden_value',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

const BASE_PROPERTIES = [
  'schema_version',
  'app_version',
  'event_type',
  'tool_id',
] as const;

const PDF_PROPERTIES = ['page_count', 'size_bucket', 'pdf_kind'] as const;

export const EVENT_CATALOG = [
  {
    name: PDF_ENGINE_EVENTS.experienceStarted,
    when: 'Once per browser tab session, when host integration bootstraps.',
    question: 'Did a Shift PDF session start, and on which tool page?',
    properties: [...BASE_PROPERTIES],
  },
  {
    name: PDF_ENGINE_EVENTS.flowStarted,
    when: 'A process job stays armed after the click that started it. Synchronous validation abandons do not emit.',
    question: 'Which tool flows are actually started?',
    properties: [...BASE_PROPERTIES, 'step'],
  },
  {
    name: PDF_ENGINE_EVENTS.toolUsed,
    when: 'A process job reaches a terminal result. success means completed, cancelled means abandoned, error means the job failed.',
    question:
      'Did the tool flow complete, fail, or get abandoned, and how long did processing take?',
    properties: [
      ...BASE_PROPERTIES,
      'result',
      'step',
      'duration_ms',
      'error_type',
      ...PDF_PROPERTIES,
    ],
  },
  {
    name: PDF_ENGINE_EVENTS.featureUsed,
    when: 'A named control is used outside the process-button job: save, overwrite, download, print, favorite, or a viewer launcher.',
    question: 'Which PDF features are used, separate from process-job success?',
    properties: [...BASE_PROPERTIES, 'feature_id', 'step'],
  },
  {
    name: PDF_ENGINE_EVENTS.error,
    when: 'A load, render, or process step fails. A failed process job also emits PdfEngine_ToolUsed with result error.',
    question: 'Where do PDF operations fail, and what class of failure was it?',
    properties: [...BASE_PROPERTIES, 'step', 'error_type', ...PDF_PROPERTIES],
  },
  {
    name: PDF_ENGINE_EVENTS.performanceRecorded,
    when: 'A load, render, or process interval finishes. Load is once per page. Memory is included only when performance.memory exists.',
    question:
      'How long do load, render, and process take, and how heavy is the heap?',
    properties: [
      ...BASE_PROPERTIES,
      'phase',
      'duration_ms',
      'step',
      'memory_bucket',
      ...PDF_PROPERTIES,
    ],
  },
  {
    name: PDF_ENGINE_EVENTS.handoffFinished,
    when: 'A Shift file-handoff channel reaches a handshake or a terminal payload result.',
    question:
      'Did the handoff channel succeed or fail, why, and how large was the payload?',
    properties: [
      ...BASE_PROPERTIES,
      'result',
      'reason',
      'channel',
      'step',
      'size_bucket',
      'pdf_kind',
      'page_count',
    ],
  },
  {
    name: PDF_ENGINE_EVENTS.telemetryRejected,
    when: 'Runtime validation drops an event. The rejection count is this event, not an exception.',
    question:
      'How often does the PDF app produce telemetry that does not match the schema?',
    properties: [
      ...BASE_PROPERTIES,
      'rejected_event',
      'rejection_reason',
      'step',
    ],
  },
] as const;

export const ALLOWED_PROPERTY_KEYS = [
  'schema_version',
  'app_version',
  'event_type',
  'tool_id',
  'result',
  'error_type',
  'step',
  'page_count',
  'size_bucket',
  'pdf_kind',
  'feature_id',
  'phase',
  'duration_ms',
  'memory_bucket',
  'reason',
  'channel',
  'rejected_event',
  'rejection_reason',
] as const;

export type AllowedPropertyKey = (typeof ALLOWED_PROPERTY_KEYS)[number];

const FORBIDDEN_KEYS = new Set([
  'filename',
  'file_name',
  'filepath',
  'file_path',
  'name',
  'path',
  'password',
  'passwd',
  'content',
  'text',
  'page_text',
  'title',
  'url',
  'email',
  'bytes',
  'byte_length',
  'bytelength',
  'message',
  'stack',
  'document',
  'body',
  'query',
  'search',
  'handoff_id',
  'handoffid',
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const APP_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const REJECTED_EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const PII_CHARS = /[\\/@\s]/;
const FILE_EXT = /\.(pdf|doc|docx|xls|xlsx|png|jpg|jpeg|txt|html|htm|zip)$/i;

type PropKind =
  | 'schema'
  | 'version'
  | 'event_type'
  | 'slug'
  | 'duration'
  | 'page_count'
  | 'enum';

interface PropRule {
  kind: PropKind;
  required: boolean;
  values?: readonly string[];
}

const MAX_DURATION_MS = 30 * 60 * 1000;
const MAX_PAGE_COUNT = 100_000;

function rule(
  kind: PropKind,
  required: boolean,
  values?: readonly string[]
): PropRule {
  return { kind, required, values };
}

const baseRules = {
  schema_version: rule('schema', true),
  app_version: rule('version', true),
  event_type: rule('event_type', true),
  tool_id: rule('slug', true),
} as const;

const pdfRules = {
  page_count: rule('page_count', false),
  size_bucket: rule('enum', false, SIZE_BUCKETS),
  pdf_kind: rule('enum', false, PDF_KINDS),
} as const;

const EVENT_RULES: Record<PdfEngineEventName, Record<string, PropRule>> = {
  [PDF_ENGINE_EVENTS.experienceStarted]: { ...baseRules },
  [PDF_ENGINE_EVENTS.flowStarted]: {
    ...baseRules,
    step: rule('enum', true, STEPS),
  },
  [PDF_ENGINE_EVENTS.toolUsed]: {
    ...baseRules,
    result: rule('enum', true, TOOL_RESULTS),
    step: rule('enum', false, STEPS),
    duration_ms: rule('duration', false),
    error_type: rule('enum', false, ERROR_TYPES),
    ...pdfRules,
  },
  [PDF_ENGINE_EVENTS.featureUsed]: {
    ...baseRules,
    feature_id: rule('enum', true, FEATURE_IDS),
    step: rule('enum', false, STEPS),
  },
  [PDF_ENGINE_EVENTS.error]: {
    ...baseRules,
    step: rule('enum', true, STEPS),
    error_type: rule('enum', true, ERROR_TYPES),
    ...pdfRules,
  },
  [PDF_ENGINE_EVENTS.performanceRecorded]: {
    ...baseRules,
    phase: rule('enum', true, PERFORMANCE_PHASES),
    duration_ms: rule('duration', true),
    step: rule('enum', false, STEPS),
    memory_bucket: rule('enum', false, MEMORY_BUCKETS),
    ...pdfRules,
  },
  [PDF_ENGINE_EVENTS.handoffFinished]: {
    ...baseRules,
    result: rule('enum', true, HANDOFF_RESULTS),
    reason: rule('enum', true, HANDOFF_REASONS),
    channel: rule('enum', true, HANDOFF_CHANNELS),
    step: rule('enum', false, STEPS),
    ...pdfRules,
  },
  [PDF_ENGINE_EVENTS.telemetryRejected]: {
    ...baseRules,
    tool_id: rule('slug', false),
    rejected_event: rule('enum', true),
    rejection_reason: rule('enum', true, REJECTION_REASONS),
    step: rule('enum', false, STEPS),
  },
};

export type TelemetryProperties = Record<string, string | number>;

export type PrepareResult =
  | { ok: true; name: PdfEngineEventName; properties: TelemetryProperties }
  | { ok: false; rejectedEvent: string; reason: RejectionReason };

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase());
}

export function looksLikePii(value: string): boolean {
  if (value.length > 80) return true;
  if (PII_CHARS.test(value)) return true;
  return FILE_EXT.test(value);
}

export function sanitizeRejectedEventName(eventName: string): string {
  if (!REJECTED_EVENT_NAME.test(eventName)) return 'unknown';
  if (looksLikePii(eventName)) return 'unknown';
  return eventName;
}

function checkValue(prop: PropRule, value: unknown): 'ok' | 'invalid' | 'pii' {
  if (prop.kind === 'schema') {
    return value === SCHEMA_VERSION ? 'ok' : 'invalid';
  }
  if (prop.kind === 'duration' || prop.kind === 'page_count') {
    const max = prop.kind === 'duration' ? MAX_DURATION_MS : MAX_PAGE_COUNT;
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > max
    ) {
      return 'invalid';
    }
    return 'ok';
  }
  if (typeof value !== 'string') return 'invalid';
  if (looksLikePii(value)) return 'pii';
  if (prop.kind === 'version') {
    return APP_VERSION_PATTERN.test(value) ? 'ok' : 'invalid';
  }
  if (prop.kind === 'slug') return SLUG.test(value) ? 'ok' : 'invalid';
  if (prop.kind === 'event_type') {
    return value === 'state-change' || value === 'user-interaction'
      ? 'ok'
      : 'invalid';
  }
  if (prop.kind === 'enum' && prop.values) {
    return prop.values.includes(value) ? 'ok' : 'invalid';
  }
  if (prop.kind === 'enum' && !prop.values) {
    return REJECTED_EVENT_NAME.test(value) ? 'ok' : 'invalid';
  }
  return 'invalid';
}

export function prepareEvent(
  eventName: string,
  properties: Record<string, unknown>,
  defaults: { appVersion: string; toolId: string }
): PrepareResult {
  const rules = EVENT_RULES[eventName as PdfEngineEventName];
  if (!rules) {
    return {
      ok: false,
      rejectedEvent: eventName,
      reason: 'unknown_event',
    };
  }

  const input: Record<string, unknown> = { ...properties };
  input.schema_version = SCHEMA_VERSION;
  input.app_version = defaults.appVersion;
  input.event_type = EVENT_TYPES[eventName as PdfEngineEventName];
  if (input.tool_id === undefined) input.tool_id = defaults.toolId;

  const cleaned: TelemetryProperties = {};
  for (const [key, value] of Object.entries(input)) {
    if (isForbiddenKey(key)) continue;
    const prop = rules[key];
    if (!prop) {
      return {
        ok: false,
        rejectedEvent: eventName,
        reason: 'unknown_property',
      };
    }
    const verdict = checkValue(prop, value);
    if (verdict === 'pii') {
      if (prop.required) {
        return {
          ok: false,
          rejectedEvent: eventName,
          reason: 'forbidden_value',
        };
      }
      continue;
    }
    if (verdict === 'invalid') {
      return {
        ok: false,
        rejectedEvent: eventName,
        reason: 'invalid_value',
      };
    }
    cleaned[key] = value as string | number;
  }

  for (const [key, prop] of Object.entries(rules)) {
    if (prop.required && !(key in cleaned)) {
      return {
        ok: false,
        rejectedEvent: eventName,
        reason: 'missing_property',
      };
    }
  }

  return {
    ok: true,
    name: eventName as PdfEngineEventName,
    properties: cleaned,
  };
}
