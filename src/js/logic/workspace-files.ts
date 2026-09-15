import { state } from '../state.js';
import { renderPdfFirstPage } from '../utils/pdf-thumbnail.js';
import { confirmAction } from './confirm-dialog.js';
import {
  addPdfToLibrary,
  readPdfLibrary,
  removePdfFromLibrary,
} from './pdf-library-store.js';
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
import { loadFavoriteRailSnapshot } from './tool-favorites.js';
import { categories } from '../config/tools.js';
import { isPdfFile } from '../utils/pdf-file.js';

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
const MY_PDFS_TABLE_SELECT_ALL_ID = 'shift-my-pdfs-table-select-all';
const MY_PDFS_SELECTION_COUNT_ID = 'shift-my-pdfs-selection-count';
const MY_PDFS_DELETE_SELECTED_ID = 'shift-my-pdfs-delete-selected';
const MY_PDFS_MORE_TOOLS_ID = 'shift-my-pdfs-more-tools';
const MY_PDFS_MORE_TOOLS_MENU_ID = 'shift-my-pdfs-more-tools-menu';
const MORE_TOOLS_CARET_PATH = 'm6 9.5 6 6 6-6';
const MAX_OPEN_WITH_FAVORITES = 3;

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
/** Stable My PDFs ids attached to File blobs so selection can round-trip. */
const fileLibraryIds = new WeakMap<File, string>();

/* A rebuilt sidebar must never show the placeholder icon again for a PDF it has
   already drawn: re-rendering takes ~100ms, which reads as a flash. Painted
   canvases are kept per document so a rebuild can re-adopt the live node, and
   their bitmaps are mirrored into session storage so the first paint after a
   navigation already carries the thumbnail. */
const sidebarThumbnailCanvases = new Map<string, HTMLCanvasElement>();
let sidebarThumbnailDataUrls: Map<string, string> | null = null;
let sidebarThumbnailsSerializable = true;

/* Blobs already offered to the library, so repeat renders of the same
   selection do not re-hash them. */
const adoptedIntoLibrary = new WeakSet<File>();

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
const myPdfsSelectionDelegated = new WeakSet<Document>();

/* Pinned-favorite overflow. Kept at module scope because a resize has to
   re-measure a row nobody is rebuilding. */
let favoriteOverflowObserver: ResizeObserver | null = null;
let observedControlsRow: HTMLElement | null = null;
let lastControlsRowWidth = -1;
let collapsedFavoriteKey = '';
let measuringFavoriteOverflow = false;

export function markFileFromHandoff(file: File): File {
  fileOrigins.set(file, 'handoff');
  return file;
}

export function markFileFromDownload(file: File): File {
  fileOrigins.set(file, 'download');
  return file;
}

export function markFileLibraryId(file: File, id: string): File {
  if (id) fileLibraryIds.set(file, id);
  return file;
}

export function getLibraryIdForFile(file: File): string | undefined {
  return fileLibraryIds.get(file);
}

export function copyFileOrigin(from: File, to: File): File {
  const origin = fileOrigins.get(from);
  if (origin) fileOrigins.set(to, origin);
  const libraryId = fileLibraryIds.get(from);
  if (libraryId) fileLibraryIds.set(to, libraryId);
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
  adoptSelectionIntoLibrary(root);
  renderWorkspaceFiles(root);
}

export async function syncHomeLibraryFromStore(
  root: Document = document,
  epoch: number = homeLibraryEpoch
): Promise<void> {
  const entries = await readPdfLibrary();
  setHomeLibraryFiles(
    entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      size: entry.size,
      source: entry.source,
      addedAt: entry.addedAt,
      blob: entry.file,
    })),
    root,
    epoch
  );
  if (epoch === homeLibraryEpoch) {
    reconcileWorkspaceLibraryIds();
  }
}

/**
 * Keep the sidebar and My PDFs in agreement: anything shown as selected must
 * have a library record behind it.
 *
 * Home uploads save themselves in addOpenFiles, but tool pages set the
 * workspace straight from their own pickers and drop zones, so a file opened
 * inside a tool used to reach the sidebar and nothing else. Saving the tool's
 * output then added a library row for the result only, which read as the
 * original being replaced. Every path that fills the sidebar ends up here, so
 * this is the one place the invariant can hold for all of them.
 */
