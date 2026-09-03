import { readPdfLibrary, type PdfLibraryEntry } from './pdf-library-store.js';
import {
  isDuplicateMergeFile,
  type MergeFileIdentity,
} from './merge-file-identity.js';

export type PdfLibraryPickerOptions = {
  root?: Document;
  title?: string;
  emptyMessage?: string;
  rowAriaLabel?: (entry: PdfLibraryEntry, disabled: boolean) => string;
  exclude?: MergeFileIdentity[];
  onSelect: (entries: PdfLibraryEntry[]) => void;
  onUpload?: () => void;
};

function defaultRowAriaLabel(
  entry: PdfLibraryEntry,
  disabled: boolean
): string {
  return disabled ? `${entry.name} already added` : `Add ${entry.name}`;
}

const PICKER_ID = 'shift-pdf-library-picker';

function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function closePicker(root: Document): void {
  root.getElementById(PICKER_ID)?.remove();
}

function createPickerShell(
  root: Document,
  title: string
): {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  list: HTMLDivElement;
} {
  const overlay = root.createElement('div');
  overlay.id = PICKER_ID;
  overlay.className = 'shift-library-picker-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'shift-library-picker-title');

  const panel = root.createElement('div');
  panel.className = 'shift-library-picker-panel';

  const header = root.createElement('div');
  header.className = 'shift-library-picker-header';

  const heading = root.createElement('h2');
  heading.id = 'shift-library-picker-title';
  heading.className = 'shift-library-picker-title';
  heading.textContent = title;

  const closeButton = root.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'shift-library-picker-close';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.textContent = '×';
  closeButton.addEventListener('click', () => closePicker(root));

  header.append(heading, closeButton);

  const list = root.createElement('div');
  list.className = 'shift-library-picker-list';

  panel.append(header, list);
  overlay.append(panel);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closePicker(root);
  });

  return { overlay, panel, list };
}

function createEmptyState(
  root: Document,
  options: {
    heading: string;
    message: string;
    onUpload?: () => void;
  }
): HTMLDivElement {
  const empty = root.createElement('div');
  empty.className = 'shift-library-picker-empty';

  const emptyHeading = root.createElement('h3');
  emptyHeading.className = 'shift-library-picker-empty-heading';
  emptyHeading.textContent = options.heading;

  const emptyMessage = root.createElement('p');
  emptyMessage.className = 'shift-library-picker-empty-message';
  emptyMessage.textContent = options.message;

  empty.append(emptyHeading, emptyMessage);

  const upload = createUploadAction(root, options.onUpload);
  if (upload) {
    empty.appendChild(upload);
  }

  return empty;
}

function createLibraryRow(
  root: Document,
  entry: PdfLibraryEntry,
  disabled: boolean,
  rowAriaLabel: (entry: PdfLibraryEntry, disabled: boolean) => string,
  onSelect: (entry: PdfLibraryEntry) => void
): HTMLButtonElement {
  const row = root.createElement('button');
  row.type = 'button';
  row.className = 'shift-library-picker-row';
  row.disabled = disabled;
  row.setAttribute('aria-label', rowAriaLabel(entry, disabled));

  const name = root.createElement('span');
  name.className = 'shift-library-picker-name';
  name.textContent = entry.name;

  const meta = root.createElement('span');
  meta.className = 'shift-library-picker-meta';
  meta.textContent = `${new Date(entry.addedAt).toLocaleDateString()} · ${formatFileSize(entry.size)}`;

  row.append(name, meta);
  if (!disabled) {
    row.addEventListener('click', () => onSelect(entry));
  }
  return row;
}

function createUploadAction(
  root: Document,
  onUpload?: () => void
): HTMLButtonElement | null {
  if (!onUpload) return null;

  const upload = root.createElement('button');
  upload.type = 'button';
  upload.className =
    'shift-button shift-button-secondary shift-button-block shift-library-picker-upload';
  upload.textContent = 'Upload from device';
  upload.addEventListener('click', () => {
    closePicker(root);
    onUpload();
  });
  return upload;
}

export async function openPdfLibraryPicker(
  options: PdfLibraryPickerOptions
): Promise<void> {
  const root = options.root ?? document;
  closePicker(root);

  const title = options.title ?? 'Choose a PDF from your library';
  const exclude = options.exclude ?? [];
  const rowAriaLabel = options.rowAriaLabel ?? defaultRowAriaLabel;
  const { overlay, panel, list } = createPickerShell(root, title);

  const entries = await readPdfLibrary();
  const isLibraryEmpty = entries.length === 0;

  if (isLibraryEmpty) {
    panel.appendChild(
      createEmptyState(root, {
        heading: 'No saved PDFs',
        message:
          options.emptyMessage ??
          'No saved PDFs in your library yet. Upload one from your device.',
        onUpload: options.onUpload,
      })
    );
  }

  for (const entry of entries) {
    const disabled = isDuplicateMergeFile(exclude, {
      name: entry.name,
      size: entry.size,
      libraryId: entry.id,
    });
    list.appendChild(
      createLibraryRow(root, entry, disabled, rowAriaLabel, (selected) => {
        closePicker(root);
        options.onSelect([selected]);
      })
    );
  }

  if (!isLibraryEmpty && options.onUpload) {
    const upload = createUploadAction(root, options.onUpload);
    if (upload) {
      const footer = root.createElement('div');
      footer.className = 'shift-library-picker-footer';
      footer.appendChild(upload);
      panel.appendChild(footer);
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      root.removeEventListener('keydown', onKeyDown);
      closePicker(root);
    }
  };
  root.addEventListener('keydown', onKeyDown);

  root.body.appendChild(overlay);
}

export function closePdfLibraryPicker(root: Document = document): void {
  closePicker(root);
}
