import { listenForShiftFileHandoff } from '../embedder/shift-file-handoff.js';
import { runOnDomReady } from './tool-file-seed.js';
import { mountViewerChrome } from './viewer-chrome.js';
import { readPdfLibrary, readPdfLibraryEntry } from './pdf-library-store.js';
import { readPersistedOpenFiles } from './open-file-store.js';
import {
  markFileLibraryId,
  markFileFromDownload,
  markFileFromHandoff,
  persistWorkspaceOpenFile,
  setWorkspaceFiles,
} from './workspace-files.js';

export const VIEWER_TOOL_TARGETS = {
  lock: 'encrypt-pdf.html',
  convert: 'pdf-converter.html',
  esign: 'sign-pdf.html',
  compress: 'compress-pdf.html',
} as const;

const VIEWER_MESSAGE_CHANNEL = 'shift-pdf-viewer';
const DOWNLOAD_BUSY_CLASS = 'is-loading';
const DOWNLOAD_FALLBACK_MS = 1600;

type ViewerPageDependencies = {
  assignLocation?: (href: string) => void;
  createObjectUrl?: (file: File) => string;
  revokeObjectUrl?: (url: string) => void;
};

let currentFile: File | null = null;
let currentObjectUrl: string | null = null;
let currentRevokeObjectUrl: ((url: string) => void) | null = null;
let downloadTimer: number | null = null;

function markViewerFile(
  file: File,
  source: 'upload' | 'handoff' | 'download',
  libraryId?: string
): File {
  if (libraryId) markFileLibraryId(file, libraryId);
  if (source === 'handoff') markFileFromHandoff(file);
  if (source === 'download') markFileFromDownload(file);
  return file;
}

export function viewerDisplayName(filename: string): string {
  const trimmed = filename.trim();
  return trimmed.replace(/\.pdf$/i, '') || 'PDF';
}

export function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

export async function showPdfInViewer(
  file: File,
  root: Document = document,
  dependencies: ViewerPageDependencies = {}
): Promise<boolean> {
  if (!isPdf(file)) return false;

  const frame = root.getElementById(
    'shift-pdf-viewer-frame'
  ) as HTMLIFrameElement | null;
  if (!frame) return false;

  currentFile = file;

  const createObjectUrl =
    dependencies.createObjectUrl ??
    ((value: File) => URL.createObjectURL(value));
  const revokeObjectUrl =
    dependencies.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  if (currentObjectUrl) currentRevokeObjectUrl?.(currentObjectUrl);
  currentObjectUrl = createObjectUrl(file);
  currentRevokeObjectUrl = revokeObjectUrl;

  const title = viewerDisplayName(file.name);
  const titleNode = root.getElementById('shift-pdf-viewer-title');
  if (titleNode) titleNode.textContent = title;
  root.title = `${title} | Shift PDF`;

  root.getElementById('shift-pdf-viewer-empty')?.setAttribute('hidden', '');
  frame.hidden = false;
  frame.title = `${file.name} PDF viewer`;
  frame.src = `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html?file=${encodeURIComponent(
    currentObjectUrl
  )}&shiftLaunchpad=1`;
  return true;
}

export async function loadViewerDocumentFromUrl(
  root: Document = document,
  search = window.location.search,
  dependencies: ViewerPageDependencies = {}
): Promise<boolean> {
  const params = new URLSearchParams(search);
  const id = params.get('file')?.trim();
  const name = params.get('name')?.trim();

  if (id) {
    const entry = await readPdfLibraryEntry(id);
    if (!entry) {
      showEmptyState(root);
      return false;
    }
    return showPdfInViewer(
      markViewerFile(entry.file, entry.source, entry.id),
      root,
      dependencies
    );
  }

  if (name) {
    const libraryMatches = (await readPdfLibrary()).filter(
      (entry) => entry.name === name
    );
    if (libraryMatches.length === 1) {
      const entry = libraryMatches[0];
      if (!entry) return false;
      return showPdfInViewer(
        markViewerFile(entry.file, entry.source, entry.id),
        root,
        dependencies
      );
    }

    // Pending sidebar rows are painted before their library id is available,
    // but the existing workspace record still contains the selected files.
    const persistedMatches = (await readPersistedOpenFiles()).filter(
      (entry) => entry.name === name
    );
    if (persistedMatches.length === 1) {
      const entry = persistedMatches[0];
      if (!entry) return false;
      return showPdfInViewer(
        markViewerFile(entry.file, entry.source, entry.libraryId),
        root,
        dependencies
      );
    }
  }

  showEmptyState(root);
  return false;
}

