/**
 * Shared in-card loader. Ports the Shift design-system Spinner:
 * 24px LoadingIcon, 600ms delayed mount, 0.6s fade, 2s rotation.
 *
 * `showLoader` / `hideLoader` keep the existing call sites. The overlay
 * paints on `#tool-uploader` (the tool card) instead of a full-screen modal.
 * Pass `{ host }` to reuse the same overlay on any other surface.
 */

export const SHIFT_LOADER_DELAY_MS = 600;

const SPINNER_SVG = `<svg class="shift-spinner-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path d="M12 4.75V6.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.1266 6.87347L16.0659 7.93413" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M19.25 12H17.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.1266 17.1265L16.0659 16.0659" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12 17.75V19.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M7.9342 16.0659L6.87354 17.1265" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M6.25 12H4.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M7.9342 7.93413L6.87354 6.87347" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export interface ShowLoaderOptions {
  host?: HTMLElement | null;
}

let revealTimer: number | null = null;
let activeHost: HTMLElement | null = null;

function resolveHost(preferred?: HTMLElement | null): HTMLElement | null {
  if (preferred) return preferred;
  if (typeof document === 'undefined') return null;
  return (
    document.getElementById('tool-uploader') ||
    document.getElementById('signature-editor') ||
    document.getElementById('uploader')
  );
}

function getOverlay(host: HTMLElement): HTMLElement {
  let overlay = host.querySelector<HTMLElement>(':scope > .shift-loader');
  if (overlay) return overlay;

  host.classList.add('shift-loader-host');
  overlay = document.createElement('div');
  overlay.className = 'shift-loader';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');

  const content = document.createElement('div');
  content.className = 'shift-loader-content';

  const spinner = document.createElement('span');
  spinner.className = 'shift-spinner';
  const parsed = new DOMParser().parseFromString(SPINNER_SVG, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg && svg.tagName.toLowerCase() === 'svg') {
    spinner.append(document.importNode(svg, true));
  }

  const text = document.createElement('p');
  text.className = 'shift-loader-text';

  const progress = document.createElement('div');
  progress.className = 'shift-loader-progress hidden';
  const track = document.createElement('div');
  track.className = 'shift-loader-progress-track';
  const bar = document.createElement('div');
  bar.className = 'shift-loader-progress-bar';
  bar.style.width = '0%';
  track.append(bar);
  const progressText = document.createElement('p');
  progressText.className = 'shift-loader-progress-text';
  progressText.textContent = '0%';
  progress.append(track, progressText);

  content.append(spinner, text, progress);
  overlay.append(content);
  host.appendChild(overlay);
  return overlay;
}

function hideLegacyModal(): void {
  document.getElementById('loader-modal')?.classList.add('hidden');
}

function clearRevealTimer(): void {
  if (revealTimer !== null) {
    window.clearTimeout(revealTimer);
    revealTimer = null;
  }
}

export function showLoader(
  text = 'Loading...',
  progress?: number,
  options: ShowLoaderOptions = {}
): void {
  hideLegacyModal();
  const host = resolveHost(options.host);
  if (!host) return;

  if (activeHost && activeHost !== host) {
    hideLoader();
  }
  activeHost = host;

  const overlay = getOverlay(host);
  const textEl = overlay.querySelector<HTMLElement>('.shift-loader-text');
  if (textEl) textEl.textContent = text;

  const progressWrap = overlay.querySelector<HTMLElement>(
    '.shift-loader-progress'
  );
  const progressBar = overlay.querySelector<HTMLElement>(
    '.shift-loader-progress-bar'
  );
  const progressText = overlay.querySelector<HTMLElement>(
    '.shift-loader-progress-text'
  );
  if (progress !== undefined && progress >= 0) {
    progressWrap?.classList.remove('hidden');
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (progressText) progressText.textContent = `${Math.round(progress)}%`;
  } else {
    progressWrap?.classList.add('hidden');
  }

  host.setAttribute('aria-busy', 'true');
  overlay.classList.add('is-active');

  if (!overlay.classList.contains('is-visible') && revealTimer === null) {
    revealTimer = window.setTimeout(() => {
      revealTimer = null;
      overlay.classList.add('is-visible');
    }, SHIFT_LOADER_DELAY_MS);
  }
}

export function hideLoader(): void {
  clearRevealTimer();
  hideLegacyModal();

  const host = activeHost ?? resolveHost();
  const overlay = host?.querySelector<HTMLElement>(':scope > .shift-loader');
  overlay?.classList.remove('is-visible', 'is-active');
  host?.removeAttribute('aria-busy');
  activeHost = null;
}

export function resetShiftLoaderForTests(): void {
  clearRevealTimer();
  activeHost = null;
}
