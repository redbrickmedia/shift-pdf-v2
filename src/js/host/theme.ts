import { hasHostConfiguration } from './bridge.js';

type ColorMode = 'light' | 'dark';

const STANDALONE_COLOR_MODE: ColorMode = 'dark';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** Host `executeScript` path. The attribute is also set before this event. */
export const THEME_ACTIVE_PATH = '/appearance/theme/active';

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

function colorModeFromPreferredScheme(): ColorMode {
  if (typeof window.matchMedia !== 'function') return STANDALONE_COLOR_MODE;
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
}

function onActiveTheme(event: Event): void {
  applyDataTheme((event as CustomEvent).detail);
}

/**
 * Colour mode only. Does not touch `data-theme` or inline palette stops.
 * The host writes both itself; stylesheet rules alias those stops.
 */
function startColorModeSync(): void {
  applyColorMode(colorModeFromPreferredScheme());
  if (typeof window.matchMedia !== 'function') return;

  window.matchMedia(DARK_SCHEME_QUERY).addEventListener('change', (event) => {
    applyColorMode(event.matches ? 'dark' : 'light');
  });
}

/**
 * Preset id. Inline custom-theme stops stay on the host script: sibling
 * integrated apps do not re-apply `/appearance/theme/customThemeCssVars`.
 */
function startActiveThemeSync(): void {
  window.addEventListener(THEME_ACTIVE_PATH, onActiveTheme);
}

/**
 * Standalone builds retain the current default dark appearance. Integrated
 * builds follow the host colour scheme and keep a `data-theme` the host
 * already wrote. They do not follow the OS scheme when no host is present.
 */
export function startThemeSync(): void {
  if (!hasHostConfiguration()) {
    applyStandaloneTheme();
    return;
  }
  startColorModeSync();
  startActiveThemeSync();
}