function adoptSelectionIntoLibrary(root: Document): void {
  const pending = currentFiles.filter(
    (file): file is WorkspaceFileInfo & { blob: File } =>
      file.blob instanceof File &&
      isPdfBlob(file.blob) &&
      !adoptedIntoLibrary.has(file.blob) &&
      !homeLibraryFiles.some(
        (entry) => entry.name === file.name && entry.size === file.size
      )
  );
  if (pending.length === 0) return;

  // Claim them before the first await: setWorkspaceFiles fires several times
  // in a tick, and each pass would otherwise re-hash the same blobs.
  for (const file of pending) adoptedIntoLibrary.add(file.blob);

  // Adds run in series so each one sees the previous write and can dedupe
  // against it. The epoch is captured now so a reset or delete mid-flight
  // discards the refresh — and rolls back any write that finished after the
  // user already removed the PDF, which is how a ghost used to reappear.
  const epoch = homeLibraryEpoch;
  void (async () => {
    for (const file of pending) {
      const saved = await addPdfToLibrary(file.blob, file.source);
      // Delete bumps the epoch. Only roll back this write when the PDF is
      // gone from both the grid and the selection — a sibling that is still
      // selected must stay, or deleting one in-flight file would abandon the
      // other (and `adoptedIntoLibrary` would never retry it).
      if (epoch !== homeLibraryEpoch && !isLibraryFileCurrent(file)) {
        await removePdfFromLibrary(saved.id);
        continue;
      }
      markFileLibraryId(file.blob, saved.id);
      const selected = currentFiles.find((entry) =>
        isSameLibraryFile(entry, file)
      );
      if (selected) selected.id = saved.id;
    }
    // Always refresh against the live epoch so remaining files paint after a
    // sibling was deleted; a captured epoch would no-op and leave them only
    // in IndexedDB until the next reload.
    await syncHomeLibraryFromStore(root, homeLibraryEpoch);
  })();
}

function isPdfBlob(file: File): boolean {
  return isPdfFile(file);
}

export function setWorkspaceFilesFromTool(
  files: File[],
  root: Document = document
): void {
  if (getWorkspaceFiles().length > files.length) return;
  setWorkspaceFiles(files, root);
}

export function getHomeOpenFileView(): HomeOpenFileView {
  return homeFileView;
}

function persistCurrentOpenFile(): Promise<void> {
  if (currentFiles.length === 0) return clearPersistedOpenFile();
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
      ...(file.id ? { libraryId: file.id } : {}),
    }))
  );
}

export function persistWorkspaceOpenFile(): Promise<void> {
  return persistCurrentOpenFile();
}

