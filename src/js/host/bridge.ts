function pathSegments(path: string): string[] {
  return path.split(/[./]/).filter(Boolean);
}

function resolvePath(path: string): Record<string, unknown> | undefined {
  if (!path) return undefined;

  let current: unknown = globalThis;
  for (const segment of pathSegments(path)) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  if (current == null || typeof current !== 'object') return undefined;
  return current as Record<string, unknown>;
}

export interface HostAnalytics {
  track(eventName: string, properties: Record<string, unknown>): void;
}

/** Production Shift PDF. The http URL redirects here, so origin checks use https. */
export const INTEGRATED_APP_ORIGIN =
  'https://shift-pdf-neo.integrated-apps.tryshift.com';
const INTEGRATED_APP_API_ROOT = 'chrome.shift';

function pageOrigin(): string {
  try {
    return String(globalThis.location?.origin ?? '');
  } catch {
    return '';
  }
}

function apiRoot(): string {
  const configured = String(import.meta.env.VITE_HOST_API_ROOT ?? '').trim();
  if (configured) return configured;
  if (pageOrigin() === INTEGRATED_APP_ORIGIN) return INTEGRATED_APP_API_ROOT;
  return '';
}

export function hasHostConfiguration(): boolean {
  return apiRoot() !== '';
}

/**
 * The host `track` function is the consent boundary. Integrated builds set
 * VITE_HOST_API_ROOT to `chrome.shift`. The production origin resolves that
 * same root when the variable is empty, so pages.dev stays dark. When the
 * root is unset or `track` is missing, callers must drop the event. Do not
 * POST to another vendor.
 */
export function getHostAnalytics(): HostAnalytics | undefined {
  const root = apiRoot();
  const target = resolvePath(root ? `${root}.analytics` : '');
  if (typeof target?.track !== 'function') return undefined;
  return target as unknown as HostAnalytics;
}
