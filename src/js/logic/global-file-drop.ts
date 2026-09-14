import { applyFilesToInput } from './seed-tool-open-file.js';
import { findToolFileInput } from './tool-file-seed.js';
import { getActiveFileInput } from './workspace-files.js';

export const GLOBAL_DROP_ACTIVE_CLASS = 'shift-global-drop-active';
export const GLOBAL_DROP_AFFORDANCE_ID = 'shift-global-drop-affordance';

/**
 * Local upload / chrome regions that already own drop handling. Global drop
 * must not steal events here (double-add, wrong slot, or modal interference).
 */
export const GLOBAL_DROP_EXCLUDED_SELECTORS = [
  '#shift-sidebar',
  '#drop-zone',
  '#drop-zone-1',
  '#drop-zone-2',
  '#dropZone',
  '#upload-area',
  '#base-drop-zone',
  '#overlay-drop-zone',
  '#cert-drop-zone',
  '#attachment-drop-zone',
  '#shift-pdf-library-picker',
  '#alert-modal',
  '[role="dialog"]',
  '[aria-modal="true"]',
  'dialog',
  'iframe',
  '#canvas-container-sign',
  '#pdf-viewer-container',
  '#embed-pdf-container',
  '#stamp-viewer-container',
  '#compare-viewer',
  '#compare-viewer-wrapper',
  '#cropper-container',
  '#signature-editor',
  '#form-filler-options',
  '#embed-pdf-wrapper',
  '#viewer-card',
  '[data-shift-no-global-drop]',
].join(', ');

let boundRoot: Document | null = null;
let listenerAbort: AbortController | null = null;
let dragDepth = 0;

/**
 * Whole-page file drop: when a PDF (or other accept-matching file) is dragged
 * over an eligible tool/home page outside local drop zones, route it through
 * the page's existing file input `change` flow.
 */
export function initGlobalFileDrop(root: Document = document): void {
  if (boundRoot === root && listenerAbort) return;

  resetGlobalFileDrop();
  boundRoot = root;
  listenerAbort = new AbortController();
  const { signal } = listenerAbort;

  ensureAffordance(root);

  root.addEventListener('dragenter', (event) => onDragEnter(event, root), {
    signal,
    capture: true,
  });
  root.addEventListener('dragover', (event) => onDragOver(event, root), {
    signal,
    capture: true,
  });
  root.addEventListener('dragleave', (event) => onDragLeave(event, root), {
    signal,
    capture: true,
  });
  root.addEventListener('drop', (event) => onDrop(event, root), {
    signal,
    capture: true,
  });
  root.addEventListener('dragend', () => clearDragUi(root), { signal });
  root.defaultView?.addEventListener('blur', () => clearDragUi(root), {
    signal,
  });
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') clearDragUi(root);
    },
    { signal }
  );
}

export function resetGlobalFileDrop(): void {
  listenerAbort?.abort();
  listenerAbort = null;
  dragDepth = 0;
  if (boundRoot) {
    boundRoot.body.classList.remove(GLOBAL_DROP_ACTIVE_CLASS);
    const affordance = boundRoot.getElementById(GLOBAL_DROP_AFFORDANCE_ID);
    if (affordance) {
      affordance.hidden = true;
      affordance.textContent = '';
    }
  }
  boundRoot = null;
}

export function isGlobalDropPageEligible(root: Document = document): boolean {
  // Dual-slot tools: dropping on the page background cannot pick the right
  // input without guessing.
  if (
    root.getElementById('drop-zone-1') &&
    root.getElementById('drop-zone-2')
  ) {
    return false;
  }
  if (
    root.getElementById('base-drop-zone') &&
    root.getElementById('overlay-drop-zone')
  ) {
    return false;
  }

  return Boolean(resolvePrimaryFileInput(root));
}

export function isGlobalDropExcludedTarget(
  target: EventTarget | null,
  root: Document = document
): boolean {
  if (!(target instanceof Element)) return false;
  if (!root.contains(target)) return false;
  return Boolean(target.closest(GLOBAL_DROP_EXCLUDED_SELECTORS));
}

export function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  // Internal UI drags (text, links, thumbnail reorder) omit Files.
  return types.includes('Files');
}

export function resolvePrimaryFileInput(
  root: Document = document
): HTMLInputElement | null {
  return getActiveFileInput(root) ?? findToolFileInput(root);
}

function onDragEnter(event: DragEvent, root: Document): void {
  if (!isExternalFileDrag(event.dataTransfer)) return;
  if (!isGlobalDropPageEligible(root)) return;

  dragDepth += 1;
  if (isGlobalDropExcludedTarget(event.target, root)) {
    // Keep depth balanced across nested enter/leave, but do not show the
    // whole-page affordance over local zones / dialogs / viewers.
    setDragUi(root, false);
    return;
  }

  event.preventDefault();
  setDragUi(root, true);
}

function onDragOver(event: DragEvent, root: Document): void {
  if (!isExternalFileDrag(event.dataTransfer)) return;
  if (!isGlobalDropPageEligible(root)) return;
  if (isGlobalDropExcludedTarget(event.target, root)) {
    setDragUi(root, false);
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  setDragUi(root, true);
}

function onDragLeave(event: DragEvent, root: Document): void {
  if (!isExternalFileDrag(event.dataTransfer)) return;
  if (!isGlobalDropPageEligible(root)) return;

  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    setDragUi(root, false);
  }
}

function onDrop(event: DragEvent, root: Document): void {
  clearDragUi(root);

  if (!isExternalFileDrag(event.dataTransfer)) return;
  if (!isGlobalDropPageEligible(root)) return;
  if (isGlobalDropExcludedTarget(event.target, root)) {
    // Let the local drop-zone / dialog / viewer handler run.
    return;
  }

  const input = resolvePrimaryFileInput(root);
  if (!input) return;

  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;

  // Claim the drop before tool handlers see it, then reuse the input change
  // path so validation and state stay with the page.
  event.preventDefault();
  event.stopPropagation();
  applyFilesToInput(input, files);
}

function clearDragUi(root: Document): void {
  dragDepth = 0;
  setDragUi(root, false);
}

function setDragUi(root: Document, active: boolean): void {
  root.body.classList.toggle(GLOBAL_DROP_ACTIVE_CLASS, active);
  const affordance = ensureAffordance(root);
  affordance.hidden = !active;
  affordance.textContent = active ? 'Drop files to upload' : '';
}

function ensureAffordance(root: Document): HTMLElement {
  let affordance = root.getElementById(GLOBAL_DROP_AFFORDANCE_ID);
  if (affordance instanceof HTMLElement) return affordance;

  affordance = root.createElement('div');
  affordance.id = GLOBAL_DROP_AFFORDANCE_ID;
  affordance.className = 'shift-global-drop-affordance';
  affordance.setAttribute('role', 'status');
  affordance.setAttribute('aria-live', 'polite');
  affordance.hidden = true;
  root.body.appendChild(affordance);
  return affordance;
}