export async function openLibraryFileInViewer(
  file: WorkspaceFileInfo,
  root: Document = document,
  assignLocation: (href: string) => void = (href) =>
    window.location.assign(href)
): Promise<boolean> {
  const href = viewPdfHref(root, file);
  if (!href) return false;
  assignLocation(href);
  return true;
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
  favoriteOverflowObserver?.disconnect();
  favoriteOverflowObserver = null;
  observedControlsRow = null;
  lastControlsRowWidth = -1;
  collapsedFavoriteKey = '';
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

  renderOpenWithFavorites(root, tools);
  // Forced: different pins and a longer selection count both change the fit
  // without changing the width the observer watches.
  syncOpenWithFavoriteOverflow(root, true);

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

  // Its items open the selected PDF, so it follows the row it belongs to.
  const moreTools = root.getElementById(
    MY_PDFS_MORE_TOOLS_ID
  ) as HTMLButtonElement | null;
  if (moreTools) {
    moreTools.disabled = !hasSelection;
    if (!hasSelection) setMoreToolsExpanded(root, false);
  }

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
 * The Open-with row is the user's favorites, so it follows whatever the star
 * buttons saved. The page markup ships the seeded four as a no-JS fallback;
 * this replaces them once the rail cache is readable, and leaves the row alone
 * when nothing is cached yet so the fallback never blanks out. Only the first
 * few fit beside Delete, so the rest stay in the sidebar rail.
 */
function renderOpenWithFavorites(root: Document, tools: HTMLElement): void {
  const toggle = tools.querySelector<HTMLElement>(
    '.shift-open-file-tools-toggle'
  );
  if (!toggle) return;

  const favorites = loadFavoriteRailSnapshot().slice(
    0,
    MAX_OPEN_WITH_FAVORITES
  );
  if (favorites.length === 0) return;

  const existing = Array.from(
    toggle.querySelectorAll<HTMLAnchorElement>('a.shift-open-file-tool-btn')
  );
  const unchanged =
    existing.length === favorites.length &&
    favorites.every(
      (favorite, index) =>
        existing[index]?.getAttribute('href') === favorite.href &&
        existing[index]?.textContent === favorite.name
    );
  if (unchanged) return;

  const links = favorites.map((favorite) => {
    const link = root.createElement('a');
    link.className = 'shift-open-file-tool-btn';
    link.href = favorite.href;
    link.dataset.tool = openWithToolId(favorite.href);
    link.textContent = favorite.name;
    return link;
  });

  existing.forEach((link) => link.remove());
  // Delete is appended to the same toggle, so favorites go in front of it.
  toggle.prepend(...links);
  // The menu lists what the row left out, so it has to follow the row.
  refreshMoreToolsMenu(root);
}

/**
 * Priority+ overflow for the pinned favorites: drop them from the end, but
 * only once there is genuinely no room for them, so narrowing costs the
 * fewest shortcuts it can. Nothing is lost by dropping one — the More tools
 * menu lists whatever the row is not showing.
 */
function syncOpenWithFavoriteOverflow(root: Document, force = false): void {
  // Hiding a pin resizes the row, which calls straight back in here.
  if (measuringFavoriteOverflow) return;

  const toggle = root.querySelector<HTMLElement>(
    '.shift-open-file-tools-toggle'
  );
  const row =
    toggle?.closest<HTMLElement>('.shift-my-pdfs-controls-row') ?? null;
  if (!toggle || !row) return;

  const links = Array.from(
    toggle.querySelectorAll<HTMLAnchorElement>('a.shift-open-file-tool-btn')
  );
  if (links.length === 0) return;

  const width = row.clientWidth;
  // Zero means the row has no layout yet (jsdom, or chrome built before the
  // first paint). Measuring against that would read as "nothing fits" and
  // collapse every pin on a screen with room to spare.
  if (width === 0) return;
  // Height also changes as pins drop, so the observer fires again on a row
  // whose width — the only input here — is the same as last time.
  if (!force && width === lastControlsRowWidth) return;
  lastControlsRowWidth = width;

  measuringFavoriteOverflow = true;
  try {
    // Measure up from every pin shown, so widening restores them.
    for (const link of links) link.hidden = false;
    for (let index = links.length - 1; index >= 0; index -= 1) {
      if (favoritePinsFit(row, toggle)) break;
      links[index].hidden = true;
    }
  } finally {
    measuringFavoriteOverflow = false;
  }

  const collapsed = links
    .filter((link) => link.hidden)
    .map((link) => link.dataset.tool ?? link.getAttribute('href') ?? '')
    .join('|');
  // Rebuilding the menu on every resize tick would fight an open menu.
  if (collapsed === collapsedFavoriteKey) return;
  collapsedFavoriteKey = collapsed;
  refreshMoreToolsMenu(root);
}

/**
 * The row never wraps, so it rarely overflows either: the selection count is
 * the flexible half and gives up its own width first. That makes the count
 * being cut short the honest signal that a pin has taken space there is not
 * — and it only goes short once every other part of the row is at its
 * natural size, so nothing collapses while there is still room.
 */
function favoritePinsFit(row: HTMLElement, toggle: HTMLElement): boolean {
  if (row.scrollWidth > row.clientWidth + 1) return false;

  const count = row.querySelector<HTMLElement>(
    '.shift-my-pdfs-selection-count'
  );
  if (count && count.scrollWidth > count.clientWidth + 1) return false;

  return isSingleLine(toggle);
}

/**
 * Tolerant by necessity: `align-items: center` leaves controls of unequal
 * height a few pixels apart on the same line, so exact offsets would read a
 * centered row as wrapped and collapse a pin that fits. A real second line
 * is a whole control further down, hence the half-height threshold.
 */
function isSingleLine(host: HTMLElement): boolean {
  const visible = (Array.from(host.children) as HTMLElement[]).filter(
    (child) => !child.hidden
  );
  if (visible.length < 2) return true;

  const tolerance =
    Math.max(...visible.map((child) => child.offsetHeight), 0) / 2;
  const top = visible[0].offsetTop;
  return visible.every((child) => Math.abs(child.offsetTop - top) <= tolerance);
}

/**
 * The row is as wide as the panel regardless of what it holds, so a resize is
 * the only signal that the fit changed. Re-observed when the chrome is
 * rebuilt, because that replaces the node this is watching.
 */
function observeFavoriteOverflow(root: Document): void {
  const row = root.querySelector<HTMLElement>('.shift-my-pdfs-controls-row');
  if (!row || row === observedControlsRow) return;
  if (typeof ResizeObserver === 'undefined') return;

  favoriteOverflowObserver?.disconnect();
  observedControlsRow = row;
  lastControlsRowWidth = -1;
  favoriteOverflowObserver = new ResizeObserver(() =>
    syncOpenWithFavoriteOverflow(root)
  );
  favoriteOverflowObserver.observe(row);
}

/**
 * Only MAX_OPEN_WITH_FAVORITES pins fit beside Delete, so the overflow needs a
 * way in from here rather than only from the sidebar rail. Sits between the
 * last tool and Delete because it belongs to the tools, not to the
 * destructive action.
 */
function ensureMyPdfsMoreTools(root: Document): void {
  if (root.getElementById(MY_PDFS_MORE_TOOLS_ID)) return;

  const deleteSelected = root.getElementById(MY_PDFS_DELETE_SELECTED_ID);
  const toggle = deleteSelected?.parentElement;
  if (!deleteSelected || !toggle) return;

  // Wrapper so the menu can anchor to the button instead of the whole row.
  const wrap = root.createElement('div');
  wrap.className = 'shift-my-pdfs-more-tools-wrap';

  const button = root.createElement('button');
  button.type = 'button';
  button.id = MY_PDFS_MORE_TOOLS_ID;
  // Secondary, like Delete: it opens a menu rather than acting on the file,
  // so it should not compete with the blue tool shortcuts beside it.
  button.className = 'shift-button shift-my-pdfs-more-tools';
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', MY_PDFS_MORE_TOOLS_MENU_ID);
  button.setAttribute('aria-label', 'More tools');
  button.disabled = currentFiles.length === 0;
  button.append(root.createTextNode('More'), createMoreToolsCaret(root));

  const menu = root.createElement('div');
  menu.id = MY_PDFS_MORE_TOOLS_MENU_ID;
  menu.className = 'shift-my-pdfs-more-tools-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-labelledby', MY_PDFS_MORE_TOOLS_ID);
  menu.hidden = true;

  wrap.append(button, menu);
  toggle.insertBefore(wrap, deleteSelected);
  renderMoreToolsMenu(root, menu);

  // Bound here rather than alongside the other controls because those bind
  // once per document, and this pair is created with the button it drives.
  button.addEventListener('click', (event) => {
    // The dismiss listener would otherwise close it in this same click.
    event.stopPropagation();
    // The menu drops into the space the tooltip occupies, so one has to go.
    hideShiftTooltip(root);
    setMoreToolsExpanded(root, menu.hidden);
  });
  menu.addEventListener('click', () => setMoreToolsExpanded(root, false));
}

