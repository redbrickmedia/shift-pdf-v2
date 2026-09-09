import { hasHostConfiguration } from './bridge.js';

type ColorMode = 'light' | 'dark';

const STANDALONE_COLOR_MODE: ColorMode = 'dark';
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

function colorModeFromPreferredScheme(): ColorMode {
  if (typeof window.matchMedia !== 'function') return STANDALONE_COLOR_MODE;
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
}

function startColorModeSync(): void {
  applyColorMode(colorModeFromPreferredScheme());
  applyDataTheme(null);
  if (typeof window.matchMedia !== 'function') return;

  window.matchMedia(DARK_SCHEME_QUERY).addEventListener('change', (event) => {
    applyColorMode(event.matches ? 'dark' : 'light');
  });
}

/**
 * Standalone builds retain the current default appearance. Integrated builds
 * follow the standard colour-scheme media query maintained by their host.
 */
export function startThemeSync(): void {
  applyStandaloneTheme();
  if (!hasHostConfiguration()) return;
  startColorModeSync();
}
