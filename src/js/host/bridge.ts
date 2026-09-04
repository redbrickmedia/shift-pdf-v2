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

function apiRoot(): string {
  return String(import.meta.env.VITE_HOST_API_ROOT ?? '').trim();
}

export function hasHostConfiguration(): boolean {
  return apiRoot() !== '';
}

export function getHostAnalytics(): HostAnalytics | undefined {
  const root = apiRoot();
  const target = resolvePath(root ? `${root}.analytics` : '');
  if (typeof target?.track !== 'function') return undefined;
  return target as unknown as HostAnalytics;
}
