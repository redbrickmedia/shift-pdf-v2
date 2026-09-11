import { categories } from '../config/tools.js';
import { listenForShiftFileHandoff } from '../embedder/shift-file-handoff.js';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import { isToolDisabled } from '../utils/disabled-tools.js';
import { addPdfToLibrary } from './pdf-library-store.js';
import { syncHomeLibraryFromStore } from './home-files.js';
import { loadFavoriteToolIds } from './tool-favorites.js';
import { onToolFilesSeeded } from './tool-file-seed.js';
import {
  getWorkspaceFiles,
  markFileFromHandoff,
  persistWorkspaceOpenFile,
  setWorkspaceFiles,
  setWorkspaceFilesFromTool,
} from './workspace-files.js';
import {
  listCatalogTools,
  partitionPinnedTools,
  PDF_VIEWER_PAGE_ID,
  type ViewerTool,
} from './pdf-viewer-launchers.js';

const VIEWER_HOST_CLASS = 'shift-pdf-viewer-page';
const VIEWING_CLASS = 'is-viewing';

type PdfViewerPageOptions = {
  assignLocation?: (href: string) => void;
  favoritesStorage?: Parameters<typeof loadFavoriteToolIds>[1];
};

let currentFile: File | null = null;
let blobUrl: string | null = null;
let boundRoot: Document | null = null;
let menuBound = false;

function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

export async function launchViewerTool(
  file: File,
  href: string,
  root: Document = document,
  assignLocation: (href: string) => void = (next) => {
    window.location.assign(next);
  }
): Promise<void> {
  setWorkspaceFiles([file], root);
  await persistWorkspaceOpenFile();
  await addPdfToLibrary(file, 'upload');
  await syncHomeLibraryFromStore(root);
  assignLocation(href);
}

export function initPdfViewerPage(
  root: Document = document,
  options: PdfViewerPageOptions = {}
): void {
  const page = root.getElementById('pdf-viewer-page');
  if (!page) return;

  boundRoot = root;
  root.body.classList.add(VIEWER_HOST_CLASS);

  const fileInput = root.getElementById(
    'file-input'
  ) as HTMLInputElement | null;
  const dropZone = root.getElementById('drop-zone');
  const changeFile = root.getElementById('pdf-viewer-change-file');

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void openPdfInViewer(file, root);
  });

  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragover');
  });
  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-dragover');
  });
  dropZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) void openPdfInViewer(file, root);
  });

  changeFile?.addEventListener('click', () => {
    fileInput?.click();
  });

  root
    .getElementById('pdf-viewer-more-tools')
    ?.addEventListener('click', () => {
      toggleMoreMenu(root);
    });

  if (!menuBound) {
    menuBound = true;
    document.addEventListener('click', (event) => {
      const menu = boundRoot?.getElementById('pdf-viewer-more-menu');
      const toggle = boundRoot?.getElementById('pdf-viewer-more-tools');
      if (!menu || menu.hidden) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menu.contains(target) || toggle?.contains(target)) return;
      hideMoreMenu(boundRoot ?? document);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      hideMoreMenu(boundRoot ?? document);
    });
  }

  listenForShiftFileHandoff({
    onFile: (file) => {
      markFileFromHandoff(file);
      return openPdfInViewer(file, root);
    },
  });

  const applySeeded = () => {
    const seeded = resolveSeededPdf();
    if (seeded) void openPdfInViewer(seeded, root);
  };
  onToolFilesSeeded(applySeeded);
  applySeeded();

  renderLaunchers(root, options);
}

function resolveSeededPdf(): File | null {
  const workspace = getWorkspaceFiles()
    .map((entry) => entry.blob)
    .find((blob): blob is File => blob instanceof File && isPdfFile(blob));
  return workspace ?? null;
}

