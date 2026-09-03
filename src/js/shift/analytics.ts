import { ANALYTICS_TRACK, analytics } from './host-api.js';

export const EXPERIENCE_STARTED_EVENT = 'PdfEngine_ExperienceStarted';
export const TOOL_USED_EVENT = 'PdfEngine_ToolUsed';
export const EXPERIENCE_STARTED_STORAGE_KEY =
  'shift-pdf-v2:PdfEngine_ExperienceStarted';

export type ToolUsedResult = 'success' | 'error' | 'cancelled';

const ALLOWED_TOOL_USED_KEYS = new Set([
  'event_type',
  'trigger',
  'tool_id',
  'result',
]);

export function getToolIdFromPath(pathname = window.location.pathname): string {
  const segment = pathname.split('/').filter(Boolean).pop() ?? '';
  const id = segment.replace(/\.html$/, '');
  if (!id || id === 'index') return 'home';
  return id;
}

function sanitizeProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!ALLOWED_TOOL_USED_KEYS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function trackPdfEngine(
  eventName: string,
  properties: Record<string, unknown>
): void {
  try {
    if (!analytics.hasMethod(ANALYTICS_TRACK)) return;
    const payload =
      eventName === TOOL_USED_EVENT
        ? sanitizeProperties(properties)
        : {
            event_type: properties.event_type,
            trigger: properties.trigger,
          };
    analytics.getValue(ANALYTICS_TRACK, eventName, payload);
  } catch {
    // Host Mixpanel is unavailable outside Shift.
  }
}

export function trackExperienceStarted(): void {
  try {
    if (sessionStorage.getItem(EXPERIENCE_STARTED_STORAGE_KEY)) return;
    sessionStorage.setItem(EXPERIENCE_STARTED_STORAGE_KEY, '1');
  } catch {
    // sessionStorage can throw in locked-down contexts; still try to emit once.
  }
  trackPdfEngine(EXPERIENCE_STARTED_EVENT, {
    event_type: 'state-change',
    trigger: 'system',
  });
}

export function trackToolUsed(result: ToolUsedResult): void {
  trackPdfEngine(TOOL_USED_EVENT, {
    event_type: 'state-change',
    trigger: 'system',
    tool_id: getToolIdFromPath(),
    result,
  });
}
