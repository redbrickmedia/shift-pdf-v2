import { pdfjsLib, getPDFDocument } from '@/js/utils/pdfjs.js';
import { createIcons, icons } from 'lucide';
import Sortable from 'sortablejs';
import type { MergeFile, MergeJob, MergeMessage, MergeResponse } from '@/types';
import {
  pdfEngineAnalytics,
  type ErrorCategory,
  type ToolOperation,
} from '../analytics/index.js';
import { listenForShiftFileHandoff } from '../embedder/shift-file-handoff.js';
import { state } from '../state.js';
import { hideLoader, showAlert, showLoader } from '../ui.js';
import { BoundedHistory } from '../utils/bounded-history.js';
import { isCpdfAvailable } from '../utils/cpdf-helper.js';
import { downloadFile } from '../utils/helpers.js';
import { validateMergePageRange } from '../utils/merge-pdf-validation.js';
import { batchDecryptIfNeeded } from '../utils/password-prompt.js';
import {
  cleanupLazyRendering,
  renderPageToCanvas,
} from '../utils/render-utils.js';
import {
  completionTiming,
  createDefaultToolCompletionPanel,
  type ToolCompletionPanel,
} from '../utils/tool-completion.js';
import {
  showWasmRequiredDialog,
  WasmProvider,
} from '../utils/wasm-provider.js';
import {
  clearWorkspaceOpenFile,
  markFileFromHandoff,
  setWorkspaceFiles,
} from './workspace-files.js';

type MergeMode = 'file' | 'page';

interface MergeSource {
  id: string;
  file: File;
  range: string;
}

interface MergePage {
  fileId: string;
  pageIndex: number;
}

interface MergeSnapshot {
  files: MergeSource[];
  pageOrder: MergePage[];
  activeMode: MergeMode;
  retainPageLabels: boolean;
}

interface RuntimeState {
  pdfDocs: Map<string, pdfjsLib.PDFDocumentProxy>;
  pdfBytes: Map<string, ArrayBuffer>;
  thumbnails: Map<string, string>;
  fileListSortable: Sortable | null;
  pageSortable: Sortable | null;
  renderVersion: number;
}

let mergeModel: MergeSnapshot = {
  files: [],
  pageOrder: [],
  activeMode: 'file',
  retainPageLabels: false,
};

const runtime: RuntimeState = {
  pdfDocs: new Map(),
  pdfBytes: new Map(),
  thumbnails: new Map(),
  fileListSortable: null,
  pageSortable: null,
  renderVersion: 0,
};

const cloneSnapshot = (snapshot: MergeSnapshot): MergeSnapshot => ({
  files: snapshot.files.map((source) => ({ ...source })),
  pageOrder: snapshot.pageOrder.map((page) => ({ ...page })),
  activeMode: snapshot.activeMode,
  retainPageLabels: snapshot.retainPageLabels,
});

const history = new BoundedHistory<MergeSnapshot>(cloneSnapshot, 20);
const mergeWorker = new Worker(
  import.meta.env.BASE_URL + 'workers/merge.worker.js'
);
let completionPanel: ToolCompletionPanel | null = null;
let activeMergeOperation = 0;

function generateId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function thumbnailKey(page: MergePage): string {
  return `${page.fileId}:${page.pageIndex}`;
}

function syncSharedFiles(): void {
  state.files = mergeModel.files.map(({ file }) => file);
}

function updateHistoryButtons(): void {
  const undo = document.getElementById('undo-merge-btn') as HTMLButtonElement;
  const redo = document.getElementById('redo-merge-btn') as HTMLButtonElement;
  const status = history.status;
  if (undo) undo.disabled = !status.canUndo;
  if (redo) redo.disabled = !status.canRedo;
}

function snapshot(): void {
  history.snapshot(mergeModel);
  updateHistoryButtons();
}

function destroySortables(): void {
  runtime.fileListSortable?.destroy();
  runtime.pageSortable?.destroy();
  runtime.fileListSortable = null;
  runtime.pageSortable = null;
}

