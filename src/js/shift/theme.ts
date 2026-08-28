import { getToolkitConfig } from '@redbrickmedia/shift-browser-toolkit';

type ColorMode = 'light' | 'dark';

const STANDALONE_COLOR_MODE: ColorMode = 'dark';
const CONNECTION_POLL_MS = 100;
/** Match the toolkit proxy poll budget (~2.5s) so standalone pages do not leak timers. */
export const CONNECTION_POLL_MAX_ATTEMPTS = 25;
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export function applyColorMode(mode: ColorMode): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark', 'loading');
  root.classList.add(mode);
  root.style.colorScheme = mode;
}

export function applyDataTheme(theme: unknown): void {
  const root = document.documentElement;
  if (theme == null || theme === '') {
    root.removeAttribute('data-theme');
    return;
  }
  root.setAttribute('data-theme', String(theme));
}

export function applyStandaloneTheme(): void {
  applyColorMode(STANDALONE_COLOR_MODE);
  applyDataTheme(null);
}

function colorModeFromPrefersScheme(): ColorMode {
  if (typeof window.matchMedia !== 'function') return STANDALONE_COLOR_MODE;
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
}

/**
 * Shift exposes light/dark to page content only as prefers-color-scheme. The
 * appearance store carries the named theme (default, amber, custom), never the
 * color mode, so quick-settings Mode changes arrive as a media query change.
 */
function startColorModeSync(): void {
  applyColorMode(colorModeFromPrefersScheme());
  if (typeof window.matchMedia !== 'function') return;

  const media = window.matchMedia(DARK_SCHEME_QUERY);
  media.addEventListener('change', (event) => {
    applyColorMode(event.matches ? 'dark' : 'light');
  });
}

function unwrapStoreValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'detail' in value) {
    return (value as { detail: unknown }).detail;
  }
  return value;
}

function subscribeToHostTheme(
  webUiProxyService: ReturnType<typeof getToolkitConfig>['webUiProxyService']
): void {
  webUiProxyService.observeStoreValue(
    '/appearance/theme',
    'active',
    (value) => {
      applyDataTheme(unwrapStoreValue(value));
    }
  );
}

function onHostConnected(
  webUiProxyService: ReturnType<typeof getToolkitConfig>['webUiProxyService']
): void {
  startColorModeSync();
  subscribeToHostTheme(webUiProxyService);
}

/**
 * A live proxy connection is the signal that we are inside Shift. The
 * `chrome.shift` APIs behind `isOutsideShiftBrowser` are origin-allowlisted and
 * absent on dev hosts, but the proxy is injected into every integrated app tab.
 */
function observeHostTheme(): void {
  const { webUiProxyService } = getToolkitConfig();
  webUiProxyService.init();

  if (webUiProxyService.isConnected) {
    onHostConnected(webUiProxyService);
    return;
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (
      webUiProxyService.hasError ||
      attempts >= CONNECTION_POLL_MAX_ATTEMPTS
    ) {
      window.clearInterval(timer);
      return;
    }
    if (!webUiProxyService.isConnected) return;
    window.clearInterval(timer);
    onHostConnected(webUiProxyService);
  }, CONNECTION_POLL_MS);
}

export function startThemeSync(): void {
  applyStandaloneTheme();
  try {
    observeHostTheme();
  } catch {
    // No Shift host: keep the standalone look applied above.
  }
}
