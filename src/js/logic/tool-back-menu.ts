/**
 * The second half of the back control on a tool page.
 *
 * The button itself retraces the visitor's own steps, which is what a control
 * labelled "Back" should do — but it means there is no longer a one-click way
 * to reach the whole catalog from a tool you arrived at from another tool. That
 * destination moves into a small menu on a caret beside the button, and the
 * same menu answers a right-click or a long-press on the button, so the habit
 * of right-clicking a back control finds something useful.
 *
 * The markup is built here rather than in the 117 pages: tool-back.ts has
 * already tagged the control it upgraded with `.shift-tool-back`, so that class
 * is both the anchor and the signal that this page is a tool page.
 */

import { getCatalogHref } from './tool-back.js';

const UPGRADED_CONTROL_SELECTOR = 'button.shift-tool-back, a.shift-tool-back';

/** Long enough not to fire on a normal tap, short enough to feel deliberate. */
const LONG_PRESS_MS = 500;

/** A drift this small is still a press rather than the start of a scroll. */
const LONG_PRESS_SLOP_PX = 10;

/** How long the click that ends a long press is still expected to arrive. */
const LONG_PRESS_CLICK_WINDOW_MS = 800;

const CARET_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="m6 9 6 6 6-6"/></svg>`;

const GRID_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4.75 6.75a2 2 0 0 1 2-2h2.5a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-2.5a2 2 0 0 1-2-2zM12.75 6.75a2 2 0 0 1 2-2h2.5a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-2.5a2 2 0 0 1-2-2zM4.75 14.75a2 2 0 0 1 2-2h2.5a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-2.5a2 2 0 0 1-2-2zM12.75 14.75a2 2 0 0 1 2-2h2.5a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-2.5a2 2 0 0 1-2-2z"/></svg>`;

let openMenu: HTMLElement | null = null;
let suppressNextClick = false;

export function initToolBackMenu(): void {
  suppressClickAfterLongPress();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildBackMenus, {
      once: true,
    });
    return;
  }

  buildBackMenus();
}

function buildBackMenus(): void {
  document
    .querySelectorAll<HTMLElement>(UPGRADED_CONTROL_SELECTOR)
    .forEach(buildBackMenu);
}

function buildBackMenu(control: HTMLElement): void {
  const parent = control.parentNode;
  if (!parent || control.closest('.shift-tool-back-group')) return;

  const group = document.createElement('div');
  group.className = 'shift-tool-back-group';
  // The shared header owns its own padding. Only legacy/fallback placements
  // inherit the page-authored space that used to separate Back from its title.
  const spacing = control.closest('.shift-tool-header')
    ? '0px'
    : getComputedStyle(control).marginBottom;
  parent.insertBefore(group, control);
  group.append(control, createCaret(), createMenu());
  adoptSpacing(group, control, spacing);

  const caret = group.querySelector<HTMLButtonElement>('.shift-tool-back-more');
  const menu = group.querySelector<HTMLElement>('.shift-tool-back-menu');
  if (!caret || !menu) return;

  caret.addEventListener('click', () => {
    if (menu.hidden) show(menu, caret);
    else hide(menu);
  });

  caret.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    show(menu, caret);
    menu.querySelector<HTMLElement>('.shift-tool-back-menu-item')?.focus();
  });

  // A right-click on a back control is a browser habit worth answering, and the
  // native menu's own Back entry does the same thing the button already does.
  control.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    show(menu, caret);
  });

  addLongPress(control, () => show(menu, caret));

  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    hide(menu);
    caret.focus();
  });
}

/**
 * 114 of the tool pages hang their own bottom margin on the button (`mb-6`), to
 * separate the control from the heading under it. Left on the button that
 * margin lands *inside* the wrapper, so the group's box runs 24px past the two
 * halves — a dead band that made the control read as a tall slab, and that any
 * height-matching between the halves would have to work around. Moved to the
 * wrapper it does the same job to the same page, and the group is exactly as
 * tall as the control.
 *
 * The value is copied rather than assumed so the pages that give the control no
 * margin at all — the pdf-workflow toolbar, the pdf-multi-tool nav bar — do not
 * acquire one.
 */
function adoptSpacing(
  group: HTMLElement,
  control: HTMLElement,
  marginBottom: string
): void {
  const pixels = Number.parseFloat(marginBottom);
  if (!Number.isFinite(pixels) || pixels <= 0) return;

  group.style.marginBottom = marginBottom;
  control.style.marginBottom = '0px';
}

function createCaret(): HTMLButtonElement {
  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'shift-tool-back-more';
  caret.setAttribute('aria-haspopup', 'menu');
  caret.setAttribute('aria-expanded', 'false');
  caret.title = 'More ways back';
  caret.setAttribute('data-i18n-title', 'tools.backOptions');
  // The name lives in a hidden span rather than aria-label because that is what
  // the shared translation pass can reach.
  caret.innerHTML = `${CARET_ICON}<span class="sr-only" data-i18n="tools.backOptions">More ways back</span>`;
  return caret;
}

function createMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'shift-tool-back-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = `<a class="shift-tool-back-menu-item" role="menuitem" href="${escapeAttribute(getCatalogHref())}">${GRID_ICON}<span data-i18n="nav.allTools">All Tools</span></a>`;
  return menu;
}

function show(menu: HTMLElement, caret: HTMLElement): void {
  if (openMenu && openMenu !== menu) hide(openMenu);

  menu.hidden = false;
  caret.setAttribute('aria-expanded', 'true');
  openMenu = menu;
}

function hide(menu: HTMLElement): void {
  menu.hidden = true;
  menu
    .closest('.shift-tool-back-group')
    ?.querySelector('.shift-tool-back-more')
    ?.setAttribute('aria-expanded', 'false');
  if (openMenu === menu) openMenu = null;
}

let dismissalBound = false;

function bindDismissal(): void {
  if (dismissalBound) return;
  dismissalBound = true;

  document.addEventListener('pointerdown', (event) => {
    if (!openMenu) return;

    const target = event.target;
    const group = openMenu.closest('.shift-tool-back-group');
    if (target instanceof Node && group?.contains(target)) return;

    hide(openMenu);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !openMenu) return;

    const caret = openMenu
      .closest('.shift-tool-back-group')
      ?.querySelector<HTMLElement>('.shift-tool-back-more');
    hide(openMenu);
    caret?.focus();
  });
}

/**
 * A long press ends in a click, and the click would go back — which is the one
 * thing someone who just held the button did not ask for. Capturing on window
 * runs before the shared back handler, which captures on document.
 */
function suppressClickAfterLongPress(): void {
  bindDismissal();

  window.addEventListener(
    'click',
    (event) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );
}

function addLongPress(control: HTMLElement, onLongPress: () => void): void {
  let timer: number | undefined;
  let startX = 0;
  let startY = 0;

  const cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };

  control.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      if (!touch) return;

      startX = touch.clientX;
      startY = touch.clientY;
      timer = window.setTimeout(() => {
        suppressNextClick = true;
        // Android sometimes swallows the click after a long press, and a flag
        // left standing would eat an unrelated one later.
        window.setTimeout(() => {
          suppressNextClick = false;
        }, LONG_PRESS_CLICK_WINDOW_MS);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );

  control.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (!touch || !timer) return;

      const moved =
        Math.abs(touch.clientX - startX) > LONG_PRESS_SLOP_PX ||
        Math.abs(touch.clientY - startY) > LONG_PRESS_SLOP_PX;
      if (moved) cancel();
    },
    { passive: true }
  );

  control.addEventListener('touchend', cancel);
  control.addEventListener('touchcancel', cancel);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
