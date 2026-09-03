import { state } from '../state.js';
import { renderPdfFirstPage } from '../utils/pdf-thumbnail.js';
import { confirmAction } from './confirm-dialog.js';
import { removePdfFromLibrary } from './pdf-library-store.js';
import {
  clearPersistedOpenFile,
  hasOpenFileFlag,
  hasOpenFileSkeleton,
  OPEN_FILE_SKELETON_ATTR,
  PENDING_FILE_ROW_ATTR,
  readOpenFileSnapshot,
  writePersistedOpenFiles,
} from './open-file-store.js';
import { attachShiftTooltip, hideShiftTooltip } from './shift-tooltip.js';
import {
  createMyPdfsSearchEmptyCopy,
  createMyPdfsSearchEmptyRow,
  filterLibraryFilesByName,
  getMyPdfsSearchQuery,
  isMyPdfsSearchActive,
  resetMyPdfsSearch,
} from './my-pdfs-search.js';
import { findToolFileInput } from './tool-file-seed.js';

const BODY_CLASS = 'shift-has-open-file';
const IN_TOOL_CLASS = 'shift-open-file-in-tool';
const MAX_VISIBLE_FILES = 3;
const HOME_FILE_VIEW_KEY = 'shiftHomeOpenFileView';
const SIDEBAR_THUMB_MAX_WIDTH = 48;
const SIDEBAR_THUMB_STORE_KEY = 'shiftSidebarThumbnails';
const SIDEBAR_THUMB_CACHE_LIMIT = 8;
const SIDEBAR_THUMB_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const UPLOAD_ICON_PATH =
  'M7.75 3.75h6.19L17.25 7.06v12.19a1 1 0 0 1-1 1H7.75a1 1 0 0 1-1-1V4.75a1 1 0 0 1 1-1ZM13.75 3.75v3.5h3.5';
const HANDOFF_ICON_PATH =
  'M4.75 6.75h5.5L12 8.75h7.25v9.5H4.75V6.75ZM4.75 11.25h14.5';
const DOWNLOAD_ICON_PATH =
  'M12 3.75v10.5m0 0 4-4m-4 4-4-4M5.75 16.25v3h12.5v-3';
const HEADER_TOOLS_ENTER_CLASS = 'shift-enter';
const SELECTED_FILE_TOOLTIP =
  'A selected file is a file that will be used when you click on tools.';
const EMPTY_LIBRARY_HEADING = 'Add a PDF to get started';
const EMPTY_LIBRARY_MESSAGE =
  'The selected PDF is what tools will use. Files stay on your machine.';
const EMPTY_LIBRARY_ACTION = 'Choose files';
const DELETE_ICON_PATH =
  'M5.75 7.25h12.5M9.75 7.25V5.75a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1v1.5M7.25 7.25l.7 11a1 1 0 0 0 1 .95h6.1a1 1 0 0 0 1-.95l.7-11M10.5 10.75v5M13.5 10.75v5';
const MY_PDFS_SELECT_ALL_ID = 'shift-my-pdfs-select-all';
const MY_PDFS_SELECTION_COUNT_ID = 'shift-my-pdfs-selection-count';
const MY_PDFS_DELETE_SELECTED_ID = 'shift-my-pdfs-delete-selected';

export type WorkspaceFileSource = 'upload' | 'handoff' | 'download';

export type WorkspaceFileInfo = {
  id?: string;
  name: string;
  size?: number;
  source: WorkspaceFileSource;
  addedAt?: number;
  blob?: File;
};

export type HomeOpenFileView = 'list' | 'thumbnail';

const fileOrigins = new WeakMap<File, WorkspaceFileSource>();

/* A rebuilt sidebar must never show the placeholder icon again for a PDF it has
   already drawn: re-rendering takes ~100ms, which reads as a flash. Painted
   canvases are kept per document so a rebuild can re-adopt the live node, and
   their bitmaps are mirrored into session storage so the first paint after a
   navigation already carries the thumbnail. */
const sidebarThumbnailCanvases = new Map<string, HTMLCanvasElement>();
let sidebarThumbnailDataUrls: Map<string, string> | null = null;
let sidebarThumbnailsSerializable = true;

let currentFiles: WorkspaceFileInfo[] = [];
let homeLibraryFiles: WorkspaceFileInfo[] = [];
let homeLibraryEpoch = 0;
let lastRenderedHomeFiles: WorkspaceFileInfo[] = [];
let lastRenderedSidebarFiles: WorkspaceFileInfo[] = [];
let lastRenderedSidebarRemaining = 0;
let displayObserver: MutationObserver | null = null;
let observedRoot: Document | null = null;
let homeFileView: HomeOpenFileView = readHomeFileView();
let thumbnailRenderToken = 0;
let sidebarThumbnailToken = 0;
let viewToggleBoundRoot: Document | null = null;
let myPdfsChromeBoundRoot: Document | null = null;

export function markFileFromHandoff(file: File): File {
  fileOrigins.set(file, 'handoff');
  return file;
}

