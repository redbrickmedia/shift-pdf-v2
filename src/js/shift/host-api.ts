import { ChromeShiftProxy } from './chrome-shift-proxy.js';

export const ANALYTICS_TRACK = 'track';

function apiRoot(): string {
  return String(import.meta.env.VITE_SHIFT_API_ROOT ?? '').trim();
}

/**
 * Whether this bundle was built to run as an integrated Shift tab.
 * chrome.shift is often absent on local/dev origins, so the build flag is
 * the signal rather than probing the global.
 */
export function isShiftBuild(): boolean {
  return apiRoot() !== '';
}

function proxyFor(namespace: string): ChromeShiftProxy {
  const root = apiRoot();
  return new ChromeShiftProxy(root ? `${root}.${namespace}` : '');
}

export const analytics = {
  hasMethod: (method: string) => proxyFor('analytics').hasMethod(method),
  getValue: (method: string, ...args: unknown[]) =>
    proxyFor('analytics').getValue(method, ...args),
  setValue: (method: string, ...args: unknown[]) =>
    proxyFor('analytics').setValue(method, ...args),
};