function createMoreToolsCaret(root: Document): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = root.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'shift-my-pdfs-more-tools-caret');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = root.createElementNS(svgNs, 'path');
  path.setAttribute('d', MORE_TOOLS_CARET_PATH);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

/**
 * Overflow favorites first, since those are the tools the user chose, then
 * the popular tools. Whatever the row already shows is skipped so the same
 * tool never appears twice. Deliberately not the whole catalog: this is a
 * shortlist, and Browse all tools below it is the way to everything else.
 */
function moreToolsEntries(root: Document): { name: string; href: string }[] {
  // Only what the row is actually showing counts as listed: a pin collapsed
  // for width is exactly the thing this menu exists to hand back.
  const listed = new Set(
    Array.from(
      root.querySelectorAll<HTMLAnchorElement>(
        '.shift-open-file-tools-toggle a.shift-open-file-tool-btn:not([hidden])'
      )
    ).map((link) => openWithToolId(link.getAttribute('href') ?? ''))
  );

  const entries: { name: string; href: string }[] = [];
  const add = (name: string, href: string): void => {
    const id = openWithToolId(href);
    if (listed.has(id)) return;
    listed.add(id);
    entries.push({ name, href });
  };

  for (const pin of loadFavoriteRailSnapshot()) add(pin.name, pin.href);
  // By name rather than by index: the menu is meant to hold the popular
  // tools specifically, not whichever category happens to be listed first.
  const popular =
    categories.find((category) => category.name === 'Popular Tools') ??
    categories[0];
  for (const tool of popular?.tools ?? []) add(tool.name, tool.href);

  return entries;
}

function renderMoreToolsMenu(root: Document, menu: HTMLElement): void {
  menu.replaceChildren();

  // The tools scroll inside this while Browse all tools stays pinned below
  // it. `role="none"` keeps the items direct children of the menu as far as
  // assistive tech is concerned, so the wrapper costs nothing semantically.
  const list = root.createElement('div');
  list.className = 'shift-my-pdfs-more-tools-list';
  list.setAttribute('role', 'none');

  for (const entry of moreToolsEntries(root)) {
    const link = root.createElement('a');
    link.className = 'shift-my-pdfs-more-tools-item';
    link.href = entry.href;
    link.dataset.tool = openWithToolId(entry.href);
    link.setAttribute('role', 'menuitem');
    link.textContent = entry.name;
    list.appendChild(link);
  }
  menu.appendChild(list);

  const browse = root.createElement('a');
  browse.className =
    'shift-my-pdfs-more-tools-item shift-my-pdfs-more-tools-browse';
  browse.href = `${import.meta.env.BASE_URL}all-tools.html`;
  browse.setAttribute('role', 'menuitem');
  browse.textContent = 'Browse all tools';
  menu.appendChild(browse);
}

function refreshMoreToolsMenu(root: Document): void {
  const menu = root.getElementById(MY_PDFS_MORE_TOOLS_MENU_ID);
  if (menu) renderMoreToolsMenu(root, menu);
}

