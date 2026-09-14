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

export const TOOL_VIEWER_BODY_CLASS = 'shift-tool-viewer';
export const TOOL_VIEWER_CAPABLE_CLASS = 'shift-tool-viewer-capable';
export const TOOL_VIEWER_BAR_CLASS = 'shift-tool-viewer-bar';
export const TOOL_VIEWER_TITLE_CLASS = 'shift-tool-viewer-title';
export const TOOL_VIEWER_SUPPRESS_CLASS = 'shift-tool-viewer-suppressed';
export const TOOL_VIEWER_SCROLL_HOST_CLASS = 'shift-viewer-scroll-host';
export const TOOL_VIEWER_ACTIONS_ATTR = 'data-shift-viewer-actions';

let boundRoot: Document | null = null;
let observer: MutationObserver | null = null;
let listenerAbort: AbortController | null = null;

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
  ensureViewerChrome(root);

  observer = new MutationObserver(() => {
    syncToolViewerLayout(root);
  });
  observer.observe(root.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });

  root.addEventListener(
    WORKSPACE_FILES_RENDERED_EVENT,
    () => {
      syncToolViewerLayout(root);
    },
    { signal }
  );

  syncToolViewerLayout(root);
}

export function syncToolViewerLayout(root: Document = document): void {
  if (!isViewerToolDocument(root)) {
    root.body.classList.remove(TOOL_VIEWER_BODY_CLASS);
    suppressUploadChrome(root, false);
    markViewerScrollHosts(root, false);
    return;
  }

  ensureViewerChrome(root);
  const active = isViewerActive(root);
  root.body.classList.toggle(TOOL_VIEWER_BODY_CLASS, active);
  suppressUploadChrome(root, active);
  markViewerScrollHosts(root, active);

  if (active) {
    relocateDownloadButtons(root);
  }
}

export function resetToolViewerLayout(): void {
  observer?.disconnect();
  observer = null;
  listenerAbort?.abort();
  listenerAbort = null;
  if (boundRoot) {
    boundRoot.body.classList.remove(
      TOOL_VIEWER_BODY_CLASS,
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

  const existing = toolUploader.querySelector<HTMLElement>(
    `.${TOOL_VIEWER_BAR_CLASS}`
  );
  if (existing) {
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

  heading.replaceWith(bar);
  title.append(heading);
  if (subtitle) title.append(subtitle);

  const actions = root.createElement('div');
  actions.className = 'shift-tool-viewer-actions';
  actions.setAttribute(TOOL_VIEWER_ACTIONS_ATTR, '');

  bar.append(title, actions);
  return actions;
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
    actions.append(button);
  }
}