async function releaseRuntimeDocuments(): Promise<void> {
  const documents = Array.from(runtime.pdfDocs.values());
  runtime.pdfDocs.clear();
  runtime.pdfBytes.clear();
  runtime.thumbnails.clear();
  await Promise.allSettled(documents.map((document) => document.destroy()));
}

async function resetState(): Promise<void> {
  if (activeMergeOperation !== 0) {
    showAlert('Merge in progress', 'Wait for the current merge to finish.');
    return;
  }
  runtime.renderVersion++;
  destroySortables();
  cleanupLazyRendering();
  await releaseRuntimeDocuments();
  history.clear();
  mergeModel = {
    files: [],
    pageOrder: [],
    activeMode: 'file',
    retainPageLabels: false,
  };
  state.files = [];
  state.pdfDoc = null;

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';
  document.getElementById('file-list')?.replaceChildren();
  document.getElementById('page-merge-preview')?.replaceChildren();
  await clearWorkspaceOpenFile();
  await renderMergeUI();
}

async function loadRuntimeSource(source: MergeSource): Promise<void> {
  if (runtime.pdfDocs.has(source.id) && runtime.pdfBytes.has(source.id)) return;

  const bytes = await source.file.arrayBuffer();
  const document = await getPDFDocument({ data: bytes.slice(0) }).promise;
  runtime.pdfBytes.set(source.id, bytes);
  runtime.pdfDocs.set(source.id, document);
}

async function ensureRuntimeDocuments(): Promise<void> {
  for (const source of mergeModel.files) {
    await loadRuntimeSource(source);
  }
}

async function addFiles(files: File[]): Promise<boolean> {
  if (files.length === 0) return false;

  showLoader('Loading PDF documents...');
  const added: MergeSource[] = [];
  try {
    const decrypted = await batchDecryptIfNeeded(files);
    for (const file of decrypted) {
      const source = { id: generateId(), file, range: '' };
      await loadRuntimeSource(source);
      added.push(source);
    }
    if (added.length === 0) {
      await renderMergeUI(false);
      return false;
    }

    snapshot();
    mergeModel.files.push(...added);
    for (const source of added) {
      const document = runtime.pdfDocs.get(source.id);
      if (!document) continue;
      for (let pageIndex = 0; pageIndex < document.numPages; pageIndex++) {
        mergeModel.pageOrder.push({ fileId: source.id, pageIndex });
      }
    }
    syncSharedFiles();
    await renderMergeUI();
    return true;
  } catch (error) {
    console.error('Error loading PDFs:', error);
    await Promise.allSettled(
      added.map(async ({ id }) => {
        await runtime.pdfDocs.get(id)?.destroy();
        runtime.pdfDocs.delete(id);
        runtime.pdfBytes.delete(id);
      })
    );
    showAlert('Error', 'Failed to load one or more PDF files.');
    await renderMergeUI(false);
    return false;
  } finally {
    hideLoader();
  }
}

function createFileListSortable(): void {
  const list = document.getElementById('file-list');
  if (!list) return;
  runtime.fileListSortable?.destroy();
  runtime.fileListSortable = Sortable.create(list, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onEnd: ({ oldIndex, newIndex }) => {
      if (
        oldIndex === undefined ||
        newIndex === undefined ||
        oldIndex === newIndex
      )
        return;
      snapshot();
      const [moved] = mergeModel.files.splice(oldIndex, 1);
      mergeModel.files.splice(newIndex, 0, moved);
      syncSharedFiles();
      void renderMergeUI();
    },
  });
}

function createPageSortable(): void {
  const list = document.getElementById('page-merge-preview');
  if (!list) return;
  runtime.pageSortable?.destroy();
  runtime.pageSortable = Sortable.create(list, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onEnd: ({ oldIndex, newIndex }) => {
      if (
        oldIndex === undefined ||
        newIndex === undefined ||
        oldIndex === newIndex
      )
        return;
      snapshot();
      const [moved] = mergeModel.pageOrder.splice(oldIndex, 1);
      mergeModel.pageOrder.splice(newIndex, 0, moved);
      void renderPageThumbnails();
    },
  });
}