function setMoreToolsExpanded(root: Document, expanded: boolean): void {
  const button = root.getElementById(
    MY_PDFS_MORE_TOOLS_ID
  ) as HTMLButtonElement | null;
  const menu = root.getElementById(MY_PDFS_MORE_TOOLS_MENU_ID);
  if (!button || !menu) return;

  const open = expanded && !button.disabled;
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

/**
 * Dismissal only: the button's own handlers are bound where it is built.
 * These look the menu up per event rather than closing over it, because they
 * bind once per document while the chrome can be rebuilt underneath them.
 */
function bindMyPdfsMoreTools(root: Document): void {
  root.addEventListener('click', (event) => {
    if (root.getElementById(MY_PDFS_MORE_TOOLS_MENU_ID)?.hidden !== false)
      return;
    const inside = (event.target as HTMLElement | null)?.closest(
      '.shift-my-pdfs-more-tools-wrap'
    );
    if (inside) return;
    setMoreToolsExpanded(root, false);
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (root.getElementById(MY_PDFS_MORE_TOOLS_MENU_ID)?.hidden !== false)
      return;
    setMoreToolsExpanded(root, false);
    root.getElementById(MY_PDFS_MORE_TOOLS_ID)?.focus();
  });
}

function openWithToolId(href: string): string {
  return (
    href
      .split('/')
      .pop()
      ?.replace(/\.html$/, '') ?? href
  );
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
  ensureMyPdfsMoreTools(root);
  ensureMyPdfsViewToggle(root);
  observeFavoriteOverflow(root);

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

  // List and grid share one scrollport so the chrome above stays put.
  ensureMyPdfsScrollPane(root, section);

  if (myPdfsChromeBoundRoot === root) return;
  myPdfsChromeBoundRoot = root;
  bindMyPdfsSelectionControls(root);
}

/**
 * Wrap the table and thumbnail grid in a flex child that owns overflow-y.
 * Leaving them as siblings made the table itself the scrollport, which forced
 * `display: block` and collapsed the auto-sized Date/Size columns.
 */
function ensureMyPdfsScrollPane(root: Document, section: HTMLElement): void {
  const table = section.querySelector(
    '.shift-my-pdfs-table'
  ) as HTMLElement | null;
  const thumbs = root.getElementById('shift-my-pdfs-thumbs');
  if (!table && !thumbs) return;

  let pane = section.querySelector(
    '.shift-my-pdfs-scroll'
  ) as HTMLElement | null;
  if (!pane) {
    pane = root.createElement('div');
    pane.className = 'shift-my-pdfs-scroll';
  }

  const alreadyWrapped =
    (!table || pane.contains(table)) && (!thumbs || pane.contains(thumbs));
  if (alreadyWrapped && pane.parentElement === section) return;

  const anchor =
    table && table.parentElement !== pane
      ? table
      : thumbs && thumbs.parentElement !== pane
        ? thumbs
        : (table ?? thumbs);
  if (pane.parentElement !== section && anchor) {
    anchor.insertAdjacentElement('beforebegin', pane);
  }

  if (table && table.parentElement !== pane) pane.appendChild(table);
  if (thumbs && thumbs.parentElement !== pane) pane.appendChild(thumbs);
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
    const cluster = root.createElement('div');
    cluster.className = 'shift-my-pdfs-controls-cluster';
    const actions = root.createElement('div');
    actions.className = 'shift-my-pdfs-actions';

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

    // Right cluster: tools then View by (wrap together, never View by alone).
    cluster.appendChild(actions);
    if (viewBy) cluster.appendChild(viewBy);
    row.append(selection, cluster);

    controls.appendChild(row);

    const scroll = section.querySelector('.shift-my-pdfs-scroll');
    const table = section.querySelector('.shift-my-pdfs-table');
    const thumbs = root.getElementById('shift-my-pdfs-thumbs');
    if (scroll) scroll.insertAdjacentElement('beforebegin', controls);
    else if (table) table.insertAdjacentElement('beforebegin', controls);
    else if (thumbs) thumbs.insertAdjacentElement('beforebegin', controls);
    else section.appendChild(controls);

    // Keep the page title; only discard the old header wrapper/controls.
    if (legacyHeader && heading) {
      legacyHeader.replaceWith(heading);
    } else {
      legacyHeader?.remove();
    }
  }

  groupMyPdfsActionsAndViewBy(root, controls);
  return controls;
}

/**
 * Keep library tools + View by in one flex item so neither can be separated
 * from the other as the row narrows (`margin-left: auto` used to strand View
 * by on its own line).
 */
