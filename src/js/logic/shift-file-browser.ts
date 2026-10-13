/**
 * One file browser: a list or the library grid of shared previews, with
 * one empty state and one selection model. Home and My PDFs both render
 * through it. Information architecture stays with the caller.
 */

import { setShiftFilePreviewState } from './shift-file-preview.js';

export const SHIFT_FILE_BROWSER_CLASS = 'shift-file-browser';
export const SHIFT_FILE_BROWSER_ITEM_CLASS = 'shift-file-browser-item';
export const SHIFT_FILE_BROWSER_EMPTY_CLASS = 'shift-file-browser-empty';

export type ShiftFileBrowserView = 'list' | 'grid';

export function markShiftFileBrowser(
  host: HTMLElement,
  view: ShiftFileBrowserView
): void {
  host.classList.add(SHIFT_FILE_BROWSER_CLASS);
  host.dataset.shiftFileBrowser = view;
}

/** Selected and viewing live on the row and on every preview frame inside it. */
export function setShiftBrowserItemState(
  item: HTMLElement,
  state: { selected?: boolean; viewing?: boolean }
): void {
  item.classList.add(SHIFT_FILE_BROWSER_ITEM_CLASS);
  if (state.selected !== undefined) {
    item.classList.toggle('is-selected', state.selected);
  }
  if (state.viewing !== undefined) {
    item.classList.toggle('is-viewing', state.viewing);
  }
  item
    .querySelectorAll<HTMLElement>('.shift-file-preview')
    .forEach((preview) => {
      setShiftFilePreviewState(preview, state);
    });
}

export interface ShiftBrowserEmptyOptions {
  heading: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}

export function createShiftBrowserEmpty(
  doc: Document,
  options: ShiftBrowserEmptyOptions
): HTMLDivElement {
  const empty = doc.createElement('div');
  empty.className = `shift-my-pdfs-empty ${SHIFT_FILE_BROWSER_EMPTY_CLASS}`;

  const heading = doc.createElement('h3');
  heading.className = 'shift-library-picker-empty-heading';
  heading.textContent = options.heading;

  const message = doc.createElement('p');
  message.className = 'shift-library-picker-empty-message';
  message.textContent = options.message;

  const action = doc.createElement('button');
  action.type = 'button';
  action.className =
    'shift-button shift-button-secondary shift-library-picker-upload';
  action.textContent = options.actionLabel;
  action.addEventListener('click', (event) => {
    event.stopPropagation();
    options.onAction();
  });

  empty.append(heading, message, action);
  return empty;
}
