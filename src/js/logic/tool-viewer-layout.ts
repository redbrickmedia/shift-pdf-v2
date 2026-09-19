import { isHomeDocument } from './seed-tool-open-file.js';
import { WORKSPACE_FILES_RENDERED_EVENT } from './workspace-files.js';

/**
 * Tools that mount an in-page PDF viewer (pdf.js iframe, embedpdf, cropper,
 * compare). Thumbnail grids and convert hubs are out of scope.
 */
export const VIEWER_ROOT_IDS = [
  'embed-pdf-wrapper',
  'signature-editor',
  'form-filler-options',
  'cropper-editor',
  'compare-viewer',
  'viewer-card',
] as const;

/** Process / download controls that belong in the tool header while viewing. */
export const VIEWER_DOWNLOAD_BUTTON_IDS = [
  'download-edited-pdf',
  'process-btn',
  'crop-button',
  'save-stamped-btn',
] as const;

/** Drop zone / file-chip nodes that must leave the layout while viewing. */
export const VIEWER_UPLOAD_CHROME_IDS = [
  'drop-zone',
  'drop-zone-1',
  'drop-zone-2',
  'file-display-area',
  'file-list',
] as const;

/**
 * Page-authored hosts that used to be their own scrollports (overflow-auto /
 * fixed vh). While viewing they must clip only — the PDF.js iframe (or
 * embedpdf / cropper / compare panel) owns the single vertical scroll.
 */
export const VIEWER_SCROLL_HOST_IDS = [
  'canvas-container-sign',
  'pdf-viewer-container',
  'embed-pdf-container',
  'cropper-container',
  'compare-viewer-wrapper',
  'stamp-viewer-container',
] as const;

/**
 * Viewers that need a file in more than one slot, so a single selection cannot
 * bring them up.
 */
export const MULTI_FILE_VIEWER_ROOT_IDS = ['compare-viewer'];

/**
 * Viewer roots that mount from a single seeded file.
 *
 * sidebar-boot.js paints the viewer layout for these from the session flag,
 * before the blob resolves, so a tool entered with a file selected opens in the
 * viewer rather than showing its card for a few hundred milliseconds first.
 *
 * These ids are duplicated in public/sidebar-boot.js, which is a classic script
 * and cannot import this module. tool-viewer-layout.test.ts asserts parity.
 */
export const PENDING_VIEWER_ROOT_IDS = VIEWER_ROOT_IDS.filter(
  (id) => !MULTI_FILE_VIEWER_ROOT_IDS.includes(id)
);

export const TOOL_VIEWER_BODY_CLASS = 'shift-tool-viewer';
export const TOOL_VIEWER_PENDING_CLASS = 'shift-tool-viewer-pending';
export const TOOL_VIEWER_CAPABLE_CLASS = 'shift-tool-viewer-capable';
export const TOOL_VIEWER_BAR_CLASS = 'shift-tool-viewer-bar';
export const TOOL_VIEWER_TITLE_CLASS = 'shift-tool-viewer-title';
export const TOOL_VIEWER_SUPPRESS_CLASS = 'shift-tool-viewer-suppressed';
export const TOOL_VIEWER_SCROLL_HOST_CLASS = 'shift-viewer-scroll-host';
export const TOOL_VIEWER_ACTIONS_ATTR = 'data-shift-viewer-actions';
/** Marks where a relocated action button came from, so it can go back. */
export const TOOL_VIEWER_SLOT_ATTR = 'data-shift-viewer-slot';
/** Body class sidebar-boot.js sets alongside the open-file classes. */
const OPEN_FILE_IN_TOOL_CLASS = 'shift-open-file-in-tool';

/**
 * How long the reserved pane waits for a viewer. Loading a large PDF, or a
 * password prompt, can outlast this; falling back to the tool's own card is the
 * safe end state, and the viewer still takes over when it arrives.
 */
const PENDING_VIEWER_TIMEOUT_MS = 8000;

let boundRoot: Document | null = null;
let observer: MutationObserver | null = null;
let listenerAbort: AbortController | null = null;
/**
 * The reserved pane is a startup state only. Once the viewer has been seen —
 * or the backstop has given up on it — a hidden viewer root means the tool is
 * back to its picker, which has to stay reachable.
 */
let pendingResolved = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export function isViewerToolDocument(root: Document = document): boolean {
  if (isHomeDocument(root)) return false;
  return VIEWER_ROOT_IDS.some((id) => root.getElementById(id));
}

export function isViewerActive(root: Document = document): boolean {
  return VIEWER_ROOT_IDS.some((id) => {
    const el = root.getElementById(id);
    return el instanceof HTMLElement && isRevealed(el);
  });
}

/**
 * A viewer is on its way: the shell has an open file for this tool and the tool
 * mounts its viewer from that one file. True only until the viewer shows up or
 * the backstop fires, so a tool the user has emptied still gets its picker.
 */