function groupMyPdfsActionsAndViewBy(
  root: Document,
  controls: HTMLElement
): void {
  const row =
    (controls.querySelector(
      '.shift-my-pdfs-controls-row'
    ) as HTMLElement | null) ?? controls;

  let cluster = row.querySelector(
    '.shift-my-pdfs-controls-cluster'
  ) as HTMLElement | null;
  if (!cluster) {
    cluster = root.createElement('div');
    cluster.className = 'shift-my-pdfs-controls-cluster';
  }

  const actions = row.querySelector(
    '.shift-my-pdfs-actions'
  ) as HTMLElement | null;
  const viewBy =
    (row.querySelector(
      ':scope > .shift-open-file-view-by'
    ) as HTMLElement | null) ??
    (controls.querySelector('.shift-open-file-view-by') as HTMLElement | null);

  if (actions && !cluster.contains(actions)) {
    if (!cluster.parentElement) {
      actions.replaceWith(cluster);
    }
    cluster.appendChild(actions);
  } else if (!cluster.parentElement) {
    const selection = row.querySelector('.shift-my-pdfs-selection');
    if (selection) selection.insertAdjacentElement('afterend', cluster);
    else row.appendChild(cluster);
  }

  if (viewBy && !cluster.contains(viewBy)) {
    cluster.appendChild(viewBy);
  }
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
  bindMyPdfsMoreTools(root);

  // Once per document: reset remounts the buttons but keeps this Document.
  // A second delegated listener would toggle select-all twice (select then
  // deselect) and look like the library had no selection.
  if (myPdfsSelectionDelegated.has(root)) return;
  myPdfsSelectionDelegated.add(root);

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('#shift-open-file-tools a[aria-disabled="true"]')) {
      event.preventDefault();
      return;
    }
    if (target?.closest(`#${MY_PDFS_SELECT_ALL_ID}`)) {
      toggleSelectAllVisible(root);
      return;
    }
    if (target?.closest(`#${MY_PDFS_TABLE_SELECT_ALL_ID}`)) {
      toggleSelectAllVisible(root);
      return;
    }
    if (target?.closest(`#${MY_PDFS_DELETE_SELECTED_ID}`)) {
      void deleteSelectedHomeLibraryFiles(root);
    }
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
  const selectedVisible = visible.filter((file) =>
    isHomeLibraryFileSelected(file)
  ).length;
  // The label follows the click: a partial selection clears, so it reads
  // Deselect all from the first selected file onwards, not only when full.
  selectAll.textContent = selectedVisible > 0 ? 'Deselect all' : 'Select all';
  selectAll.disabled = visible.length === 0;

  const tableSelectAll = root.getElementById(
    MY_PDFS_TABLE_SELECT_ALL_ID
  ) as HTMLInputElement | null;
  if (tableSelectAll) {
    // Empty list rows have their own checkboxes; this one is only useful once
    // something is already selected, and its only job then is to clear it.
    tableSelectAll.hidden = selectedVisible === 0;
    /* So it shows the dash for any non-empty selection, full included. A tick
       there would say "all selected" — a state, when this control is an
       action, and the one it offers is the same Deselect all the button above
       names. */
    tableSelectAll.checked = false;
    tableSelectAll.indeterminate = selectedVisible > 0;
    tableSelectAll.disabled = visible.length === 0;
    tableSelectAll.setAttribute(
      'aria-label',
      selectedVisible > 0 ? 'Deselect all PDFs' : 'Select all PDFs'
    );
  }
}

function toggleSelectAllVisible(root: Document): void {
  const visible = visibleHomeLibraryFiles().filter(
    (file) => file.blob instanceof File
  );
  if (visible.length === 0) return;

  /* A partial selection clears rather than filling in the rest: from a half
     state the useful move is starting over, and selecting the remainder would
     leave no way back to empty in one click. */
  const anyVisibleSelected = visible.some((file) =>
    isHomeLibraryFileSelected(file)
  );

  if (anyVisibleSelected) {
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
    if (file.blob) {
      fileOrigins.set(file.blob, file.source);
      if (file.id) markFileLibraryId(file.blob, file.id);
    }
  }
  setWorkspaceFiles(
    [
      ...kept.map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        source: file.source,
        addedAt: file.addedAt,
        blob: file.blob,
      })),
      ...visible.map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        source: file.source,
        addedAt: file.addedAt,
        blob: file.blob,
      })),
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

  // Invalidate in-flight adopts/syncs before touching the store so a write
  // that started with these files selected cannot paint them back.
  homeLibraryEpoch += 1;

  for (const file of selected) {
    await removeLibraryFileFromStore(file);
    homeLibraryFiles = homeLibraryFiles.filter(
      (entry) => !isSameLibraryFile(entry, file)
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
      return isPdfFile(file);
    }
    if (token.startsWith('.')) {
      return file.name.toLowerCase().endsWith(token);
    }
    return file.type === token;
  });
}

export function pickerAcceptsPdf(root: Document = document): boolean {
  const input = getActiveFileInput(root) ?? findToolFileInput(root);
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
  if (homeLibraryFiles.length === 0) return false;
  return currentFiles.length > 0;
}

function isHomePage(root: Document): boolean {
  return (
    Boolean(root.getElementById('shift-my-pdfs')) && !isInPageToolActive(root)
  );
}

export function isInPageToolActive(root: Document = document): boolean {
  const tool = root.getElementById('tool-interface');
  return Boolean(tool && !tool.classList.contains('hidden'));
}

