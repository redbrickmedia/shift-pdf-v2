import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PreviewState } from '@/types';
import { createShiftActionButton } from '../logic/shift-action-row.js';
import { createShiftFilePreview } from '../logic/shift-file-preview.js';

const state: PreviewState = {
  modal: null,
  pdfjsDoc: null,
  currentPage: 1,
  totalPages: 0,
  isOpen: false,
  container: null,
};

let previewOpener: HTMLElement | null = null;

function getOrCreateModal(): HTMLElement {
  if (state.modal) return state.modal;

  const modal = document.createElement('div');
  modal.id = 'page-preview-modal';
  modal.className = 'shift-page-preview';

  const dialog = document.createElement('div');
  dialog.className = 'shift-page-preview-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'preview-page-info');

  const toolbar = document.createElement('div');
  toolbar.className = 'shift-action-row';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Page preview');

  const prev = createShiftActionButton(document, {
    id: 'preview-prev',
    label: 'Previous page',
    iconClass: 'ph-caret-left',
    action: 'extra',
  });
  const next = createShiftActionButton(document, {
    id: 'preview-next',
    label: 'Next page',
    iconClass: 'ph-caret-right',
    action: 'extra',
  });
  const close = createShiftActionButton(document, {
    id: 'preview-close',
    label: 'Close',
    iconClass: 'ph-x',
    action: 'extra',
  });
  close.title = 'Close (Esc)';
  toolbar.append(prev, next, close);

  const frame = createShiftFilePreview(document, {
    size: 'modal',
    empty: true,
  });
  frame.id = 'preview-canvas-container';

  const pageInfo = document.createElement('p');
  pageInfo.id = 'preview-page-info';
  pageInfo.className = 'shift-page-preview-info';
  pageInfo.setAttribute('aria-live', 'polite');

  dialog.append(toolbar, frame, pageInfo);
  modal.append(dialog);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) hidePreview();
  });
  prev.addEventListener('click', () => navigatePage(-1));
  next.addEventListener('click', () => navigatePage(1));
  close.addEventListener('click', hidePreview);

  document.body.appendChild(modal);
  state.modal = modal;
  return modal;
}

function statusLine(text: string, isError = false): HTMLElement {
  const status = document.createElement('div');
  status.className = 'shift-page-preview-status';
  status.classList.toggle('is-error', isError);
  status.textContent = text;
  return status;
}

async function renderPreviewPage(pageNumber: number): Promise<void> {
  if (!state.pdfjsDoc) return;

  const modal = getOrCreateModal();
  const container = modal.querySelector(
    '#preview-canvas-container'
  ) as HTMLElement;
  const pageInfo = modal.querySelector('#preview-page-info') as HTMLElement;
  const prevBtn = modal.querySelector('#preview-prev') as HTMLElement;
  const nextBtn = modal.querySelector('#preview-next') as HTMLElement;

  container.classList.add('is-empty');
  container.replaceChildren(statusLine('Loading...'));

  pageInfo.textContent = `Page ${pageNumber} of ${state.totalPages}`;
  prevBtn.style.visibility = pageNumber > 1 ? 'visible' : 'hidden';
  nextBtn.style.visibility =
    pageNumber < state.totalPages ? 'visible' : 'hidden';

  try {
    const page = await state.pdfjsDoc.getPage(pageNumber);
    const scale = 2.0;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.className = 'shift-file-preview-canvas';

    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    container.classList.remove('is-empty');
    container.replaceChildren(canvas);
    state.currentPage = pageNumber;
  } catch (err) {
    console.error('Preview render error:', err);
    container.classList.add('is-empty');
    container.replaceChildren(statusLine('Failed to render page', true));
  }
}

function navigatePage(delta: number): void {
  const newPage = state.currentPage + delta;
  if (newPage >= 1 && newPage <= state.totalPages) {
    renderPreviewPage(newPage);
  }
}

export function showPreview(
  pdfjsDoc: PDFDocumentProxy,
  pageNumber: number,
  totalPages: number
): void {
  const opener = document.activeElement;
  const alreadyOpen = state.isOpen;
  state.pdfjsDoc = pdfjsDoc;
  state.totalPages = totalPages;
  state.isOpen = true;
  if (!alreadyOpen && opener instanceof HTMLElement) {
    previewOpener = opener;
  }

  const modal = getOrCreateModal();
  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  renderPreviewPage(pageNumber);
  modal.querySelector<HTMLButtonElement>('#preview-close')?.focus();
}

export function hidePreview(): void {
  if (!state.modal) return;
  state.isOpen = false;
  state.modal.classList.remove('is-open');
  document.body.style.overflow = '';
  const opener = previewOpener;
  previewOpener = null;
  if (opener?.isConnected) opener.focus();
}

function handleKeydown(e: KeyboardEvent): void {
  if (!state.isOpen) return;

  switch (e.key) {
    case 'Escape':
      hidePreview();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      navigatePage(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      navigatePage(1);
      break;
  }
}

document.addEventListener('keydown', handleKeydown);

export function initPagePreview(
  container: HTMLElement,
  pdfjsDoc: PDFDocumentProxy,
  _options: { pageAttr?: string } = {}
): void {
  const totalPages = pdfjsDoc.numPages;

  const thumbnails = container.querySelectorAll<HTMLElement>(
    '[data-page-number], [data-page-index], [data-pageIndex]'
  );

  thumbnails.forEach((thumb) => {
    if (thumb.dataset.previewInit) return;
    thumb.dataset.previewInit = 'true';

    let pageNum = 1;
    if (thumb.dataset.pageNumber) {
      pageNum = parseInt(thumb.dataset.pageNumber, 10);
    } else if (thumb.dataset.pageIndex !== undefined) {
      pageNum = parseInt(thumb.dataset.pageIndex, 10) + 1;
    }

    const icon = createShiftActionButton(document, {
      label: 'Preview',
      iconClass: 'ph-magnifying-glass',
      action: 'extra',
    });
    icon.classList.add('shift-page-preview-open');
    icon.title = 'Preview';
    icon.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      showPreview(pdfjsDoc, pageNum, totalPages);
    });

    if (!thumb.classList.contains('relative')) {
      thumb.classList.add('relative');
    }

    thumb.appendChild(icon);
  });

  container.addEventListener('keydown', (event) => {
    if (event.key === ' ' && !state.isOpen) {
      const hovered = container.querySelector<HTMLElement>(
        '[data-preview-init]:hover'
      );
      if (hovered) {
        event.preventDefault();
        let pageNum = 1;
        if (hovered.dataset.pageNumber) {
          pageNum = parseInt(hovered.dataset.pageNumber, 10);
        } else if (hovered.dataset.pageIndex !== undefined) {
          pageNum = parseInt(hovered.dataset.pageIndex, 10) + 1;
        }
        showPreview(pdfjsDoc, pageNum, totalPages);
      }
    }
  });
}
