import { renderPdfFirstPage } from '../utils/pdf-thumbnail.js';
import {
  clearPersistedOpenFile,
  markOpenFilePresent,
  writePersistedOpenFile,
} from './open-file-store.js';
import { attachShiftTooltip, hideShiftTooltip } from './shift-tooltip.js';

const BODY_CLASS = 'shift-has-open-file';
const IN_TOOL_CLASS = 'shift-open-file-in-tool';
const MAX_VISIBLE_FILES = 3;
const HOME_FILE_VIEW_KEY = 'shiftHomeOpenFileView';
const UPLOAD_ICON_PATH =
  'M7.75 3.75h6.19L17.25 7.06v12.19a1 1 0 0 1-1 1H7.75a1 1 0 0 1-1-1V4.75a1 1 0 0 1 1-1ZM13.75 3.75v3.5h3.5';
const HANDOFF_ICON_PATH =
  'M4.75 6.75h5.5L12 8.75h7.25v9.5H4.75V6.75ZM4.75 11.25h14.5';

export type WorkspaceFileSource = 'upload' | 'handoff';

export type WorkspaceFileInfo = {
  name: string;
  size?: number;
  source: WorkspaceFileSource;
  addedAt?: number;
  blob?: File;
};

export type HomeOpenFileView = 'list' | 'thumbnail';

const fileOrigins = new WeakMap<File, WorkspaceFileSource>();

let currentFiles: WorkspaceFileInfo[] = [];
let displayObserver: MutationObserver | null = null;
let observedRoot: Document | null = null;
let homeFileView: HomeOpenFileView = readHomeFileView();
let thumbnailRenderToken = 0;
let viewToggleBoundRoot: Document | null = null;

export function markFileFromHandoff(file: File): File {
  fileOrigins.set(file, 'handoff');
  return file;
}

export function copyFileOrigin(from: File, to: File): File {
  const origin = fileOrigins.get(from);
  if (origin) fileOrigins.set(to, origin);
  return to;
}

export function getWorkspaceFiles(): WorkspaceFileInfo[] {
  return currentFiles.slice();
}

export function getHandoffFiles(): WorkspaceFileInfo[] {
  return currentFiles.filter((file) => file.source === 'handoff');
}

export function setWorkspaceFiles(
  files: Array<
    | File
    | (Omit<WorkspaceFileInfo, 'source'> & { source?: WorkspaceFileSource })
  >,
  root: Document = document
): void {
  currentFiles = files
    .map((file) => toFileInfo(file))
    .filter((file): file is WorkspaceFileInfo => file !== null);
  void persistCurrentOpenFile();
  renderWorkspaceFiles(root);
}

export function getHomeOpenFileView(): HomeOpenFileView {
  return homeFileView;
}

function persistCurrentOpenFile(): Promise<void> {
  if (currentFiles.length === 0) return clearPersistedOpenFile();
  const first = currentFiles[0];
  if (!(first?.blob instanceof File)) return Promise.resolve();
  markOpenFilePresent(true);
  return writePersistedOpenFile(first.blob, {
    source: first.source,
  });
}

export function persistWorkspaceOpenFile(): Promise<void> {
  return persistCurrentOpenFile();
}

export function setHomeOpenFileView(
  view: HomeOpenFileView,
  root: Document = document
): void {
  homeFileView = view === 'thumbnail' ? 'thumbnail' : 'list';
  try {
    localStorage.setItem(HOME_FILE_VIEW_KEY, homeFileView);
  } catch {
    // Private mode can block storage.
  }
  applyHomeFileView(root);
  if (homeFileView === 'thumbnail') {
    void fillHomeThumbnails(root, currentFiles);
  }
}

export function initWorkspaceFileIndicator(root: Document = document): void {
  bindHomeFileViewToggle(root);
  observeFileDisplay(root);
  renderWorkspaceFiles(root);
}

export function resetWorkspaceFileIndicator(root: Document = document): void {
  displayObserver?.disconnect();
  displayObserver = null;
  observedRoot = null;
  viewToggleBoundRoot = null;
  currentFiles = [];
  homeFileView = 'thumbnail';
  thumbnailRenderToken += 1;
  try {
    localStorage.removeItem(HOME_FILE_VIEW_KEY);
  } catch {
    // Ignore storage failures in tests.
  }
  void clearPersistedOpenFile();
  hideShiftTooltip(root);
  root.body.classList.remove(BODY_CLASS);
  root.body.classList.remove(IN_TOOL_CLASS);
  renderWorkspaceFiles(root);
}