function renderFileList(): void {
  const list = document.getElementById('file-list');
  if (!list) return;
  list.replaceChildren();

  for (const source of mergeModel.files) {
    const pdfDocument = runtime.pdfDocs.get(source.id);
    const item = document.createElement('li');
    item.dataset.fileId = source.id;
    item.className =
      'bg-gray-700 p-3 rounded-lg border border-gray-600 hover:border-indigo-500 transition-colors';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between';
    const name = document.createElement('span');
    name.className = 'truncate font-medium text-white flex-1 mr-2';
    name.title = source.file.name;
    name.textContent = source.file.name;
    const handle = document.createElement('div');
    handle.className =
      'drag-handle cursor-move text-gray-400 hover:text-white p-1 rounded';
    handle.setAttribute('aria-label', `Reorder ${source.file.name}`);
    handle.innerHTML = '<i data-lucide="grip-vertical" class="w-4 h-4"></i>';
    header.append(name, handle);

    const controls = document.createElement('div');
    controls.className = 'mt-2 flex items-center gap-2';
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'flex-1';
    const label = document.createElement('label');
    label.htmlFor = `range-${source.id}`;
    label.className = 'text-xs text-gray-400';
    label.textContent = `Pages (e.g., 1-3, 5) - Total: ${pdfDocument?.numPages ?? 'N/A'}`;
    const input = document.createElement('input');
    input.id = `range-${source.id}`;
    input.type = 'text';
    input.value = source.range;
    input.placeholder = 'Leave blank for all pages';
    input.className =
      'w-full bg-gray-800 border border-gray-600 text-white rounded-md p-2 text-sm mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
    input.addEventListener('change', () => {
      if (input.value === source.range) return;
      snapshot();
      source.range = input.value;
    });
    inputWrapper.append(label, input);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className =
      'text-red-400 hover:text-red-300 p-2 flex-shrink-0 self-end';
    remove.title = `Remove ${source.file.name}`;
    remove.setAttribute('aria-label', `Remove ${source.file.name}`);
    remove.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
    remove.addEventListener('click', () => {
      snapshot();
      mergeModel.files = mergeModel.files.filter(({ id }) => id !== source.id);
      mergeModel.pageOrder = mergeModel.pageOrder.filter(
        ({ fileId }) => fileId !== source.id
      );
      syncSharedFiles();
      void renderMergeUI();
    });
    controls.append(inputWrapper, remove);
    item.append(header, controls);
    list.append(item);
  }
  createFileListSortable();
}

function createThumbnail(page: MergePage, dataUrl: string): HTMLElement {
  const source = mergeModel.files.find(({ id }) => id === page.fileId);
  const wrapper = document.createElement('div');
  wrapper.className =
    'page-thumbnail relative cursor-move flex flex-col items-center gap-1 p-2 border-2 border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-700';
  wrapper.dataset.fileId = page.fileId;
  wrapper.dataset.pageIndex = String(page.pageIndex);

  const image = document.createElement('img');
  image.src = dataUrl;
  image.alt = `${source?.file.name ?? 'PDF'}, page ${page.pageIndex + 1}`;
  image.className = 'rounded-md shadow-md max-w-full h-auto';
  const label = document.createElement('p');
  label.className = 'text-xs text-gray-400 truncate w-full text-center';
  label.title = image.alt;
  label.textContent = `${source?.file.name.slice(0, 10) ?? 'PDF'} (p${page.pageIndex + 1})`;
  wrapper.append(image, label);
  return wrapper;
}