export function markFileFromDownload(file: File): File {
  fileOrigins.set(file, 'download');
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

export function getHomeLibraryFiles(): WorkspaceFileInfo[] {
  return homeLibraryFiles.slice();
}

export function getHomeLibraryEpoch(): number {
  return homeLibraryEpoch;
}

export function setHomeLibraryFiles(
  files: Array<
    | File
    | (Omit<WorkspaceFileInfo, 'source'> & { source?: WorkspaceFileSource })
  >,
  root: Document = document,
  epoch: number = homeLibraryEpoch
): void {
  if (epoch !== homeLibraryEpoch) return;
  homeLibraryFiles = files
    .map((file) => toFileInfo(file, homeLibraryFiles))
    .filter((file): file is WorkspaceFileInfo => file !== null);
  renderWorkspaceFiles(root);
}

export function setWorkspaceFiles(
  files: Array<
    | File
    | (Omit<WorkspaceFileInfo, 'source'> & { source?: WorkspaceFileSource })
  >,
  root: Document = document
): void {
  currentFiles = files
    .map((file) => toFileInfo(file, currentFiles))
    .filter((file): file is WorkspaceFileInfo => file !== null);
  void persistCurrentOpenFile();
  renderWorkspaceFiles(root);
}

export function getHomeOpenFileView(): HomeOpenFileView {
  return homeFileView;
}

function persistCurrentOpenFile(): Promise<void> {
  const files = currentFiles.filter(
    (file): file is WorkspaceFileInfo & { blob: File } =>
      file.blob instanceof File
  );
  if (files.length === 0) {
    // A placeholder on the page means the seed has not resolved yet. Tools that
    // render an empty list during init (merge) would otherwise erase the very
    // file that is about to be seeded into them.
    if (hasOpenFileSkeleton()) return Promise.resolve();
    return clearPersistedOpenFile();
  }
  return writePersistedOpenFiles(
    files.map((file) => ({
      file: file.blob,
      source: file.source,
    }))
  );
}

export function persistWorkspaceOpenFile(): Promise<void> {
  return persistCurrentOpenFile();
}

export async function clearWorkspaceOpenFile(
  root: Document = document
): Promise<void> {
  currentFiles = [];
  await clearPersistedOpenFile();
  renderWorkspaceFiles(root);
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
    void fillHomeThumbnails(root, visibleHomeLibraryFiles());
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
  myPdfsChromeBoundRoot = null;
  currentFiles = [];
  homeLibraryFiles = [];
  homeLibraryEpoch += 1;
  homeFileView = 'thumbnail';
  thumbnailRenderToken += 1;
  sidebarThumbnailToken += 1;
  lastRenderedHomeFiles = [];
  lastRenderedSidebarFiles = [];
  lastRenderedSidebarRemaining = 0;
  resetMyPdfsSearch();
  clearSidebarThumbnailCache();
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

export const WORKSPACE_FILES_RENDERED_EVENT = 'shift:workspace-files-rendered';

export function renderWorkspaceFiles(root: Document = document): void {
  hideShiftTooltip(root);
  const hasFiles = currentFiles.length > 0;
  const hidePicker = shouldHideDropZone(root);
  root.body.classList.toggle(BODY_CLASS, hasFiles);
  root.body.classList.toggle(IN_TOOL_CLASS, hidePicker);
  ensureMyPdfsPageChrome(root);
  const dropZone = root.getElementById('drop-zone');
  if (dropZone) dropZone.hidden = hidePicker;
  renderSidebarFiles(root, openFilesForSidebar());
  renderHomeFilesTable(root, visibleHomeLibraryFiles());
  syncMyPdfsSelectionChrome(root);
  syncHomeHeaderToolActions(root);
  root.dispatchEvent(
    new CustomEvent(WORKSPACE_FILES_RENDERED_EVENT, { bubbles: true })
  );
}

/**
 * Keep Open-with / Delete actions visible (My Images style) and enable them
 * only while a file is selected. Re-adding the reveal class on each enable
 * restarts `shift-rise-in` the first time actions become available.
 */
function syncHomeHeaderToolActions(root: Document): void {
  const tools = root.getElementById('shift-open-file-tools');
  if (!tools) return;

  const hasSelection = currentFiles.length > 0;
  tools.hidden = false;
  tools.setAttribute('aria-disabled', String(!hasSelection));
  tools.classList.toggle('is-disabled', !hasSelection);

  for (const link of tools.querySelectorAll<HTMLAnchorElement>(
    'a.shift-open-file-tool-btn, a.shift-button'
  )) {
    link.classList.toggle('is-disabled', !hasSelection);
    link.setAttribute('aria-disabled', String(!hasSelection));
    if (hasSelection) link.removeAttribute('tabindex');
    else link.tabIndex = -1;
  }

  const deleteSelected = root.getElementById(
    MY_PDFS_DELETE_SELECTED_ID
  ) as HTMLButtonElement | null;
  if (deleteSelected) deleteSelected.disabled = !hasSelection;

  if (!hasSelection) {
    tools.classList.remove(HEADER_TOOLS_ENTER_CLASS);
    return;
  }

  if (tools.classList.contains(HEADER_TOOLS_ENTER_CLASS)) return;
  tools.classList.remove(HEADER_TOOLS_ENTER_CLASS);
  void tools.offsetWidth;
  tools.classList.add(HEADER_TOOLS_ENTER_CLASS);
}

/**
 * My Images hierarchy: title → drop zone → filter → controls → grid.
 * Moves the existing drop zone under the heading and builds the select-all /
 * action / Grid|List chrome without forking every tool HTML page.
 */
function ensureMyPdfsPageChrome(root: Document): void {
  const section = root.getElementById('shift-my-pdfs');
  if (!section) return;

  // Build the controls shell first. It replaces the legacy header wrapper with
  // the bare heading; moving the drop zone beforehand would nest it inside that
  // wrapper and discard it on replaceWith.
  const controls = ensureMyPdfsControlsShell(root, section);
  ensureMyPdfsSelectionControls(root, controls);
  ensureMyPdfsDeleteSelected(root);
  ensureMyPdfsViewToggle(root);

  const heading = root.getElementById('shift-my-pdfs-heading');
  const dropZone = root.getElementById('drop-zone');
  if (heading && dropZone && dropZone.previousElementSibling !== heading) {
    heading.insertAdjacentElement('afterend', dropZone);
  }

  // Keep filter directly under the drop zone after any chrome reshuffle.
  const search = section.querySelector('.shift-my-pdfs-search');
  if (
    search &&
    dropZone &&
    section.contains(dropZone) &&
    dropZone.nextElementSibling !== search
  ) {
    dropZone.insertAdjacentElement('afterend', search);
  } else if (search && controls && search.nextElementSibling !== controls) {
    // No drop zone in section — still keep filter above the control row.
    controls.insertAdjacentElement('beforebegin', search);
  }

  if (myPdfsChromeBoundRoot === root) return;
  myPdfsChromeBoundRoot = root;
  bindMyPdfsSelectionControls(root);
}

function ensureMyPdfsControlsShell(
  root: Document,
  section: HTMLElement
): HTMLElement {
  let controls = section.querySelector(
    '.shift-my-pdfs-controls'
  ) as HTMLElement | null;
  if (!controls) {
    controls = root.createElement('div');
    controls.className = 'shift-my-pdfs-controls';

    const legacyHeader = section.querySelector('.shift-open-file-header');
    const headerControls = section.querySelector(
      '.shift-open-file-header-controls'
    );
    const heading = root.getElementById('shift-my-pdfs-heading');
    const tools = root.getElementById('shift-open-file-tools');
    const viewBy = section.querySelector('.shift-open-file-view-by');

    const row = root.createElement('div');
    row.className = 'shift-my-pdfs-controls-row';
    const selection = root.createElement('div');
    selection.className = 'shift-my-pdfs-selection';
    const actions = root.createElement('div');
    actions.className = 'shift-my-pdfs-actions';
    row.append(selection, actions);

    if (tools) {
      tools.querySelector(':scope > span')?.remove();
      actions.appendChild(tools);
    } else if (headerControls) {
      actions.append(
        ...Array.from(headerControls.children).filter((child) =>
          child.id === 'shift-open-file-tools'
            ? true
            : !child.classList.contains('shift-open-file-view-by')
        )
      );
    }

    controls.appendChild(row);
    if (viewBy) controls.appendChild(viewBy);

    const table = section.querySelector('.shift-my-pdfs-table');
    const thumbs = root.getElementById('shift-my-pdfs-thumbs');
    if (table) table.insertAdjacentElement('beforebegin', controls);
    else if (thumbs) thumbs.insertAdjacentElement('beforebegin', controls);
    else section.appendChild(controls);

    // Keep the page title; only discard the old header wrapper/controls.
    if (legacyHeader && heading) {
      legacyHeader.replaceWith(heading);
    } else {
      legacyHeader?.remove();
    }
  }

  return controls;
}

function ensureMyPdfsSelectionControls(
  root: Document,
  controls: HTMLElement
): void {
  let selection = controls.querySelector(
    '.shift-my-pdfs-selection'
  ) as HTMLElement | null;
  if (!selection) {
    selection = root.createElement('div');
    selection.className = 'shift-my-pdfs-selection';
    const row =
      controls.querySelector('.shift-my-pdfs-controls-row') ?? controls;
    row.insertBefore(selection, row.firstChild);
  }

  if (!root.getElementById(MY_PDFS_SELECT_ALL_ID)) {
    const selectAll = root.createElement('button');
    selectAll.type = 'button';
    selectAll.id = MY_PDFS_SELECT_ALL_ID;
    selectAll.className = 'shift-my-pdfs-select-all';
    selectAll.textContent = 'Select all';
    selection.appendChild(selectAll);
  }

  if (!root.getElementById(MY_PDFS_SELECTION_COUNT_ID)) {
    const count = root.createElement('span');
    count.id = MY_PDFS_SELECTION_COUNT_ID;
    count.className = 'shift-my-pdfs-selection-count';
    selection.appendChild(count);
  }
}

function ensureMyPdfsDeleteSelected(root: Document): void {
  if (root.getElementById(MY_PDFS_DELETE_SELECTED_ID)) return;

  let tools = root.getElementById('shift-open-file-tools');
  if (!tools) {
    const actions = root.querySelector('.shift-my-pdfs-actions');
    if (!actions) return;
    tools = root.createElement('div');
    tools.id = 'shift-open-file-tools';
    tools.className = 'shift-open-file-tools';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Library actions');
    const toggle = root.createElement('div');
    toggle.className = 'shift-open-file-tools-toggle';
    tools.appendChild(toggle);
    actions.appendChild(tools);
  }

  const toggle = tools.querySelector('.shift-open-file-tools-toggle') ?? tools;
  const button = root.createElement('button');
  button.type = 'button';
  button.id = MY_PDFS_DELETE_SELECTED_ID;
  button.className = 'shift-button shift-my-pdfs-delete-selected';
  button.textContent = 'Delete';
  button.disabled = currentFiles.length === 0;
  toggle.appendChild(button);
}

/**
 * Grid | List stays the icon toggle the page markup ships, with its own
 * `aria-label` / `aria-pressed` and `View by` grouping. Only the order changes,
 * so Grid reads first as it does in My Images. The buttons themselves — inline
 * SVG icons included — are left exactly as authored.
 */
function ensureMyPdfsViewToggle(root: Document): void {
  const listButton = root.getElementById('shift-open-file-view-list');
  const thumbButton = root.getElementById('shift-open-file-view-thumbnail');
  if (!listButton || !thumbButton) return;

  const toggle = thumbButton.closest('.shift-open-file-view-toggle');
  if (!toggle || toggle.firstElementChild === thumbButton) return;
  toggle.insertBefore(thumbButton, listButton);
}

function bindMyPdfsSelectionControls(root: Document): void {
  root
    .getElementById(MY_PDFS_SELECT_ALL_ID)
    ?.addEventListener('click', () => toggleSelectAllVisible(root));
  root
    .getElementById(MY_PDFS_DELETE_SELECTED_ID)
    ?.addEventListener('click', () => {
      void deleteSelectedHomeLibraryFiles(root);
    });

  const tools = root.getElementById('shift-open-file-tools');
  tools?.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement | null)?.closest(
      'a[aria-disabled="true"]'
    );
    if (!link) return;
    event.preventDefault();
  });
}