export function renderWorkspaceFiles(root: Document = document): void {
  hideShiftTooltip(root);
  const hasFiles = currentFiles.length > 0;
  const hidePicker = shouldHideDropZone(root);
  root.body.classList.toggle(BODY_CLASS, hasFiles);
  root.body.classList.toggle(IN_TOOL_CLASS, hidePicker);
  const dropZone = root.getElementById('drop-zone');
  if (dropZone) dropZone.hidden = hidePicker;
  renderSidebarFiles(root, openFilesForSidebar(root));
  renderHomeFilesTable(root, currentFiles);
}

export function pickerAcceptsFile(
  input: HTMLInputElement,
  file: File
): boolean {
  const accept = (input.accept || '').trim().toLowerCase();
  if (!accept) return true;

  const tokens = accept.split(',').map((token) => token.trim());
  return tokens.some((token) => {
    if (token === '*' || token === '*/*') return true;
    if (token === 'application/pdf' || token === '.pdf') {
      return (
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
      );
    }
    if (token.startsWith('.')) {
      return file.name.toLowerCase().endsWith(token);
    }
    return file.type === token;
  });
}

export function pickerAcceptsPdf(root: Document = document): boolean {
  const input = root.getElementById('file-input') as HTMLInputElement | null;
  if (!input) return false;
  return pickerAcceptsFile(
    input,
    new File([], 'document.pdf', { type: 'application/pdf' })
  );
}

function shouldHideDropZone(root: Document): boolean {
  if (currentFiles.length === 0) return false;
  if (isHomePage(root)) return true;
  const input = root.getElementById('file-input') as HTMLInputElement | null;
  if (!input) return false;
  const file = pickerFileFromWorkspace();
  if (!file) return true;
  return pickerAcceptsFile(input, file);
}

function pickerFileFromWorkspace(): File | null {
  const first = currentFiles[0];
  if (!first) return null;
  if (first.blob instanceof File) return first.blob;
  const type = first.name.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : '';
  return new File([], first.name, { type });
}

function isHomePage(root: Document): boolean {
  return Boolean(root.getElementById('shift-my-pdfs'));
}

function openFilesForSidebar(root: Document): WorkspaceFileInfo[] {
  return isHomePage(root) ? getHandoffFiles() : currentFiles;
}

function activeFilesHeading(count: number): string {
  return count === 1 ? 'Active file' : 'Active files';
}

function renderSidebarFiles(root: Document, files: WorkspaceFileInfo[]): void {
  const section = root.getElementById('shift-open-files');
  const list = root.getElementById('shift-open-files-list');
  const heading = root.getElementById('shift-open-files-heading');
  if (!section || !list) return;

  const hasFiles = files.length > 0;
  section.hidden = !hasFiles;
  if (heading && hasFiles) {
    heading.textContent = activeFilesHeading(files.length);
  }
  if (hasFiles) {
    list.setAttribute('aria-label', activeFilesHeading(files.length));
  }

  list.replaceChildren();
  if (!hasFiles) return;

  const visible = files.slice(0, MAX_VISIBLE_FILES);
  for (const file of visible) {
    list.appendChild(createFileButton(file, root));
  }

  const remaining = files.length - visible.length;
  if (remaining > 0) {
    list.appendChild(createOverflowButton(remaining, root));
  }
}

function renderHomeFilesTable(
  root: Document,
  files: WorkspaceFileInfo[]
): void {
  const section = root.getElementById('shift-my-pdfs');
  const body = root.getElementById('shift-my-pdfs-body');
  const thumbs = root.getElementById('shift-my-pdfs-thumbs');
  if (!section || !body) return;

  bindHomeFileViewToggle(root);
  const hasFiles = files.length > 0;
  section.hidden = !hasFiles;
  const heading = root.getElementById('shift-my-pdfs-heading');
  if (heading && hasFiles) {
    heading.textContent = 'Active file';
  }
  body.replaceChildren();
  thumbs?.replaceChildren();
  applyHomeFileView(root);
  if (!hasFiles) return;

  const openFile = files[0];
  if (!openFile) return;
  body.appendChild(createHomeFileRow(openFile, root));
  thumbs?.appendChild(createHomeFileThumb(openFile, root));

  if (homeFileView === 'thumbnail') {
    void fillHomeThumbnails(root, [openFile]);
  }
}