export function getActiveFileInput(
  root: Document = document
): HTMLInputElement | null {
  if (isInPageToolActive(root)) {
    return root.querySelector<HTMLInputElement>(
      '#tool-interface input#file-input'
    );
  }
  return root.querySelector<HTMLInputElement>('input#file-input');
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
      const checkbox = row.querySelector<HTMLInputElement>(
        '.shift-my-pdfs-checkbox'
      );
      if (checkbox) checkbox.checked = isSelected;
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
    const libraryId =
      fileLibraryIds.get(file) ?? existing?.id ?? resolveLibraryIdForBlob(file);
    if (libraryId) markFileLibraryId(file, libraryId);
    return {
      id: libraryId,
      name,
      size: file.size,
      source: origin ?? 'upload',
      addedAt: existing?.addedAt ?? Date.now(),
      blob: file,
    };
  }

  if (file.blob instanceof File && file.id) {
    markFileLibraryId(file.blob, file.id);
  }

  return {
    id: file.id ?? (file.blob ? fileLibraryIds.get(file.blob) : undefined),
    name,
    size: typeof file.size === 'number' ? file.size : 0,
    source: file.source ?? 'upload',
    addedAt: file.addedAt ?? existing?.addedAt ?? Date.now(),
    blob: file.blob ?? existing?.blob,
  };
}

function resolveLibraryIdForBlob(file: File): string | undefined {
  const matches = homeLibraryFiles.filter(
    (entry) => entry.name === file.name && entry.size === file.size
  );
  return matches.length === 1 ? matches[0]?.id : undefined;
}

/**
 * Attach known My PDFs ids onto the current selection after library sync.
 */
export function reconcileWorkspaceLibraryIds(): void {
  currentFiles = currentFiles.map((file) => {
    if (file.id) {
      if (file.blob) markFileLibraryId(file.blob, file.id);
      return file;
    }
    const fromBlob = file.blob ? fileLibraryIds.get(file.blob) : undefined;
    if (fromBlob) return { ...file, id: fromBlob };
    const matches = homeLibraryFiles.filter(
      (entry) =>
        entry.name === file.name &&
        entry.size === file.size &&
        entry.source === file.source
    );
    const id = matches.length === 1 ? matches[0]?.id : undefined;
    if (id && file.blob) markFileLibraryId(file.blob, id);
    return id ? { ...file, id } : file;
  });
}

export type LibrarySaveTarget = {
  id: string;
  name: string;
};

/**
 * Single selected PDF with a resolvable library id. Multi-select is ambiguous
 * for in-place save; zero selection means Save should add a new record.
 */
export function getPrimaryLibrarySaveTarget(): LibrarySaveTarget | null {
  const pdfs = currentFiles.filter(
    (file) =>
      Boolean(file.name.toLowerCase().endsWith('.pdf')) ||
      file.blob?.type === 'application/pdf' ||
      file.blob?.name.toLowerCase().endsWith('.pdf')
  );
  if (pdfs.length !== 1) return null;

  const file = pdfs[0];
  if (!file) return null;
  if (file.id) return { id: file.id, name: file.name };

  if (file.blob) {
    const fromBlob = fileLibraryIds.get(file.blob);
    if (fromBlob) return { id: fromBlob, name: file.name };
  }

  const matches = homeLibraryFiles.filter(
    (entry) => entry.name === file.name && entry.size === file.size
  );
  if (matches.length === 1 && matches[0]?.id) {
    return { id: matches[0].id, name: matches[0].name };
  }
  return null;
}

export function getWorkspacePdfSelectionCount(): number {
  return currentFiles.filter((file) => {
    if (file.blob) return isPdfBlob(file.blob);
    return file.name.toLowerCase().endsWith('.pdf');
  }).length;
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

/* The viewer ships beside My PDFs, so that nav link is also the only reliable
   base path on a subdirectory deploy — there is no nav anchor of its own. */
function viewPdfHref(
  root: Document,
  file: Pick<WorkspaceFileInfo, 'id' | 'name'>
): string {
  const href = myPdfsHref(root).replace(/my-pdfs\.html/, 'view-pdf.html');
  const params = new URLSearchParams();
  if (file.id) {
    params.set('file', file.id);
  } else if (file.name) {
    // Snapshot-painted pending rows have a name but no library id yet.
    params.set('name', file.name);
  } else {
    return '';
  }
  return `${href}?${params.toString()}`;
}

function createFileButton(
  file: WorkspaceFileInfo,
  root: Document
): HTMLAnchorElement {
  const link = root.createElement('a');
  link.className = 'shift-nav-link shift-open-file-item is-selected';
  link.href = viewPdfHref(root, file);
  link.dataset.fileName = file.name;
  link.dataset.source = file.source;
  link.setAttribute('aria-label', sidebarFileAriaLabel(file));
  link.setAttribute('aria-current', 'true');
  /* Filename first: the collapsed rail is an icon, and the expanded label
     truncates. Skip data-i18n-tooltip — that path overwrites the whole string
     and would drop the name. aria-label already names the row for AT. */
  attachShiftTooltip(link, {
    placement: 'right',
    text: sidebarFileTooltip(file),
  });
  link.append(
    createOpenFilePreview(file, root),
    createLabel(file.name, root),
    createSelectedFileChip(root, 'shift-open-file-selected-label')
  );
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
    return `${file.name} · Received from Shift`;
  }
  if (file.source === 'download') {
    return `${file.name} · Downloaded copy`;
  }
  return file.name;
}