function syncMyPdfsSelectionChrome(root: Document): void {
  const count = root.getElementById(MY_PDFS_SELECTION_COUNT_ID);
  if (!count) return;

  const total = homeLibrarySourceFiles().length;
  const selected = currentFiles.length;
  count.textContent = `${selected} of ${total} selected`;

  const selectAll = root.getElementById(
    MY_PDFS_SELECT_ALL_ID
  ) as HTMLButtonElement | null;
  if (!selectAll) return;

  const visible = visibleHomeLibraryFiles().filter(
    (file) => file.blob instanceof File
  );
  const allVisibleSelected =
    visible.length > 0 &&
    visible.every((file) => isHomeLibraryFileSelected(file));
  selectAll.textContent = allVisibleSelected ? 'Deselect all' : 'Select all';
  selectAll.disabled = visible.length === 0;
}

function toggleSelectAllVisible(root: Document): void {
  const visible = visibleHomeLibraryFiles().filter(
    (file) => file.blob instanceof File
  );
  if (visible.length === 0) return;

  const allVisibleSelected = visible.every((file) =>
    isHomeLibraryFileSelected(file)
  );

  if (allVisibleSelected) {
    currentFiles = currentFiles.filter(
      (current) => !visible.some((file) => isSameLibraryFile(current, file))
    );
    void persistCurrentOpenFile();
    renderWorkspaceFiles(root);
    return;
  }

  const kept = currentFiles.filter(
    (current) =>
      current.blob instanceof File &&
      !visible.some((file) => isSameLibraryFile(current, file))
  );
  for (const file of visible) {
    if (file.blob) fileOrigins.set(file.blob, file.source);
  }
  setWorkspaceFiles(
    [
      ...kept
        .map((file) => file.blob)
        .filter((blob): blob is File => blob instanceof File),
      ...visible
        .map((file) => file.blob)
        .filter((blob): blob is File => blob instanceof File),
    ],
    root
  );
}