function toFileInfo(
  file:
    | File
    | (Omit<WorkspaceFileInfo, 'source'> & { source?: WorkspaceFileSource })
): WorkspaceFileInfo | null {
  const name = (file instanceof File ? file.name : file.name).trim();
  if (!name) return null;
  const existing = currentFiles.find((item) => item.name === name);

  if (file instanceof File) {
    const origin = fileOrigins.get(file);
    return {
      name,
      size: file.size,
      source: origin ?? 'upload',
      addedAt: existing?.addedAt ?? Date.now(),
      blob: file,
    };
  }

  return {
    name,
    size: typeof file.size === 'number' ? file.size : 0,
    source: file.source ?? 'upload',
    addedAt: file.addedAt ?? existing?.addedAt ?? Date.now(),
    blob: existing?.blob,
  };
}

function observeFileDisplay(root: Document): void {
  displayObserver?.disconnect();
  displayObserver = null;
  observedRoot = root;

  const area = root.getElementById('file-display-area');
  if (!area) return;

  displayObserver = new MutationObserver(() => {
    syncFromFileDisplay(root, true);
  });
  displayObserver.observe(area, { childList: true, subtree: true });
  if (area.querySelector('.truncate')) syncFromFileDisplay(root, false);
}

function syncFromFileDisplay(root: Document, allowClear: boolean): void {
  const area = root.getElementById('file-display-area');
  if (!area || observedRoot !== root) return;

  const names = Array.from(area.querySelectorAll('.truncate'))
    .map((element) => element.textContent?.trim() ?? '')
    .filter((name) => name.length > 0);

  if (names.length === 0) {
    if (!allowClear) return;
    const fileList = root.getElementById('file-list');
    if (fileList && fileList.childElementCount > 0) return;
    if (currentFiles.length === 0) return;
    setWorkspaceFiles([], root);
    return;
  }

  if (sameNames(names, currentFiles)) return;
  setWorkspaceFiles(
    names.map((name) => {
      const existing = currentFiles.find((file) => file.name === name);
      return {
        name,
        size: existing?.size ?? 0,
        source: existing?.source ?? 'upload',
        addedAt: existing?.addedAt,
        blob: existing?.blob,
      };
    }),
    root
  );
}

function sameNames(names: string[], files: WorkspaceFileInfo[]): boolean {
  return (
    names.length === files.length &&
    names.every((name, index) => files[index]?.name === name)
  );
}

function createFileButton(
  file: WorkspaceFileInfo,
  root: Document
): HTMLButtonElement {
  const button = root.createElement('button');
  button.type = 'button';
  button.className = 'shift-nav-link shift-open-file-item';
  button.dataset.source = file.source;
  button.setAttribute('aria-label', sidebarFileAriaLabel(file));
  if (file.source === 'handoff') {
    attachShiftTooltip(button, {
      placement: 'right',
      text: sidebarFileTooltip(file),
    });
    button.setAttribute('data-i18n-tooltip', 'home.fromShiftHandoffTooltip');
  }
  button.append(
    createFileIcon(file.source, root),
    createLabel(file.name, root)
  );
  button.addEventListener('click', () => {
    openFilePicker(root);
  });
  return button;
}

function sidebarFileTooltip(file: WorkspaceFileInfo): string {
  if (file.source === 'handoff') {
    return 'Received from Shift. Click to replace this PDF.';
  }
  return file.name;
}

function sidebarFileAriaLabel(file: WorkspaceFileInfo): string {
  if (file.source === 'handoff') {
    return `${file.name}. Received from Shift. Click to replace this PDF.`;
  }
  return file.name;
}

function createHomeFileRow(
  file: WorkspaceFileInfo,
  root: Document
): HTMLTableRowElement {
  const row = root.createElement('tr');
  row.className = 'shift-my-pdfs-row';
  row.dataset.source = file.source;

  const nameCell = root.createElement('td');
  nameCell.className = 'shift-my-pdfs-name';
  const name = root.createElement('span');
  name.textContent = file.name;
  nameCell.append(createFileIcon(file.source, root), name);

  const dateCell = root.createElement('td');
  dateCell.textContent = file.addedAt
    ? new Date(file.addedAt).toDateString()
    : '';

  const sizeCell = root.createElement('td');
  sizeCell.textContent = formatFileSize(file.size);

  row.append(nameCell, dateCell, sizeCell);

  return row;
}