export async function launchViewerTool(
  target: string,
  root: Document = document,
  assignLocation: (href: string) => void = (href) =>
    window.location.assign(href)
): Promise<boolean> {
  if (!currentFile) return false;
  setWorkspaceFiles([currentFile], root);
  await persistWorkspaceOpenFile();
  assignLocation(new URL(target, document.baseURI).href);
  return true;
}

function postViewerAction(
  frame: HTMLIFrameElement,
  action: 'print' | 'download'
): void {
  frame.contentWindow?.postMessage(
    { channel: VIEWER_MESSAGE_CHANNEL, action },
    window.location.origin
  );
}

function setDownloadBusy(root: Document, busy: boolean): void {
  const button = root.getElementById(
    'shift-pdf-viewer-download'
  ) as HTMLButtonElement | null;
  if (!button) return;
  button.classList.toggle(DOWNLOAD_BUSY_CLASS, busy);
  button.setAttribute('aria-busy', String(busy));
  button.disabled = busy;
}

function clearDownloadTimer(): void {
  if (downloadTimer === null) return;
  window.clearTimeout(downloadTimer);
  downloadTimer = null;
}

function bindViewerActions(root: Document): void {
  const frame = root.getElementById(
    'shift-pdf-viewer-frame'
  ) as HTMLIFrameElement | null;
  if (!frame) return;

  root
    .querySelectorAll<HTMLButtonElement>('[data-viewer-tool]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.viewerTool;
        if (target) void launchViewerTool(target, root);
      });
    });

  root
    .getElementById('shift-pdf-viewer-print')
    ?.addEventListener('click', () => {
      postViewerAction(frame, 'print');
    });

  root
    .getElementById('shift-pdf-viewer-download')
    ?.addEventListener('click', () => {
      clearDownloadTimer();
      setDownloadBusy(root, true);
      postViewerAction(frame, 'download');
      downloadTimer = window.setTimeout(() => {
        downloadTimer = null;
        setDownloadBusy(root, false);
      }, DOWNLOAD_FALLBACK_MS);
    });

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== frame.contentWindow) return;
    if (!event.data || typeof event.data !== 'object') return;
    const data = event.data as Record<string, unknown>;
    if (
      data.channel !== VIEWER_MESSAGE_CHANNEL ||
      data.event !== 'download-started'
    ) {
      return;
    }
    clearDownloadTimer();
    setDownloadBusy(root, false);
  });
}

function showEmptyState(root: Document): void {
  const frame = root.getElementById(
    'shift-pdf-viewer-frame'
  ) as HTMLIFrameElement | null;
  if (currentFile || frame?.src) return;
  if (frame) frame.hidden = true;
  root.getElementById('shift-pdf-viewer-empty')?.removeAttribute('hidden');
}

export function initPdfViewerPage(root: Document = document): void {
  if (!root.getElementById('shift-pdf-viewer')) return;

  mountViewerChrome(root, { preset: 'launchpad' });
  bindViewerActions(root);
  void loadViewerDocumentFromUrl(root);

  const input = root.getElementById('file-input') as HTMLInputElement | null;
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void showPdfInViewer(file, root);
  });

  listenForShiftFileHandoff({
    onFile: async (file) => {
      markFileFromHandoff(file);
      return showPdfInViewer(file, root);
    },
  });

  window.setTimeout(() => showEmptyState(root), 800);
}

export function resetPdfViewerPageForTests(): void {
  clearDownloadTimer();
  if (currentObjectUrl) currentRevokeObjectUrl?.(currentObjectUrl);
  currentFile = null;
  currentObjectUrl = null;
  currentRevokeObjectUrl = null;
}

runOnDomReady(() => initPdfViewerPage());