async function renderPageThumbnails(): Promise<void> {
  const container = document.getElementById('page-merge-preview');
  if (!container) return;
  const renderVersion = ++runtime.renderVersion;
  runtime.pageSortable?.destroy();
  runtime.pageSortable = null;
  container.replaceChildren();
  if (mergeModel.activeMode !== 'page') return;

  showLoader('Rendering page previews...');
  try {
    for (const page of mergeModel.pageOrder) {
      if (renderVersion !== runtime.renderVersion) return;
      const document = runtime.pdfDocs.get(page.fileId);
      if (
        !document ||
        page.pageIndex < 0 ||
        page.pageIndex >= document.numPages
      )
        continue;
      const key = thumbnailKey(page);
      let dataUrl = runtime.thumbnails.get(key);
      if (!dataUrl) {
        const canvas = await renderPageToCanvas(
          document,
          page.pageIndex + 1,
          0.25
        );
        dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        runtime.thumbnails.set(key, dataUrl);
      }
      container.append(createThumbnail(page, dataUrl));
    }
    if (renderVersion === runtime.renderVersion) createPageSortable();
  } catch (error) {
    console.error('Error rendering page thumbnails:', error);
    showAlert('Error', 'Failed to render page thumbnails.');
  } finally {
    if (renderVersion === runtime.renderVersion) hideLoader();
    createIcons({ icons });
  }
}

function renderMode(): void {
  const fileButton = document.getElementById('file-mode-btn');
  const pageButton = document.getElementById('page-mode-btn');
  const filePanel = document.getElementById('file-mode-panel');
  const pagePanel = document.getElementById('page-mode-panel');
  const inFileMode = mergeModel.activeMode === 'file';
  filePanel?.classList.toggle('hidden', !inFileMode);
  pagePanel?.classList.toggle('hidden', inFileMode);
  fileButton?.classList.toggle('bg-indigo-600', inFileMode);
  fileButton?.classList.toggle('text-white', inFileMode);
  pageButton?.classList.toggle('bg-indigo-600', !inFileMode);
  pageButton?.classList.toggle('text-white', !inFileMode);
  fileButton?.setAttribute('aria-pressed', String(inFileMode));
  pageButton?.setAttribute('aria-pressed', String(!inFileMode));
}

async function renderMergeUI(syncWorkspace = true): Promise<void> {
  syncSharedFiles();
  const hasFiles = mergeModel.files.length > 0;
  if (syncWorkspace) {
    setWorkspaceFiles(mergeModel.files.map(({ file }) => file));
  }
  document
    .getElementById('file-controls')
    ?.classList.toggle('hidden', !hasFiles);
  document
    .getElementById('merge-options')
    ?.classList.toggle('hidden', !hasFiles);
  const process = document.getElementById('process-btn') as HTMLButtonElement;
  if (process) process.disabled = mergeModel.files.length < 2;
  const retain = document.getElementById(
    'retain-page-labels'
  ) as HTMLInputElement;
  if (retain) retain.checked = mergeModel.retainPageLabels;
  renderMode();
  renderFileList();
  updateHistoryButtons();
  createIcons({ icons });
  if (mergeModel.activeMode === 'page') await renderPageThumbnails();
  else {
    runtime.renderVersion++;
    runtime.pageSortable?.destroy();
    runtime.pageSortable = null;
    document.getElementById('page-merge-preview')?.replaceChildren();
  }
}

async function restore(snapshotToRestore: MergeSnapshot): Promise<void> {
  mergeModel = cloneSnapshot(snapshotToRestore);
  syncSharedFiles();
  showLoader('Restoring merge state...');
  try {
    await ensureRuntimeDocuments();
    await renderMergeUI();
  } catch (error) {
    console.error('Failed to restore merge state:', error);
    showAlert('Error', 'Failed to restore the previous merge state.');
  } finally {
    hideLoader();
  }
}

async function undo(): Promise<void> {
  const previous = history.undo(mergeModel);
  if (previous) await restore(previous);
  updateHistoryButtons();
}

async function redo(): Promise<void> {
  const next = history.redo(mergeModel);
  if (next) await restore(next);
  updateHistoryButtons();
}