function createHomeFileThumb(
  file: WorkspaceFileInfo,
  root: Document
): HTMLButtonElement {
  const card = root.createElement('button');
  card.type = 'button';
  card.className = 'shift-open-file-thumb';
  card.dataset.source = file.source;
  card.dataset.fileName = file.name;

  const preview = root.createElement('div');
  preview.className = 'shift-open-file-thumb-preview is-empty';
  const canvas = root.createElement('canvas');
  const replaceHint = root.createElement('span');
  replaceHint.className = 'shift-open-file-thumb-replace';
  replaceHint.setAttribute('data-i18n', 'home.clickToUpload');
  replaceHint.textContent = 'Click to upload';
  preview.append(canvas, replaceHint);

  const meta = root.createElement('div');
  meta.className = 'shift-open-file-thumb-meta';
  const name = root.createElement('span');
  name.className = 'shift-open-file-thumb-name';
  name.textContent = file.name;
  meta.appendChild(name);

  card.append(preview, meta);
  if (file.source === 'handoff') {
    card.setAttribute('aria-label', sidebarFileAriaLabel(file));
    attachShiftTooltip(card, {
      placement: 'bottom',
      text: sidebarFileTooltip(file),
    });
    card.setAttribute('data-i18n-tooltip', 'home.fromShiftHandoffTooltip');
  } else {
    card.setAttribute('aria-label', `Click to upload ${file.name}`);
  }

  card.addEventListener('click', () => {
    openFilePicker(root);
  });
  return card;
}

async function fillHomeThumbnails(
  root: Document,
  files: WorkspaceFileInfo[]
): Promise<void> {
  const token = ++thumbnailRenderToken;
  const thumbs = root.getElementById('shift-my-pdfs-thumbs');
  if (!thumbs) return;

  for (const file of files) {
    if (token !== thumbnailRenderToken) return;
    const card = Array.from(
      thumbs.querySelectorAll<HTMLElement>('.shift-open-file-thumb')
    ).find((item) => item.dataset.fileName === file.name);
    const preview = card?.querySelector<HTMLElement>(
      '.shift-open-file-thumb-preview'
    );
    const canvas = preview?.querySelector('canvas');
    if (!preview || !canvas || !file.blob) continue;

    try {
      await renderPdfFirstPage(file.blob, canvas);
      if (token !== thumbnailRenderToken) return;
      preview.classList.remove('is-empty');
    } catch {
      preview.classList.add('is-empty');
    }
  }
}

function bindHomeFileViewToggle(root: Document): void {
  if (viewToggleBoundRoot === root) return;
  const listButton = root.getElementById('shift-open-file-view-list');
  const thumbButton = root.getElementById('shift-open-file-view-thumbnail');
  if (!listButton || !thumbButton) return;

  viewToggleBoundRoot = root;
  listButton.addEventListener('click', () => {
    setHomeOpenFileView('list', root);
  });
  thumbButton.addEventListener('click', () => {
    setHomeOpenFileView('thumbnail', root);
  });
}

function applyHomeFileView(root: Document): void {
  const section = root.getElementById('shift-my-pdfs');
  if (section) section.dataset.view = homeFileView;

  root
    .getElementById('shift-open-file-view-list')
    ?.setAttribute('aria-pressed', String(homeFileView === 'list'));
  root
    .getElementById('shift-open-file-view-thumbnail')
    ?.setAttribute('aria-pressed', String(homeFileView === 'thumbnail'));
}

function readHomeFileView(): HomeOpenFileView {
  try {
    return localStorage.getItem(HOME_FILE_VIEW_KEY) === 'list'
      ? 'list'
      : 'thumbnail';
  } catch {
    return 'thumbnail';
  }
}

function createOverflowButton(
  remaining: number,
  root: Document
): HTMLButtonElement {
  const button = root.createElement('button');
  button.type = 'button';
  button.className =
    'shift-nav-link shift-open-file-item shift-open-files-more';
  const label = `${remaining} more`;
  button.title = label;
  button.setAttribute('aria-label', `Add files, ${label}`);
  button.append(createFileIcon('upload', root), createLabel(label, root));
  button.addEventListener('click', () => openFilePicker(root));
  return button;
}

function createLabel(text: string, root: Document): HTMLSpanElement {
  const label = root.createElement('span');
  label.className = 'shift-nav-label';
  label.textContent = text;
  return label;
}

function createFileIcon(
  source: WorkspaceFileSource,
  root: Document
): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = root.createElementNS(namespace, 'svg');
  svg.setAttribute(
    'class',
    source === 'handoff'
      ? 'shift-nav-icon shift-open-file-icon-handoff'
      : 'shift-nav-icon shift-open-file-icon-upload'
  );
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = root.createElementNS(namespace, 'path');
  path.setAttribute(
    'd',
    source === 'handoff' ? HANDOFF_ICON_PATH : UPLOAD_ICON_PATH
  );
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function openFilePicker(root: Document): void {
  const input = root.getElementById('file-input') as HTMLInputElement | null;
  if (!input) return;
  input.value = '';
  input.click();
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}