export function isViewerPending(root: Document = document): boolean {
  if (pendingResolved) return false;
  if (!root.body.classList.contains(OPEN_FILE_IN_TOOL_CLASS)) return false;
  return PENDING_VIEWER_ROOT_IDS.some((id) => root.getElementById(id));
}

/**
 * Put the viewer in the tool card, so every viewer tool reads as one panel:
 * heading row and document inside the same surface.
 *
 * Four of the six author it that way already. sign-pdf and crop-pdf leave
 * theirs as a sibling of `#tool-uploader`, which left the card collapsed to its
 * heading with the document on the page background beneath it.
 *
 * Timing is the whole constraint: these viewers host a PDF.js iframe, and
 * reparenting an iframe discards its browsing context and reloads the document.
 * So this only ever moves a root the tool has not mounted yet — before paint
 * from sidebar-boot.js, and on init here for documents it does not run in.
 */
export function adoptViewerIntoCard(root: Document = document): void {
  const card = root.getElementById('tool-uploader');
  if (!card) return;

  for (const id of VIEWER_ROOT_IDS) {
    const viewer = root.getElementById(id);
    if (!(viewer instanceof HTMLElement)) continue;
    if (card.contains(viewer)) continue;
    // Revealed, or already holding a frame, means the tool has mounted: leave
    // it where it is rather than reload the document inside it.
    if (isRevealed(viewer) || viewer.querySelector('iframe')) continue;
    card.append(viewer);
  }
}

export function ensureToolCardHeader(
  root: Document = document
): HTMLElement | null {
  return ensureViewerChrome(root);
}

/**
 * Full-panel viewer layout for PDF viewer tools: hide the drop zone once a
 * file is showing, fill the content panel with the viewer, and park Download
 * in the tool heading row.
 */
export function initToolViewerLayout(root: Document = document): void {
  if (!isViewerToolDocument(root)) return;

  if (boundRoot === root && observer) {
    syncToolViewerLayout(root);
    return;
  }

  resetToolViewerLayout();
  boundRoot = root;
  listenerAbort = new AbortController();
  const { signal } = listenerAbort;

  root.body.classList.add(TOOL_VIEWER_CAPABLE_CLASS);
  adoptViewerIntoCard(root);
  ensureViewerChrome(root);

  observer = new MutationObserver(() => {
    observer?.disconnect();
    try {
      syncToolViewerLayout(root);
    } finally {
      observer?.takeRecords();
      observeToolViewerLayout(root);
    }
  });
  observeToolViewerLayout(root);

  root.addEventListener(
    WORKSPACE_FILES_RENDERED_EVENT,
    () => {
      syncToolViewerLayout(root);
    },
    { signal }
  );

  if (isViewerPending(root)) {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      pendingResolved = true;
      syncToolViewerLayout(root);
    }, PENDING_VIEWER_TIMEOUT_MS);
  }

  syncToolViewerLayout(root);
}

function observeToolViewerLayout(root: Document): void {
  observer?.observe(root.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });
}

function resolvePendingViewer(): void {
  pendingResolved = true;
  if (pendingTimer === null) return;
  clearTimeout(pendingTimer);
  pendingTimer = null;
}

export function syncToolViewerLayout(root: Document = document): void {
  if (!isViewerToolDocument(root)) {
    root.body.classList.remove(
      TOOL_VIEWER_BODY_CLASS,
      TOOL_VIEWER_PENDING_CLASS
    );
    suppressUploadChrome(root, false);
    markViewerScrollHosts(root, false);
    return;
  }

  ensureViewerChrome(root);
  const active = isViewerActive(root);
  if (active) resolvePendingViewer();
  const pending = !active && isViewerPending(root);
  const viewing = active || pending;

  root.body.classList.toggle(TOOL_VIEWER_BODY_CLASS, viewing);
  root.body.classList.toggle(TOOL_VIEWER_PENDING_CLASS, pending);
  suppressUploadChrome(root, viewing);
  markViewerScrollHosts(root, viewing);

  if (viewing) {
    relocateDownloadButtons(root);
    return;
  }

  // The reserved pane came and went without a viewer — the session flag named a
  // file the seed could not produce. Put the tool's own actions back.
  restoreDownloadButtons(root);
}

export function resetToolViewerLayout(): void {
  observer?.disconnect();
  observer = null;
  listenerAbort?.abort();
  listenerAbort = null;
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = null;
  pendingResolved = false;
  if (boundRoot) {
    boundRoot.body.classList.remove(
      TOOL_VIEWER_BODY_CLASS,
      TOOL_VIEWER_PENDING_CLASS,
      TOOL_VIEWER_CAPABLE_CLASS
    );
    suppressUploadChrome(boundRoot, false);
    markViewerScrollHosts(boundRoot, false);
  }
  boundRoot = null;
}