function sidebarFileAriaLabel(file: WorkspaceFileInfo): string {
  if (file.source === 'handoff') {
    return `Selected: ${file.name}. Received from Shift. Click to open in the viewer.`;
  }
  if (file.source === 'download') {
    return `Selected: ${file.name}. Downloaded copy. Click to open in the viewer.`;
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

  const selectCell = root.createElement('td');
  selectCell.className = 'shift-my-pdfs-select-cell';
  const checkbox = root.createElement('input');
  checkbox.className = 'shift-my-pdfs-checkbox';
  checkbox.type = 'checkbox';
  checkbox.checked = isSelected;
  checkbox.tabIndex = -1;
  checkbox.setAttribute('aria-hidden', 'true');
  selectCell.appendChild(checkbox);

  const nameCell = root.createElement('td');
  nameCell.className = 'shift-my-pdfs-name-cell';
  const nameLayout = root.createElement('div');
  nameLayout.className = 'shift-my-pdfs-name';
  const name = root.createElement('span');
  name.textContent = file.name;
  nameLayout.append(name);
  if (file.source === 'download') {
    nameLayout.appendChild(createDownloadedCopyBadge(root));
  }
  nameCell.appendChild(nameLayout);

  const dateCell = root.createElement('td');
  dateCell.className = 'shift-my-pdfs-date-cell';
  dateCell.textContent = file.addedAt
    ? new Date(file.addedAt).toDateString()
    : '';

  const sizeCell = root.createElement('td');
  sizeCell.className = 'shift-my-pdfs-size-cell';
  sizeCell.textContent = formatFileSize(file.size);

  const actionCell = root.createElement('td');
  actionCell.className = 'shift-my-pdfs-action-cell';
  const actionLayout = root.createElement('div');
  actionLayout.className = 'shift-my-pdfs-action-layout';
  actionLayout.append(
    createHomeFileViewButton(file, root),
    createHomeFileDeleteButton(file, root)
  );
  actionCell.appendChild(actionLayout);

  row.append(selectCell, nameCell, dateCell, sizeCell, actionCell);
  row.addEventListener('click', () => activateHomeLibraryFile(file, root));
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activateHomeLibraryFile(file, root);
  });

  return row;
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
  item.append(
    card,
    createHomeFileViewButton(file, root),
    createHomeFileDeleteButton(file, root)
  );
  return item;
}

function createHomeFileViewButton(
  file: WorkspaceFileInfo,
  root: Document
): HTMLButtonElement {
  const button = root.createElement('button');
  button.type = 'button';
  button.className = 'shift-my-pdfs-view';
  button.dataset.fileName = file.name;
  button.textContent = 'View';
  button.setAttribute('aria-label', `View ${file.name}`);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    hideShiftTooltip();
    void openLibraryFileInViewer(file, root);
  });
  return button;
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

  // Bump before the store write so an adopt or sync already in flight sees a
  // new epoch and either rolls back its write or skips its paint. Without
  // this, a slow IndexedDB put that started on select finishes after delete
  // and the PDF comes back as a ghost.
  homeLibraryEpoch += 1;
  await removeLibraryFileFromStore(file);

  homeLibraryFiles = homeLibraryFiles.filter(
    (entry) => !isSameLibraryFile(entry, file)
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

/**
 * Drop the persistent copy even when the painted row never received a store
 * id — the grid can render from a selection before adopt has copied the id
 * onto the entry. Matching by name and size is enough to find that record;
 * two different PDFs that share both are rare, and leaving either behind is
 * how a deleted file used to reappear on the next sync.
 */
async function removeLibraryFileFromStore(
  file: WorkspaceFileInfo
): Promise<void> {
  if (file.id) {
    await removePdfFromLibrary(file.id);
    return;
  }

  const matches = (await readPdfLibrary()).filter(
    (entry) => entry.name === file.name && entry.size === file.size
  );
  for (const match of matches) await removePdfFromLibrary(match.id);
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

function isLibraryFileCurrent(file: WorkspaceFileInfo): boolean {
  return (
    homeLibraryFiles.some((entry) => isSameLibraryFile(entry, file)) ||
    currentFiles.some((entry) => isSameLibraryFile(entry, file))
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
  if (file.id) markFileLibraryId(file.blob, file.id);
  setWorkspaceFiles(
    [
      ...currentFiles.map((current) => ({
        id: current.id,
        name: current.name,
        size: current.size,
        source: current.source,
        addedAt: current.addedAt,
        blob: current.blob,
      })),
      {
        id: file.id,
        name: file.name,
        size: file.size,
        source: file.source,
        addedAt: file.addedAt,
        blob: file.blob,
      },
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
  const input = getActiveFileInput(root);
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