function validatePageMode(): string | null {
  if (mergeModel.pageOrder.length === 0) {
    return 'Select at least one page to merge.';
  }
  for (const page of mergeModel.pageOrder) {
    const source = mergeModel.files.find(({ id }) => id === page.fileId);
    const document = runtime.pdfDocs.get(page.fileId);
    if (
      !source ||
      !document ||
      !Number.isInteger(page.pageIndex) ||
      page.pageIndex < 0 ||
      page.pageIndex >= document.numPages
    ) {
      return 'The page selection is no longer valid. Please reload the files.';
    }
  }
  return null;
}

function buildMergeJobs(): {
  jobs: MergeJob[];
  files: MergeFile[];
  error?: string;
} {
  const jobs: MergeJob[] = [];
  const usedFileIds = new Set<string>();

  if (mergeModel.activeMode === 'file') {
    for (const source of mergeModel.files) {
      const document = runtime.pdfDocs.get(source.id);
      if (!document) return { jobs, files: [], error: 'A PDF is not loaded.' };
      const validation = validateMergePageRange(
        source.range,
        document.numPages
      );
      if ('error' in validation) {
        return {
          jobs,
          files: [],
          error: `${source.file.name}: ${validation.error}`,
        };
      }
      usedFileIds.add(source.id);
      jobs.push(
        validation.normalized
          ? {
              fileName: source.id,
              rangeType: 'specific',
              rangeString: validation.normalized,
            }
          : { fileName: source.id, rangeType: 'all' }
      );
    }
  } else {
    const error = validatePageMode();
    if (error) return { jobs, files: [], error };
    for (let index = 0; index < mergeModel.pageOrder.length; index++) {
      const current = mergeModel.pageOrder[index];
      usedFileIds.add(current.fileId);
      let endPage = current.pageIndex;
      while (
        index + 1 < mergeModel.pageOrder.length &&
        mergeModel.pageOrder[index + 1].fileId === current.fileId &&
        mergeModel.pageOrder[index + 1].pageIndex === endPage + 1
      ) {
        endPage++;
        index++;
      }
      jobs.push(
        endPage === current.pageIndex
          ? {
              fileName: current.fileId,
              rangeType: 'single',
              pageIndex: current.pageIndex,
            }
          : {
              fileName: current.fileId,
              rangeType: 'range',
              startPage: current.pageIndex + 1,
              endPage: endPage + 1,
            }
      );
    }
  }

  const files: MergeFile[] = [];
  for (const source of mergeModel.files) {
    if (!usedFileIds.has(source.id)) continue;
    const bytes = runtime.pdfBytes.get(source.id);
    if (!bytes)
      return { jobs, files, error: `${source.file.name} is not loaded.` };
    files.push({ name: source.id, data: bytes.slice(0) });
  }
  return { jobs, files };
}