function isRevealed(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return false;
  // Skeleton placeholders keep `.hidden` while CSS forces a pulse slot
  // (`body.shift-open-file-in-tool #…-editor.hidden { display: block }`).
  // Treat class `hidden` as not revealed so upload chrome stays until the
  // page actually removes it.
  if (el.classList.contains('hidden')) return false;
  const inline = el.getAttribute('style');
  if (inline && /\bdisplay\s*:\s*none\b/i.test(inline)) return false;
  return true;
}

/**
 * Mark drop zone + file chips so CSS (and tests) can observe that upload
 * chrome is gone once a viewer is showing. Cleared when the viewer hides.
 */
function suppressUploadChrome(root: Document, active: boolean): void {
  for (const id of VIEWER_UPLOAD_CHROME_IDS) {
    const el = root.getElementById(id);
    if (!(el instanceof HTMLElement)) continue;
    el.classList.toggle(TOOL_VIEWER_SUPPRESS_CLASS, active);
  }
}

/**
 * Mark the outer viewer hosts so scoped CSS can kill page-authored
 * `overflow-auto` / fixed-vh scrollers without editing every tool HTML file.
 * Cleared when the viewer hides so empty-state layouts stay untouched.
 */
function markViewerScrollHosts(root: Document, active: boolean): void {
  for (const id of VIEWER_SCROLL_HOST_IDS) {
    const el = root.getElementById(id);
    if (!(el instanceof HTMLElement)) continue;
    el.classList.toggle(TOOL_VIEWER_SCROLL_HOST_CLASS, active);
  }
}

function ensureViewerChrome(root: Document): HTMLElement | null {
  const toolUploader = root.getElementById('tool-uploader');
  if (!toolUploader) return null;

  const existing =
    toolUploader.parentElement?.querySelector<HTMLElement>(
      `:scope > .${TOOL_VIEWER_BAR_CLASS}`
    ) ?? toolUploader.querySelector<HTMLElement>(`.${TOOL_VIEWER_BAR_CLASS}`);
  if (existing) {
    placeToolCardHeader(existing, toolUploader);
    return existing.querySelector<HTMLElement>(`[${TOOL_VIEWER_ACTIONS_ATTR}]`);
  }

  const heading = toolUploader.querySelector('h1');
  if (!heading) return null;

  const bar = root.createElement('div');
  bar.className = TOOL_VIEWER_BAR_CLASS;

  const title = root.createElement('div');
  title.className = TOOL_VIEWER_TITLE_CLASS;

  const subtitle =
    heading.nextElementSibling instanceof HTMLParagraphElement
      ? heading.nextElementSibling
      : null;

  title.append(heading);
  if (subtitle) title.append(subtitle);

  const actions = root.createElement('div');
  actions.className = 'shift-tool-viewer-actions';
  actions.setAttribute(TOOL_VIEWER_ACTIONS_ATTR, '');

  bar.append(title, actions);
  placeToolCardHeader(bar, toolUploader);
  return actions;
}

/** Title + Reset/Save sit on the page, not inside the gray tool card. */
function placeToolCardHeader(bar: HTMLElement, card: HTMLElement): void {
  const host = card.parentElement;
  if (host && bar.parentElement !== host) {
    host.insertBefore(bar, card);
  }
  for (const cls of card.classList) {
    if (cls === 'w-full' || cls.startsWith('max-w-')) {
      bar.classList.add(cls);
    }
  }
}

function relocateDownloadButtons(root: Document): void {
  const actions = root.querySelector<HTMLElement>(
    `[${TOOL_VIEWER_ACTIONS_ATTR}]`
  );
  if (!actions) return;

  for (const id of VIEWER_DOWNLOAD_BUTTON_IDS) {
    const button = root.getElementById(id);
    if (!(button instanceof HTMLElement)) continue;
    if (button.closest(`[${TOOL_VIEWER_ACTIONS_ATTR}]`) === actions) continue;
    leaveViewerSlot(root, button, id);
    actions.append(button);
  }
}

/**
 * Leave a marker where the page authored the button. The header is the right
 * place for it while a viewer fills the panel, but `.shift-tool-viewer-actions`
 * is `display: none` outside that layout, so a button left there after a
 * fallback would simply vanish from the card.
 */
function leaveViewerSlot(
  root: Document,
  button: HTMLElement,
  id: string
): void {
  const parent = button.parentElement;
  if (!parent) return;
  if (root.querySelector(`[${TOOL_VIEWER_SLOT_ATTR}="${id}"]`)) return;

  const slot = root.createElement('span');
  slot.setAttribute(TOOL_VIEWER_SLOT_ATTR, id);
  slot.hidden = true;
  parent.insertBefore(slot, button);
}

function restoreDownloadButtons(root: Document): void {
  for (const id of VIEWER_DOWNLOAD_BUTTON_IDS) {
    const slot = root.querySelector(`[${TOOL_VIEWER_SLOT_ATTR}="${id}"]`);
    if (!slot) continue;
    const button = root.getElementById(id);
    if (!(button instanceof HTMLElement)) {
      slot.remove();
      continue;
    }
    slot.replaceWith(button);
  }
}
