/**
 * One file preview frame. Callers keep their own canvas renderer; this
 * owns the chrome: size variant, radius, border, empty fallback, and
 * selected / viewing state.
 *
 * `rail` is the sidebar slot. `card` is the library and page thumbnail.
 * `modal` is the enlarged page preview. Radius, border, and state are shared.
 */

export const SHIFT_FILE_PREVIEW_CLASS = 'shift-file-preview';
export const SHIFT_FILE_PREVIEW_CANVAS_CLASS = 'shift-file-preview-canvas';
export const SHIFT_FILE_PREVIEW_FALLBACK_CLASS = 'shift-file-preview-fallback';

export type ShiftFilePreviewSize = 'rail' | 'card' | 'modal';

export interface ShiftFilePreviewOptions {
  size?: ShiftFilePreviewSize;
  empty?: boolean;
  selected?: boolean;
  viewing?: boolean;
  canvas?: HTMLCanvasElement;
  fallback?: Element | null;
}

export function createShiftFilePreview(
  doc: Document,
  options: ShiftFilePreviewOptions = {}
): HTMLElement {
  const size = options.size ?? 'rail';
  const frame = doc.createElement(size === 'rail' ? 'span' : 'div');
  frame.className = SHIFT_FILE_PREVIEW_CLASS;
  frame.dataset.shiftPreviewSize = size;
  frame.setAttribute('aria-hidden', 'true');

  if (size === 'rail') {
    frame.classList.add('shift-nav-icon', 'shift-open-file-preview');
  }
  if (size === 'card') {
    frame.classList.add('shift-open-file-thumb-preview');
  }

  const empty = options.empty !== false;
  frame.classList.toggle('is-empty', empty);
  frame.classList.toggle('is-selected', Boolean(options.selected));
  frame.classList.toggle('is-viewing', Boolean(options.viewing));

  const canvas = options.canvas ?? doc.createElement('canvas');
  canvas.classList.add(SHIFT_FILE_PREVIEW_CANVAS_CLASS);
  if (size === 'rail') canvas.classList.add('shift-open-file-preview-canvas');
  frame.append(canvas);

  if (options.fallback) {
    options.fallback.classList.add(
      SHIFT_FILE_PREVIEW_FALLBACK_CLASS,
      'shift-open-file-icon-fallback'
    );
    frame.append(options.fallback);
  }

  return frame;
}

export function setShiftFilePreviewState(
  preview: HTMLElement,
  state: { empty?: boolean; selected?: boolean; viewing?: boolean }
): void {
  if (state.empty !== undefined) {
    preview.classList.toggle('is-empty', state.empty);
  }
  if (state.selected !== undefined) {
    preview.classList.toggle('is-selected', state.selected);
  }
  if (state.viewing !== undefined) {
    preview.classList.toggle('is-viewing', state.viewing);
  }
}