export async function merge(): Promise<void> {
  if (activeMergeOperation !== 0) {
    showAlert('Merge in progress', 'Wait for the current merge to finish.');
    return;
  }
  const inputCount = mergeModel.files.length;
  const startedAt = performance.now();
  const operation: ToolOperation | null =
    pdfEngineAnalytics?.startToolOperation('merge-pdf') ?? null;
  const fail = (message: string, category: ErrorCategory = 'invalid-input') => {
    operation?.finish({
      result: 'error',
      inputCount,
      outputCount: 0,
      errorCategory: category,
    });
    showAlert('Cannot merge PDFs', message);
  };

  if (inputCount < 2) {
    fail('Add at least two PDF files before merging.');
    return;
  }
  if (!isCpdfAvailable()) {
    operation?.finish({
      result: 'error',
      inputCount,
      outputCount: 0,
      errorCategory: 'engine-load',
    });
    showWasmRequiredDialog('cpdf');
    return;
  }

  const prepared = buildMergeJobs();
  if (prepared.error) {
    fail(prepared.error);
    return;
  }

  showLoader('Merging PDFs...');
  const message: MergeMessage = {
    command: 'merge',
    files: prepared.files,
    jobs: prepared.jobs,
    cpdfUrl: `${WasmProvider.getUrl('cpdf')}coherentpdf.browser.min.js`,
    retainPageLabels: mergeModel.retainPageLabels,
  };
  const operationId = Date.now() + Math.random();
  activeMergeOperation = operationId;
  const processButton = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement | null;
  if (processButton) processButton.disabled = true;
  const finishWorkerOperation = () => {
    if (activeMergeOperation !== operationId) return false;
    activeMergeOperation = 0;
    if (processButton) processButton.disabled = mergeModel.files.length < 2;
    return true;
  };
  mergeWorker.onmessage = (event: MessageEvent<MergeResponse>) => {
    if (!finishWorkerOperation()) return;
    hideLoader();
    if (event.data.status !== 'success') {
      operation?.finish({
        result: 'error',
        inputCount,
        outputCount: 0,
        errorCategory: 'processing',
      });
      showAlert('Error', event.data.message || 'Failed to merge PDFs.');
      return;
    }
    const blob = new Blob([event.data.pdfBytes], { type: 'application/pdf' });
    downloadFile(blob, 'merged.pdf');
    completionPanel?.show({
      blob,
      filename: 'merged.pdf',
      summary: `Merged ${inputCount} PDFs into one document.`,
      timing: completionTiming(startedAt),
    });
    operation?.finish({ result: 'success', inputCount, outputCount: 1 });
  };
  mergeWorker.onerror = (error) => {
    if (!finishWorkerOperation()) return;
    hideLoader();
    console.error('Worker error:', error);
    operation?.finish({
      result: 'error',
      inputCount,
      outputCount: 0,
      errorCategory: 'processing',
    });
    showAlert('Error', 'An unexpected error occurred in the merge worker.');
  };
  try {
    mergeWorker.postMessage(
      message,
      prepared.files.map(({ data }) => data)
    );
  } catch (error) {
    finishWorkerOperation();
    hideLoader();
    console.error('Failed to start merge worker:', error);
    operation?.finish({
      result: 'error',
      inputCount,
      outputCount: 0,
      errorCategory: 'processing',
    });
    showAlert('Error', 'Could not start the merge operation.');
  }
}

export async function refreshMergeUI(): Promise<void> {
  await renderMergeUI();
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  completionPanel = createDefaultToolCompletionPanel(resetState);

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    window.location.href = import.meta.env.BASE_URL;
  });
  fileInput?.addEventListener('change', () => {
    void addFiles(Array.from(fileInput.files ?? []));
  });
  fileInput?.addEventListener('click', () => {
    fileInput.value = '';
  });
  document.getElementById('add-more-btn')?.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });
  document.getElementById('clear-files-btn')?.addEventListener('click', () => {
    void resetState();
  });
  document.getElementById('process-btn')?.addEventListener('click', () => {
    void merge();
  });
  document.getElementById('undo-merge-btn')?.addEventListener('click', () => {
    void undo();
  });
  document.getElementById('redo-merge-btn')?.addEventListener('click', () => {
    void redo();
  });
  document.getElementById('file-mode-btn')?.addEventListener('click', () => {
    if (mergeModel.activeMode === 'file') return;
    snapshot();
    mergeModel.activeMode = 'file';
    void renderMergeUI();
  });
  document.getElementById('page-mode-btn')?.addEventListener('click', () => {
    if (mergeModel.activeMode === 'page') return;
    snapshot();
    mergeModel.activeMode = 'page';
    void renderMergeUI();
  });
  document
    .getElementById('retain-page-labels')
    ?.addEventListener('change', (event) => {
      const checked = (event.target as HTMLInputElement).checked;
      if (checked === mergeModel.retainPageLabels) return;
      snapshot();
      mergeModel.retainPageLabels = checked;
    });

  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('bg-gray-700');
  });
  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('bg-gray-700');
  });
  dropZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('bg-gray-700');
    const files = Array.from(event.dataTransfer?.files ?? []).filter(
      (file) =>
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
    );
    void addFiles(files);
  });

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      void undo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      void redo();
    }
  });

  void renderMergeUI(false);
  listenForShiftFileHandoff({
    onFile: (file) => {
      markFileFromHandoff(file);
      return addFiles([file]);
    },
  });
});