async function deleteSelectedHomeLibraryFiles(root: Document): Promise<void> {
  const selected = currentFiles.filter((file) =>
    homeLibrarySourceFiles().some((entry) => isSameLibraryFile(entry, file))
  );
  if (selected.length === 0) return;

  const confirmed = await confirmAction({
    root,
    title: selected.length === 1 ? 'Delete this PDF?' : 'Delete selected PDFs?',
    message:
      selected.length === 1
        ? `${selected[0]?.name} will be removed from My PDFs. This cannot be undone.`
        : `${selected.length} PDFs will be removed from My PDFs. This cannot be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!confirmed) return;

  for (const file of selected) {
    if (file.id) await removePdfFromLibrary(file.id);
    homeLibraryFiles = homeLibraryFiles.filter((entry) =>
      file.id ? entry.id !== file.id : !isSameLibraryFile(entry, file)
    );
  }

  currentFiles = currentFiles.filter(
    (current) => !selected.some((file) => isSameLibraryFile(current, file))
  );
  void persistCurrentOpenFile();
  lastRenderedHomeFiles = [];
  renderWorkspaceFiles(root);
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
  const input = findToolFileInput(root);
  if (!input) return false;
  return pickerAcceptsFile(
    input,
    new File([], 'document.pdf', { type: 'application/pdf' })
  );
}

/**
 * Hide the tool drop zone only when an open workspace file is already present
 * and the IndexedDB library has PDFs (typical seeded-tool case). An empty
 * workspace must keep the drop zone so users can upload or reopen the library
 * picker after clearing files. Home always keeps its drop zone.
 *
 * While sidebar-boot.js placeholders are still on the page the seed has not
 * finished, so the pre-paint hide is kept: recomputing from an empty
 * `currentFiles` here is what used to flash the drop zone back for a frame.
 */
function shouldHideDropZone(root: Document): boolean {
  if (isHomePage(root)) return false;
  if (hasOpenFileSkeleton(root)) return true;
  if (currentFiles.length === 0) return false;
  return homeLibraryFiles.length > 0;
}

function isHomePage(root: Document): boolean {
  return Boolean(root.getElementById('shift-my-pdfs'));
}

function openFilesForSidebar(): WorkspaceFileInfo[] {
  return currentFiles;
}

function selectedFilesHeading(count: number): string {
  return count === 1 ? 'Selected file' : 'Selected files';
}

function renderSidebarFiles(root: Document, files: WorkspaceFileInfo[]): void {
  const section = root.getElementById('shift-open-files');
  const list = root.getElementById('shift-open-files-list');
  if (!section || !list) return;

  const hasFiles = files.length > 0;
  // The section also holds the My PDFs nav link, so only the file list toggles.
  section.hidden = false;

  if (!hasFiles) {
    renderPendingSidebarFiles(root, list);
    return;
  }

  list.hidden = false;
  list.setAttribute('aria-label', selectedFilesHeading(files.length));

  const visible = files.slice(0, MAX_VISIBLE_FILES);
  const remaining = files.length - visible.length;

  if (
    sidebarFilesMatch(lastRenderedSidebarFiles, visible) &&
    lastRenderedSidebarRemaining === remaining &&
    sidebarDomMatchesFiles(root, visible, remaining)
  ) {
    return;
  }

  sidebarThumbnailToken += 1;
  lastRenderedSidebarFiles = visible.map((file) => ({ ...file }));
  lastRenderedSidebarRemaining = remaining;
  list.replaceChildren();

  for (const file of visible) {
    list.appendChild(createFileButton(file, root));
  }

  if (remaining > 0) {
    list.appendChild(createOverflowButton(remaining, root));
  }

  void fillSidebarThumbnails(root, visible);
}

/**
 * Keep the rail showing the selection while the open-file store is still being
 * read.
 *
 * The list ships empty in markup and the blobs arrive tens of milliseconds
 * after the new document is revealed. Clearing it in the meantime is invisible
 * on a plain load but not across a navigation: the view transition carries the
 * previous, populated rail on screen, so the gap reads as the selected file
 * disappearing and coming back. The session snapshot already holds the names
 * and sizes, and sidebar-boot.js paints these same rows before first paint.
 */
function renderPendingSidebarFiles(root: Document, list: HTMLElement): void {
  const pending = pendingSidebarFiles().slice(0, MAX_VISIBLE_FILES);

  sidebarThumbnailToken += 1;
  lastRenderedSidebarFiles = [];
  lastRenderedSidebarRemaining = 0;
  list.hidden = pending.length === 0;
  if (pending.length > 0) {
    list.setAttribute('aria-label', selectedFilesHeading(pending.length));
  }

  list.replaceChildren(
    ...pending.map((file) => {
      const row = createFileButton(file, root);
      row.setAttribute(PENDING_FILE_ROW_ATTR, '');
      return row;
    })
  );
}

function pendingSidebarFiles(): WorkspaceFileInfo[] {
  if (!hasOpenFileFlag()) return [];
  return readOpenFileSnapshot().map((entry) => ({
    name: entry.name,
    size: entry.size,
    source: 'upload' as const,
  }));
}

function sidebarFilesMatch(
  previous: WorkspaceFileInfo[],
  next: WorkspaceFileInfo[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every(
      (file, index) =>
        file.name === next[index]?.name &&
        file.size === next[index]?.size &&
        file.source === next[index]?.source &&
        file.addedAt === next[index]?.addedAt
    )
  );
}

function sidebarDomMatchesFiles(
  root: Document,
  files: WorkspaceFileInfo[],
  remaining: number
): boolean {
  const list = root.getElementById('shift-open-files-list');
  if (!list) return false;

  const items = list.querySelectorAll<HTMLElement>(
    '.shift-open-file-item:not(.shift-open-files-more)'
  );
  if (items.length !== files.length) return false;
  if (
    !files.every((file, index) => items[index]?.dataset.fileName === file.name)
  ) {
    return false;
  }

  const more = list.querySelector('.shift-open-files-more');
  return remaining > 0 ? Boolean(more) : !more;
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
  section.hidden = false;
  const heading = root.getElementById('shift-my-pdfs-heading');
  if (heading) {
    heading.textContent = 'My PDFs';
  }
  applyHomeFileView(root);
  if (!hasFiles) {
    lastRenderedHomeFiles = [];
    if (isMyPdfsSearchActive() && homeLibrarySourceFiles().length > 0) {
      if (!homeLibraryHasSearchEmptyState(root)) {
        body.replaceChildren(createMyPdfsSearchEmptyRow(root));
        thumbs?.replaceChildren(createMyPdfsSearchEmptyCopy(root));
      }
      return;
    }
    if (!homeLibraryHasEmptyState(root)) {
      body.replaceChildren(createHomeEmptyRow(root));
      thumbs?.replaceChildren(createHomeEmptyCard(root));
    }
    return;
  }

  if (
    homeFilesListMatches(lastRenderedHomeFiles, files) &&
    homeLibraryDomMatchesFiles(root, files)
  ) {
    updateHomeLibrarySelection(root, files);
    // Cards built while the grid was hidden can sit forever in is-empty if a
    // later render takes this reuse shortcut. Refill any that never painted.
    if (thumbs?.querySelector('.shift-open-file-thumb-preview.is-empty')) {
      void fillHomeThumbnails(root, files);
    }
    return;
  }

  lastRenderedHomeFiles = files.map((file) => ({ ...file }));
  body.replaceChildren();
  thumbs?.replaceChildren();

  for (const openFile of files) {
    body.appendChild(createHomeFileRow(openFile, root));
    thumbs?.appendChild(createHomeFileThumb(openFile, root));
  }

  // Paint even in list view. The grid is CSS-hidden there, but skipping fill
  // leaves every canvas empty; switching back then depends entirely on
  // setHomeOpenFileView, and a reuse-path render can skip that fill forever.
  void fillHomeThumbnails(root, files);
}

function homeFilesListMatches(
  previous: WorkspaceFileInfo[],
  next: WorkspaceFileInfo[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every(
      (file, index) =>
        file.name === next[index]?.name &&
        file.size === next[index]?.size &&
        file.source === next[index]?.source &&
        file.addedAt === next[index]?.addedAt
    )
  );
}

function homeLibraryDomMatchesFiles(
  root: Document,
  files: WorkspaceFileInfo[]
): boolean {
  const body = root.getElementById('shift-my-pdfs-body');
  const thumbs = root.getElementById('shift-my-pdfs-thumbs');
  if (!body) return false;

  const rows = body.querySelectorAll<HTMLTableRowElement>(
    'tr.shift-my-pdfs-row'
  );
  if (rows.length !== files.length) return false;
  if (
    !files.every((file, index) => rows[index]?.dataset.fileName === file.name)
  ) {
    return false;
  }

  if (!thumbs) return true;
  const cards = homeLibraryThumbCards(thumbs);
  return (
    cards.length === files.length &&
    files.every((file, index) => cards[index]?.dataset.fileName === file.name)
  );
}

/** File cards only — the empty-state placeholder also uses shift-open-file-thumb. */
function homeLibraryThumbCards(thumbs: Element): HTMLElement[] {
  return Array.from(
    thumbs.querySelectorAll<HTMLElement>(
      '.shift-open-file-thumb:not(.shift-my-pdfs-empty-card)'
    )
  );
}

function homeLibrarySourceFiles(): WorkspaceFileInfo[] {
  return homeLibraryFiles.length > 0 ? homeLibraryFiles : currentFiles;
}

function visibleHomeLibraryFiles(): WorkspaceFileInfo[] {
  return filterLibraryFilesByName(
    homeLibrarySourceFiles(),
    getMyPdfsSearchQuery()
  );
}

function homeLibraryHasSearchEmptyState(root: Document): boolean {
  const body = root.getElementById('shift-my-pdfs-body');
  const thumbs = root.getElementById('shift-my-pdfs-thumbs');
  if (!body?.querySelector('.shift-my-pdfs-search-empty-row')) return false;
  if (!thumbs) return true;
  return Boolean(thumbs.querySelector('.shift-my-pdfs-search-empty'));
}

function homeLibraryHasEmptyState(root: Document): boolean {
  const body = root.getElementById('shift-my-pdfs-body');
  const thumbs = root.getElementById('shift-my-pdfs-thumbs');
  if (!body?.querySelector('.shift-my-pdfs-empty-row')) return false;
  if (!thumbs) return true;
  return Boolean(thumbs.querySelector('.shift-my-pdfs-empty-card'));
}

function createHomeEmptyCopy(root: Document): HTMLDivElement {
  const empty = root.createElement('div');
  empty.className = 'shift-my-pdfs-empty';

  const heading = root.createElement('h3');
  heading.className = 'shift-library-picker-empty-heading';
  heading.textContent = EMPTY_LIBRARY_HEADING;

  const message = root.createElement('p');
  message.className = 'shift-library-picker-empty-message';
  message.textContent = EMPTY_LIBRARY_MESSAGE;

  const action = root.createElement('button');
  action.type = 'button';
  action.className =
    'shift-button shift-button-secondary shift-library-picker-upload';
  action.textContent = EMPTY_LIBRARY_ACTION;
  action.addEventListener('click', (event) => {
    event.stopPropagation();
    openFilePicker(root);
  });

  empty.append(heading, message, action);
  return empty;
}

function createHomeEmptyRow(root: Document): HTMLTableRowElement {
  const row = root.createElement('tr');
  row.className = 'shift-my-pdfs-empty-row';
  const cell = root.createElement('td');
  cell.colSpan = 4;
  cell.appendChild(createHomeEmptyCopy(root));
  row.appendChild(cell);
  row.addEventListener('click', () => openFilePicker(root));
  return row;
}

function createHomeEmptyCard(root: Document): HTMLDivElement {
  const card = root.createElement('div');
  card.className = 'shift-open-file-thumb shift-my-pdfs-empty-card';
  card.appendChild(createHomeEmptyCopy(root));
  card.addEventListener('click', () => openFilePicker(root));
  return card;
}

function updateHomeLibrarySelection(
  root: Document,
  files: WorkspaceFileInfo[]
): void {
  const body = root.getElementById('shift-my-pdfs-body');
  const thumbs = root.getElementById('shift-my-pdfs-thumbs');
  if (!body) return;

  const rows = body.querySelectorAll<HTMLTableRowElement>(
    'tr.shift-my-pdfs-row'
  );
  const cards = thumbs ? homeLibraryThumbCards(thumbs) : null;

  for (const [index, file] of files.entries()) {
    const isSelected = isHomeLibraryFileSelected(file);

    const row = rows[index];
    if (row) {
      row.classList.toggle('is-selected', isSelected);
      row.setAttribute('aria-pressed', String(isSelected));
      const nameCell = row.querySelector('.shift-my-pdfs-name');
      const existingReplace = row.querySelector('.shift-my-pdfs-row-replace');
      if (isSelected) {
        existingReplace?.remove();
      } else if (!existingReplace && nameCell) {
        nameCell.appendChild(createHomeFileRowReplaceHint(root));
      }
    }

    const card = cards?.[index];
    if (card) {
      card.classList.toggle('is-selected', isSelected);
      card.setAttribute('aria-pressed', String(isSelected));
    }
  }
}

function toFileInfo(
  file:
    | File
    | (Omit<WorkspaceFileInfo, 'source'> & { source?: WorkspaceFileSource }),
  existingFiles: WorkspaceFileInfo[]
): WorkspaceFileInfo | null {
  const name = (file instanceof File ? file.name : file.name).trim();
  if (!name) return null;
  const existing = existingFiles.find((item) => item.name === name);

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
    id: file.id,
    name,
    size: typeof file.size === 'number' ? file.size : 0,
    source: file.source ?? 'upload',
    addedAt: file.addedAt ?? existing?.addedAt ?? Date.now(),
    blob: file.blob ?? existing?.blob,
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
  if (displayedFileNames(area).length > 0) syncFromFileDisplay(root, false);
}

/* Placeholder rows carry a filename but no blob. Adopting one as a workspace
   file would persist a blob-less entry, which clears the stored open file — the
   very file the placeholder is standing in for. */
function displayedFileNames(area: HTMLElement): string[] {
  return Array.from(area.querySelectorAll('.truncate'))
    .filter((element) => !element.closest(`[${OPEN_FILE_SKELETON_ATTR}]`))
    .map((element) => element.textContent?.trim() ?? '')
    .filter((name) => name.length > 0);
}

function syncFromFileDisplay(root: Document, allowClear: boolean): void {
  const area = root.getElementById('file-display-area');
  if (!area || observedRoot !== root) return;

  const names = displayedFileNames(area);

  if (names.length === 0) {
    if (!allowClear) return;
    const fileList = root.getElementById('file-list');
    if (fileList && fileList.childElementCount > 0) return;
    if (currentFiles.length === 0) return;
    setWorkspaceFiles([], root);
    return;
  }

  if (sameNames(names, currentFiles)) return;

  const resolved = names.flatMap((name) => {
    const file = resolveDisplayedFile(name, root);
    return file ? [file] : [];
  });

  // Every displayed row was unrecognisable. The scrape is a best-effort read of
  // markup each tool owns, so trust the selection we already have rather than
  // replacing it with rows we cannot back with bytes.
  if (resolved.length === 0) return;

  setWorkspaceFiles(resolved, root);
}

/**
 * Match a displayed row back to the file it stands for.
 *
 * `.truncate` is a layout class, so the scrape also picks up whatever else a
 * tool truncates in its file area — a page label, a status line, or a node whose
 * textContent was assigned an undefined value and therefore reads "undefined".
 * Anything that cannot be matched to real bytes is dropped: a selection entry
 * without a blob is invisible to persistence, so letting one in loses the file
 * it displaced from the stored selection.
 */
function resolveDisplayedFile(
  name: string,
  root: Document
): WorkspaceFileInfo | File | null {
  const selected = currentFiles.find(
    (file) => file.name === name && file.blob instanceof File
  );
  if (selected) return selected;

  const fromState = state.files.find((file) => file.name === name);
  if (fromState) return fromState;

  const input = root.getElementById('file-input') as HTMLInputElement | null;
  return (
    Array.from(input?.files ?? []).find((file) => file.name === name) ?? null
  );
}

function sameNames(names: string[], files: WorkspaceFileInfo[]): boolean {
  return (
    names.length === files.length &&
    names.every((name, index) => files[index]?.name === name)
  );
}

function myPdfsHref(root: Document): string {
  const nav = root.querySelector<HTMLAnchorElement>('a[data-nav="my-pdfs"]');
  return nav?.getAttribute('href')?.trim() || 'my-pdfs.html';
}

function focusSelectedLibraryFile(root: Document): void {
  const selected =
    root.querySelector<HTMLElement>('.shift-open-file-thumb.is-selected') ??
    root.querySelector<HTMLElement>('.shift-my-pdfs-row.is-selected');
  selected?.scrollIntoView({ block: 'nearest' });
  selected?.focus();
}

function createFileButton(
  file: WorkspaceFileInfo,
  root: Document
): HTMLAnchorElement {
  const link = root.createElement('a');
  link.className = 'shift-nav-link shift-open-file-item is-selected';
  link.href = myPdfsHref(root);
  link.dataset.fileName = file.name;
  link.dataset.source = file.source;
  link.setAttribute('aria-label', sidebarFileAriaLabel(file));
  link.setAttribute('aria-current', 'true');
  if (file.source === 'handoff') {
    attachShiftTooltip(link, {
      placement: 'right',
      text: sidebarFileTooltip(file),
    });
    link.setAttribute('data-i18n-tooltip', 'home.fromShiftHandoffTooltip');
  } else if (file.source === 'download') {
    attachShiftTooltip(link, {
      placement: 'right',
      text: sidebarFileTooltip(file),
    });
  }
  link.append(
    createOpenFilePreview(file, root),
    createLabel(file.name, root),
    createSelectedFileChip(root, 'shift-open-file-selected-label')
  );
  link.addEventListener('click', (event) => {
    if (!root.getElementById('shift-my-pdfs')) return;
    event.preventDefault();
    focusSelectedLibraryFile(root);
  });
  return link;
}

/* Name and byte size only: a file restored from the open-file store is rebuilt
   from its buffer, so timestamps differ on every page load and would defeat the
   cache exactly where it matters most — navigating between tools. */
function sidebarThumbnailKey(file: WorkspaceFileInfo): string {
  return `${file.name}|${file.size ?? file.blob?.size ?? 0}`;
}

function readSidebarThumbnailStore(): Map<string, string> {
  if (sidebarThumbnailDataUrls) return sidebarThumbnailDataUrls;

  sidebarThumbnailDataUrls = new Map();
  try {
    const raw = sessionStorage.getItem(SIDEBAR_THUMB_STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        // Session storage is user-writable, so only adopt values that can be
        // safely interpolated into a CSS url().
        if (typeof value === 'string' && SIDEBAR_THUMB_DATA_URL.test(value)) {
          sidebarThumbnailDataUrls.set(key, value);
        }
      }
    }
  } catch {
    // Private mode and corrupt payloads both just mean "no cache".
  }
  return sidebarThumbnailDataUrls;
}

function rememberSidebarThumbnail(
  key: string,
  canvas: HTMLCanvasElement
): void {
  sidebarThumbnailCanvases.set(key, canvas);
  pruneOldest(sidebarThumbnailCanvases);
  if (!sidebarThumbnailsSerializable) return;

  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    sidebarThumbnailsSerializable = false;
    return;
  }
  if (!SIDEBAR_THUMB_DATA_URL.test(dataUrl)) {
    // Environments without canvas serialization (or a tainted canvas) can still
    // use the in-memory cache; stop asking them for bitmaps.
    sidebarThumbnailsSerializable = false;
    return;
  }

  const store = readSidebarThumbnailStore();
  store.set(key, dataUrl);
  pruneOldest(store);
  try {
    sessionStorage.setItem(
      SIDEBAR_THUMB_STORE_KEY,
      JSON.stringify(Object.fromEntries(store))
    );
  } catch {
    // Quota or private mode: the in-memory cache still prevents flashing.
  }
}

function pruneOldest(cache: Map<string, unknown>): void {
  while (cache.size > SIDEBAR_THUMB_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function clearSidebarThumbnailCache(): void {
  sidebarThumbnailCanvases.clear();
  sidebarThumbnailDataUrls = null;
  try {
    sessionStorage.removeItem(SIDEBAR_THUMB_STORE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

function createOpenFilePreview(
  file: WorkspaceFileInfo,
  root: Document
): HTMLSpanElement {
  const preview = root.createElement('span');
  preview.className = 'shift-nav-icon shift-open-file-preview is-empty';
  preview.setAttribute('aria-hidden', 'true');

  const key = sidebarThumbnailKey(file);
  const painted = sidebarThumbnailCanvases.get(key);
  // A detached painted canvas keeps its bitmap, so re-adopting the node shows
  // the thumbnail in the same frame the button is inserted.
  const canvas =
    painted && !painted.isConnected ? painted : root.createElement('canvas');
  canvas.className = 'shift-open-file-preview-canvas';

  const storedDataUrl = readSidebarThumbnailStore().get(key);
  if (storedDataUrl) {
    preview.style.backgroundImage = `url("${storedDataUrl}")`;
  }
  if (canvas === painted || storedDataUrl) {
    preview.classList.remove('is-empty');
  }

  const icon = createFileIcon(file.source, root);
  icon.classList.remove('shift-nav-icon');
  icon.classList.add('shift-open-file-icon-fallback');

  preview.append(canvas, icon);
  return preview;
}

async function fillSidebarThumbnails(
  root: Document,
  files: WorkspaceFileInfo[]
): Promise<void> {
  const token = sidebarThumbnailToken;
  const list = root.getElementById('shift-open-files-list');
  if (!list) return;

  for (const file of files) {
    if (token !== sidebarThumbnailToken) return;
    const button = findSidebarFileButton(list, file.name);
    const preview = button?.querySelector<HTMLElement>(
      '.shift-open-file-preview'
    );
    const canvas = preview?.querySelector('canvas');
    if (!preview || !canvas || !file.blob) continue;

    const key = sidebarThumbnailKey(file);
    if (sidebarThumbnailCanvases.get(key) === canvas) continue;

    try {
      await renderPdfFirstPage(file.blob, canvas, SIDEBAR_THUMB_MAX_WIDTH);
      if (token !== sidebarThumbnailToken) return;
      rememberSidebarThumbnail(key, canvas);
      preview.classList.remove('is-empty');
    } catch {
      if (!preview.style.backgroundImage) preview.classList.add('is-empty');
    }
  }
}

function findSidebarFileButton(
  list: Element,
  fileName: string
): HTMLElement | null {
  return (
    Array.from(
      list.querySelectorAll<HTMLElement>(
        '.shift-open-file-item:not(.shift-open-files-more)'
      )
    ).find((item) => item.dataset.fileName === fileName) ?? null
  );
}

function sidebarFileTooltip(file: WorkspaceFileInfo): string {
  if (file.source === 'handoff') {
    return 'Received from Shift. Click to open in My PDFs.';
  }
  if (file.source === 'download') {
    return 'Downloaded copy. Click to open in My PDFs.';
  }
  return file.name;
}

function sidebarFileAriaLabel(file: WorkspaceFileInfo): string {
  if (file.source === 'handoff') {
    return `Selected: ${file.name}. Received from Shift. Click to open in My PDFs.`;
  }
  if (file.source === 'download') {
    return `Selected: ${file.name}. Downloaded copy. Click to open in My PDFs.`;
  }
  return `Selected: ${file.name}`;
}

function createHomeFileRow(
  file: WorkspaceFileInfo,
  root: Document
): HTMLTableRowElement {
  const isSelected = isHomeLibraryFileSelected(file);
  const row = root.createElement('tr');
  row.className = 'shift-my-pdfs-row';
  row.classList.toggle('is-selected', isSelected);
  row.dataset.fileName = file.name;
  row.dataset.source = file.source;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `Use ${file.name}`);
  row.setAttribute('aria-pressed', String(isSelected));

  const nameCell = root.createElement('td');
  nameCell.className = 'shift-my-pdfs-name-cell';
  const nameLayout = root.createElement('div');
  nameLayout.className = 'shift-my-pdfs-name';
  const name = root.createElement('span');
  name.textContent = file.name;
  nameLayout.append(createFileIcon(file.source, root), name);
  if (file.source === 'download') {
    nameLayout.appendChild(createDownloadedCopyBadge(root));
  }
  if (!isSelected) {
    nameLayout.appendChild(createHomeFileRowReplaceHint(root));
  }
  nameCell.appendChild(nameLayout);

  const dateCell = root.createElement('td');
  dateCell.textContent = file.addedAt
    ? new Date(file.addedAt).toDateString()
    : '';

  const sizeCell = root.createElement('td');
  sizeCell.textContent = formatFileSize(file.size);

  const actionCell = root.createElement('td');
  actionCell.className = 'shift-my-pdfs-action-cell';
  actionCell.appendChild(createHomeFileDeleteButton(file, root));

  row.append(nameCell, dateCell, sizeCell, actionCell);
  row.addEventListener('click', () => activateHomeLibraryFile(file, root));
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activateHomeLibraryFile(file, root);
  });

  return row;
}

function createHomeFileRowReplaceHint(root: Document): HTMLSpanElement {
  const replaceHint = root.createElement('span');
  replaceHint.className =
    'shift-open-file-thumb-replace shift-my-pdfs-row-replace';
  replaceHint.textContent = 'Use this PDF';
  replaceHint.setAttribute('aria-hidden', 'true');
  return replaceHint;
}

/* The card is a button, so the delete control cannot nest inside it. Both sit
   in a wrapper instead, which becomes the grid item the thumbs list lays out. */
function createHomeFileThumb(
  file: WorkspaceFileInfo,
  root: Document
): HTMLDivElement {
  const isSelected = isHomeLibraryFileSelected(file);
  const card = root.createElement('button');
  card.type = 'button';
  card.className = 'shift-open-file-thumb';
  card.classList.toggle('is-selected', isSelected);
  card.dataset.source = file.source;
  card.dataset.fileName = file.name;
  card.setAttribute('aria-label', `Use ${file.name}`);
  card.setAttribute('aria-pressed', String(isSelected));

  const preview = root.createElement('div');
  preview.className = 'shift-open-file-thumb-preview is-empty';
  const canvas = root.createElement('canvas');
  const replaceHint = root.createElement('span');
  replaceHint.className = 'shift-open-file-thumb-replace';
  replaceHint.textContent = 'Use this PDF';
  preview.append(canvas, replaceHint);

  const meta = root.createElement('div');
  meta.className = 'shift-open-file-thumb-meta';
  const name = root.createElement('span');
  name.className = 'shift-open-file-thumb-name';
  name.textContent = file.name;
  meta.appendChild(name);
  const details = formatFileSize(file.size);
  if (details) {
    const detail = root.createElement('span');
    detail.className = 'shift-open-file-thumb-detail';
    detail.textContent = details;
    meta.appendChild(detail);
  }
  if (file.source === 'download') {
    meta.appendChild(createDownloadedCopyBadge(root));
  }

  card.append(preview, meta);
  if (file.source === 'handoff') {
    attachShiftTooltip(card, {
      placement: 'bottom',
      text: 'Received from Shift. Click to use this PDF.',
    });
  } else if (file.source === 'download') {
    attachShiftTooltip(card, {
      placement: 'bottom',
      text: 'Downloaded copy. Click to use this PDF.',
    });
  }
  card.addEventListener('click', () => {
    activateHomeLibraryFile(file, root);
  });

  const item = root.createElement('div');
  item.className = 'shift-my-pdfs-thumb-item';
  item.append(card, createHomeFileDeleteButton(file, root));
  return item;
}

function createHomeFileDeleteButton(
  file: WorkspaceFileInfo,
  root: Document
): HTMLButtonElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const button = root.createElement('button');
  button.type = 'button';
  button.className = 'shift-my-pdfs-delete';
  button.dataset.fileName = file.name;
  button.setAttribute('aria-label', `Delete ${file.name}`);

  const svg = root.createElementNS(namespace, 'svg');
  svg.setAttribute('class', 'shift-my-pdfs-delete-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = root.createElementNS(namespace, 'path');
  path.setAttribute('d', DELETE_ICON_PATH);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  button.appendChild(svg);

  attachShiftTooltip(button, { placement: 'bottom', text: 'Delete PDF' });
  button.addEventListener('click', (event) => {
    // The row and the card are both clickable, and deleting must not also
    // select the file on the way out.
    event.stopPropagation();
    hideShiftTooltip();
    void deleteHomeLibraryFile(file, root);
  });

  return button;
}

async function deleteHomeLibraryFile(
  file: WorkspaceFileInfo,
  root: Document
): Promise<void> {
  const confirmed = await confirmAction({
    root,
    title: 'Delete this PDF?',
    message: `${file.name} will be removed from My PDFs. This cannot be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!confirmed) return;

  if (file.id) await removePdfFromLibrary(file.id);

  homeLibraryFiles = homeLibraryFiles.filter((entry) =>
    file.id ? entry.id !== file.id : !isSameLibraryFile(entry, file)
  );

  // A deleted PDF cannot stay selected, or tools would keep working from a file
  // the library no longer offers.
  if (isHomeLibraryFileSelected(file)) {
    currentFiles = currentFiles.filter(
      (current) => !isSameLibraryFile(current, file)
    );
    void persistCurrentOpenFile();
  }

  lastRenderedHomeFiles = [];
  renderWorkspaceFiles(root);
}

function isSameLibraryFile(
  left: WorkspaceFileInfo,
  right: WorkspaceFileInfo
): boolean {
  return (
    left.name === right.name &&
    left.size === right.size &&
    left.source === right.source
  );
}

function createSelectedFileChip(
  root: Document,
  className: string
): HTMLSpanElement {
  const chip = root.createElement('span');
  chip.className = className;
  chip.textContent = 'Selected';
  chip.setAttribute('data-i18n-tooltip', 'home.activeFileTooltip');
  attachShiftTooltip(chip, {
    placement: 'bottom',
    text: SELECTED_FILE_TOOLTIP,
  });
  return chip;
}

/* My PDFs uses checkbox-like selection: each click toggles only that PDF while
   preserving every other selected file and their selection order. */
function activateHomeLibraryFile(
  file: WorkspaceFileInfo,
  root: Document
): void {
  if (!file.blob) return;
  if (isHomeLibraryFileSelected(file)) {
    currentFiles = currentFiles.filter(
      (current) => !isSameLibraryFile(current, file)
    );
    void persistCurrentOpenFile();
    renderWorkspaceFiles(root);
    return;
  }

  fileOrigins.set(file.blob, file.source);
  setWorkspaceFiles(
    [
      ...currentFiles
        .map((current) => current.blob)
        .filter((blob): blob is File => blob instanceof File),
      file.blob,
    ],
    root
  );
}

function isHomeLibraryFileSelected(file: WorkspaceFileInfo): boolean {
  return currentFiles.some((current) => isSameLibraryFile(current, file));
}

async function fillHomeThumbnails(
  root: Document,
  files: WorkspaceFileInfo[]
): Promise<void> {
  const token = ++thumbnailRenderToken;
  const thumbs = root.getElementById('shift-my-pdfs-thumbs');
  if (!thumbs) return;

  const cards = homeLibraryThumbCards(thumbs);

  for (const [index, file] of files.entries()) {
    if (token !== thumbnailRenderToken) return;
    const card = cards[index];
    const preview = card?.querySelector<HTMLElement>(
      '.shift-open-file-thumb-preview'
    );
    const canvas = preview?.querySelector('canvas');
    if (!preview || !canvas || !file.blob) continue;
    // Already painted — skip so selection/reuse re-renders do not redraw.
    if (!preview.classList.contains('is-empty')) continue;

    try {
      await renderPdfFirstPage(file.blob, canvas);
      // Clear is-empty before the cancellation check. A newer fill may bump the
      // token after pixels land; leaving is-empty would hide those pixels via CSS
      // (`.is-empty canvas { display: none }`) even though the canvas painted.
      preview.classList.remove('is-empty');
      if (token !== thumbnailRenderToken) return;
    } catch {
      if (token !== thumbnailRenderToken) return;
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

function createDownloadedCopyBadge(root: Document): HTMLSpanElement {
  const badge = root.createElement('span');
  badge.className = 'shift-my-pdfs-source-badge';
  badge.textContent = 'Downloaded copy';
  return badge;
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
      : source === 'download'
        ? 'shift-nav-icon shift-open-file-icon-download'
        : 'shift-nav-icon shift-open-file-icon-upload'
  );
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = root.createElementNS(namespace, 'path');
  path.setAttribute(
    'd',
    source === 'handoff'
      ? HANDOFF_ICON_PATH
      : source === 'download'
        ? DOWNLOAD_ICON_PATH
        : UPLOAD_ICON_PATH
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