export async function openPdfInViewer(
  file: File,
  root: Document = document
): Promise<boolean> {
  if (!isPdfFile(file)) {
    showAlert('Invalid File', 'Please select a PDF file.');
    return false;
  }

  currentFile = file;
  setWorkspaceFilesFromTool([file], root);
  await persistWorkspaceOpenFile();

  const uploader = root.getElementById('uploader');
  const stage = root.getElementById('pdf-viewer-stage');
  const frame = root.getElementById('pdf-viewer-frame');
  const name = root.getElementById('pdf-viewer-filename');
  if (!stage || !frame) return false;

  uploader?.classList.add('hidden');
  stage.hidden = false;
  root.body.classList.add(VIEWING_CLASS);
  if (name) name.textContent = file.name;

  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(file);

  showLoader('Opening PDF...');
  frame.replaceChildren();
  const iframe = root.createElement('iframe');
  iframe.title = `${file.name} PDF viewer`;
  iframe.src = `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html?file=${encodeURIComponent(blobUrl)}`;
  iframe.className = 'shift-pdf-viewer-iframe';
  iframe.addEventListener('load', () => {
    hideLoader();
  });
  frame.appendChild(iframe);
  return true;
}

function renderLaunchers(root: Document, options: PdfViewerPageOptions): void {
  const tools = listCatalogTools(categories, {
    excludeIds: [PDF_VIEWER_PAGE_ID],
    isDisabled: isToolDisabled,
  });
  const validIds = new Set(tools.map((tool) => tool.id));
  const favoriteIds = loadFavoriteToolIds(validIds, options.favoritesStorage);
  const { pinned, more } = partitionPinnedTools(tools, favoriteIds);

  const pins = root.getElementById('pdf-viewer-pins');
  const menu = root.getElementById('pdf-viewer-more-menu');
  if (!pins || !menu) return;

  pins.replaceChildren(
    ...pinned.map((tool) => createLauncherButton(root, tool, options, 'pin'))
  );
  menu.replaceChildren(
    ...more.map((tool) => createLauncherButton(root, tool, options, 'menu'))
  );
  menu.hidden = true;

  const moreButton = root.getElementById('pdf-viewer-more-tools');
  if (moreButton instanceof HTMLButtonElement) {
    moreButton.hidden = more.length === 0;
    moreButton.setAttribute('aria-expanded', 'false');
  }
}

function createLauncherButton(
  root: Document,
  tool: ViewerTool,
  options: PdfViewerPageOptions,
  kind: 'pin' | 'menu'
): HTMLButtonElement {
  const button = root.createElement('button');
  button.type = 'button';
  button.className =
    kind === 'pin' ? 'shift-pdf-viewer-pin' : 'shift-pdf-viewer-menu-item';
  button.dataset.toolId = tool.id;
  button.title = tool.name;

  const icon = root.createElement('i');
  icon.className = `ph ${tool.icon} shift-pdf-viewer-tool-icon`;
  icon.setAttribute('aria-hidden', 'true');

  const label = root.createElement('span');
  label.textContent = tool.name;

  button.append(icon, label);
  button.addEventListener('click', () => {
    if (!currentFile) {
      showAlert('No PDF open', 'Open a PDF before launching a tool.');
      return;
    }
    hideMoreMenu(root);
    void launchViewerTool(currentFile, tool.href, root, options.assignLocation);
  });
  return button;
}

function toggleMoreMenu(root: Document): void {
  const menu = root.getElementById('pdf-viewer-more-menu');
  const toggle = root.getElementById('pdf-viewer-more-tools');
  if (!menu || !(toggle instanceof HTMLButtonElement)) return;
  const open = menu.hidden;
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
}

function hideMoreMenu(root: Document): void {
  const menu = root.getElementById('pdf-viewer-more-menu');
  const toggle = root.getElementById('pdf-viewer-more-tools');
  if (menu) menu.hidden = true;
  toggle?.setAttribute('aria-expanded', 'false');
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('pdf-viewer-page')) {
      initPdfViewerPage();
    }
  });
}
