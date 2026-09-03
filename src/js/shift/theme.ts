import { isShiftBuild } from './host-api.js';

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

function colorModeFromPrefersScheme(): ColorMode {
  if (typeof window.matchMedia !== 'function') return STANDALONE_COLOR_MODE;
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
}

/**
 * Colour mode for a Shift build comes from prefers-color-scheme, which the
 * host updates when appearance changes. Page content does not call
 * chrome.shift.appearance.
 */
function startColorModeSync(): void {
  applyColorMode(colorModeFromPrefersScheme());
  applyDataTheme(null);
  if (typeof window.matchMedia !== 'function') return;

  window.matchMedia(DARK_SCHEME_QUERY).addEventListener('change', (event) => {
    applyColorMode(event.matches ? 'dark' : 'light');
  });
}

/**
 * Standalone builds hold the fixed look rather than inheriting the visitor's
 * OS preference, which is not a Shift setting and would flip Cloudflare Pages
 * and dev hosts with the machine's appearance.
 */
export function startThemeSync(): void {
  applyStandaloneTheme();
  if (!isShiftBuild()) return;
  startColorModeSync();
}
