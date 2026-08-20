/**
 * Back navigation for the tool pages.
 *
 * Bento gave each of its 115 tool pages its own `#back-to-tools` handler that
 * hard-navigated to BASE_URL, so anyone who arrived from a category, a search
 * result or another tool was dropped at the top of the catalog instead of where
 * they had been. The behaviour lives here instead, and is applied from one
 * capture-phase listener: capture runs before the per-page handlers on the
 * button itself, so every page that already ships the control is corrected
 * without touching its markup.
 *
 * Precedence when the control is used:
 *   1. history.back(), when the previous document was this site
 *   2. the catalog page this tab last visited (keeps the category anchor)
 *   3. the shell's home link
 *
 * Going straight to the whole catalog is the secondary action, and lives in
 * tool-back-menu.ts.
 */

export const CATALOG_RETURN_STORAGE_KEY = 'shiftPdfCatalogReturnTo';

/**
 * Most Bento pages use the exact ID. Form Creator has one control per view,
 * with an ID suffix, while newer pages use the data attribute.
 */
export const BACK_CONTROL_SELECTOR = '[id^="back-to-tools"], [data-tool-back]';

const BACK_CONTROL_SLOT_SELECTOR = '[data-tool-back-slot]';

/**
 * A page is catalog context if it lists tools: `#tool-grid` is the homepage
 * container (filled in later by main.ts) and `.tool-card` covers the static
 * category hubs. No tool page carries either.
 */
const CATALOG_MARKER_SELECTOR = '#tool-grid, .tool-card';

const MAX_STORED_LENGTH = 2048;

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

export type BackTarget = { kind: 'history' } | { kind: 'href'; href: string };

export interface BackTargetContext {
  origin: string;
  currentHref: string;
  referrer: string;
  historyLength: number;
  catalogReturnHref: string | null;
  homeHref: string;
}

export function resolveBackTarget(context: BackTargetContext): BackTarget {
  if (
    context.historyLength > 1 &&
    isSameOriginStep(context.referrer, context.origin, context.currentHref)
  ) {
    return { kind: 'history' };
  }

  const { catalogReturnHref } = context;
  if (
    catalogReturnHref &&
    isSameOrigin(catalogReturnHref, context.origin) &&
    !isSamePage(catalogReturnHref, context.currentHref)
  ) {
    return { kind: 'href', href: catalogReturnHref };
  }

  return { kind: 'href', href: context.homeHref };
}

export function readCatalogReturnHref(
  storage: StorageReader | undefined = getSessionStorage()
): string | null {
  if (!storage) return null;

  try {
    const stored = storage.getItem(CATALOG_RETURN_STORAGE_KEY);
    return stored && stored.length <= MAX_STORED_LENGTH ? stored : null;
  } catch (error) {
    console.warn('Tool back navigation storage is unavailable.', error);
    return null;
  }
}

export function rememberCatalogReturnHref(
  href: string,
  storage: StorageWriter | undefined = getSessionStorage()
): boolean {
  if (!storage || href.length > MAX_STORED_LENGTH) return false;

  try {
    storage.setItem(CATALOG_RETURN_STORAGE_KEY, href);
    return true;
  } catch (error) {
    console.warn('Could not remember the last catalog page.', error);
    return false;
  }
}

/**
 * Installs the shared behaviour. Safe to call before the DOM is ready: the
 * listener goes on straight away so a click can never fall through to a
 * per-page handler, and the markup pass waits for the document.
 */
export function initToolBackNavigation(): void {
  interceptBackControlClicks();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prepareBackControls, {
      once: true,
    });
    return;
  }

  prepareBackControls();
}

let clicksIntercepted = false;

function interceptBackControlClicks(): void {
  if (clicksIntercepted) return;
  clicksIntercepted = true;

  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const control = target.closest(BACK_CONTROL_SELECTOR);
      if (!control) return;

      event.preventDefault();
      // The page's own handler is on the control itself, so stopping here in the
      // capture phase is what keeps it from also navigating to BASE_URL.
      event.stopImmediatePropagation();
      navigateBack();
    },
    true
  );
}

function prepareBackControls(): void {
  if (document.querySelector(CATALOG_MARKER_SELECTOR)) {
    rememberCurrentCatalogPage();
    // Category links only move the hash, so the anchor has to be re-read.
    window.addEventListener('hashchange', rememberCurrentCatalogPage);
    return;
  }

  const controls = Array.from(
    document.querySelectorAll<HTMLElement>(BACK_CONTROL_SELECTOR)
  );
  const slot = document.querySelector<HTMLElement>(BACK_CONTROL_SLOT_SELECTOR);

  if (slot && controls.length > 0) {
    const [control, ...duplicates] = controls;
    slot.append(control);
    duplicates.forEach((duplicate) => duplicate.remove());
    prepareBackControl(control);
    return;
  }

  // Keep the behavioural upgrade if an HTML transform is unavailable, such as
  // an isolated DOM fixture or a downstream embed that does not use Vite.
  controls.forEach(prepareBackControl);
}

function prepareBackControl(control: HTMLElement): void {
  control.classList.add('shift-tool-back');
  if (control instanceof HTMLButtonElement) {
    control.type = 'button';
  }
  if (!control.title) {
    control.title = 'Back to where you were';
  }
}

function rememberCurrentCatalogPage(): void {
  rememberCatalogReturnHref(window.location.href);
}

export function navigateBack(): void {
  const target = resolveBackTarget({
    origin: window.location.origin,
    currentHref: window.location.href,
    referrer: document.referrer,
    historyLength: window.history.length,
    catalogReturnHref: readCatalogReturnHref(),
    homeHref: getCatalogHref(),
  });

  if (target.kind === 'history') {
    window.history.back();
    return;
  }

  window.location.assign(target.href);
}

/**
 * The full catalog: this control's last-resort destination, and the one entry
 * in the menu tool-back-menu.ts hangs off the control.
 *
 * Read from the rail rather than rebuilt from BASE_URL, so it follows whatever
 * the shell links home to — including the language prefix that rewriteLinks()
 * adds on the translated builds.
 */
export function getCatalogHref(): string {
  const homeLink = document.querySelector<HTMLAnchorElement>(
    '.shift-nav-link[data-nav="home"]'
  );
  return homeLink?.href || import.meta.env.BASE_URL;
}

function isSameOriginStep(
  referrer: string,
  origin: string,
  currentHref: string
): boolean {
  // A cross-origin referrer means going back would leave the site (a search
  // engine, a chat app); an empty one means a direct load or a new tab.
  if (!isSameOrigin(referrer, origin)) return false;

  // A referrer that is this page is a reload or a same-page post, where going
  // back would only land on the tool again.
  return !isSamePage(referrer, currentHref);
}

function isSameOrigin(href: string, origin: string): boolean {
  return parseUrl(href)?.origin === origin;
}

function isSamePage(href: string, otherHref: string): boolean {
  const url = parseUrl(href);
  const otherUrl = parseUrl(otherHref);
  if (!url || !otherUrl) return href === otherHref;

  url.hash = '';
  otherUrl.hash = '';
  return url.href === otherUrl.href;
}

function parseUrl(href: string): URL | null {
  if (!href) return null;

  try {
    return new URL(href);
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.sessionStorage;
  } catch (error) {
    console.warn('Tool back navigation storage is unavailable.', error);
    return undefined;
  }
}
