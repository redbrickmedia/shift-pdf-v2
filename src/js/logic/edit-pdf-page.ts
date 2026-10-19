// Logic for unified PDF Editor Tool Surface (Annotate & Redact, Fill & Sign, Crop)
import Cropper from 'cropperjs';
import type { EmbedPdfContainer } from 'embedpdf-snippet';
import { createIcons, icons } from 'lucide';
import type {
  DocManagerPlugin,
  HistoryPlugin,
  PDFViewerWindow,
  PrintPlugin,
} from '@/types';
import { listenForShiftFileHandoff } from '../embedder/shift-file-handoff.js';
import { state } from '../state.js';
import { hideLoader, showAlert, showLoader } from '../ui.js';
import { makeUniqueFileKey } from '../utils/deduplicate-filename.js';
import { getDerivedPdfFilename } from '../utils/derived-pdf-filename.js';
import { getEditorDisabledCategories } from '../utils/disabled-tools.js';
import { downloadFile, formatBytes } from '../utils/helpers.js';
import { batchDecryptIfNeeded } from '../utils/password-prompt.js';
import { getPDFDocument } from '../utils/pdfjs.js';
import {
  bindPdfJsEditorHistory,
  configureSessionOnlySignatureUi,
  EMPTY_PDFJS_EDITOR_HISTORY,
  openPdfJsSignatureDialog,
  redoPdfJsEditor,
  undoPdfJsEditor,
  waitForPdfJsSignViewer,
  type PdfJsEditorHistoryState,
} from '../utils/pdfjs-sign-viewer.js';
import {
  applyPdfViewerDownloadFilename,
  withPdfViewerFilename,
} from '../utils/pdfjs-viewer-filename.js';
import {
  hidePdfJsPrintControls,
  printPdfBlob,
  printPdfJsViewerFrame,
} from '../utils/pdfjs-viewer-print.js';
import {
  exportFlattenedSignedPdf,
  exportPdfJsAnnotations,
  getSignedPdfFilename,
} from '../utils/sign-pdf-export.js';
import {
  CropHistoryController,
  performFlatteningCrop,
  performMetadataCrop,
  type CropPdfJsDocument,
} from './edit-pdf-crop.js';
import {
  entryIdForEditPdfMode,
  resolveInitialEditPdfMode,
  shouldAutoActivateStampTool,
  shouldAutoArmSignatureMode,
  type EditPdfMode,
} from './edit-pdf-modes.js';
import {
  applyLaunchContextToDom,
  resolveLaunchContext,
  setLaunchContext,
} from './launch-context.js';
import { onToolFilesSeeded } from './tool-file-seed.js';
import { mountToolInputPreview } from './tool-input-preview.js';
import {
  registerToolOutputSession,
  syncToolOutputToolbar,
} from './tool-output-toolbar.js';
import {
  clearWorkspaceOpenFile,
  markFileFromHandoff,
  setWorkspaceFilesFromTool,
} from './workspace-files.js';

const embedPdfWasmUrl = new URL(
  'embedpdf-snippet/dist/pdfium.wasm',
  import.meta.url
).href;

let activeMode: EditPdfMode = 'annotate';
let activeEntryId = 'edit-pdf';
let currentFileName = 'document.pdf';
let workingPdfBytes: Uint8Array | null = null;
let hasAccumulatedModeEdits = false;
let modeSwitchInFlight = false;

// Annotate & Redact (EmbedPDF) state
let viewerInstance: EmbedPdfContainer | null = null;
let docManagerPlugin: DocManagerPlugin | null = null;
let historyPlugin: HistoryPlugin | null = null;
let printPlugin: PrintPlugin | null = null;
let unbindHistory: (() => void) | null = null;
let isViewerInitialized = false;
let exportEditedPdf: (() => Promise<Uint8Array>) | null = null;

// Fill & Sign (PDF.js) state
let fillSignIframe: HTMLIFrameElement | null = null;
let fillSignApp: PDFViewerWindow['PDFViewerApplication'] | null = null;
let fillSignBlobUrl: string | null = null;
let fillSignViewerReady = false;
let fillSignLoadVersion = 0;
let fillSignEditorHistory: PdfJsEditorHistoryState = EMPTY_PDFJS_EDITOR_HISTORY;
let fillSignFormDirty = false;
let unbindFillSignHistory: (() => void) | null = null;

// Crop (Cropper.js) state
const cropHistory = new CropHistoryController();
let cropPdfDoc: (CropPdfJsDocument & { destroy?: () => void }) | null = null;
let cropCurrentPageNum = 1;
let cropInstance: Cropper | null = null;

let moduleListenersBound = false;

function getRegistryPlugin<T>(
  registry: { getPlugin: (id: string) => { provides?: () => unknown } },
  id: string
): T | null {
  try {
    return (registry.getPlugin(id).provides?.() as T) ?? null;
  } catch {
    return null;
  }
}

function getFillSignViewerApplication(): PDFViewerWindow['PDFViewerApplication'] {
  return (
    fillSignApp ??
    (fillSignIframe?.contentWindow as PDFViewerWindow | null)
      ?.PDFViewerApplication
  );
}

function isFlattenChecked(): boolean {
  return Boolean(
    (
      document.getElementById(
        'flatten-signature-toggle'
      ) as HTMLInputElement | null
    )?.checked
  );
}

function isDestructiveCropChecked(): boolean {
  return Boolean(
    (
      document.getElementById(
        'destructive-crop-toggle'
      ) as HTMLInputElement | null
    )?.checked
  );
}

function isApplyToAllCropChecked(): boolean {
  return Boolean(
    (document.getElementById('apply-to-all-toggle') as HTMLInputElement | null)
      ?.checked
  );
}

function annotateHasEdits(): boolean {
  try {
    return Boolean(historyPlugin?.getHistoryState().global.canUndo);
  } catch {
    return Boolean(historyPlugin?.canUndo());
  }
}

function fillSignHasEdits(): boolean {
  return (
    fillSignEditorHistory.hasEdits || fillSignFormDirty || isFlattenChecked()
  );
}

function cropHasEdits(): boolean {
  return cropHistory.hasCrops();
}

function currentModeHasEdits(): boolean {
  if (activeMode === 'annotate') return annotateHasEdits();
  if (activeMode === 'fill-sign') return fillSignHasEdits();
  return cropHasEdits();
}

function editorHasEdits(): boolean {
  return hasAccumulatedModeEdits || currentModeHasEdits();
}

function hasLoadedDocument(): boolean {
  return (
    workingPdfBytes !== null ||
    isViewerInitialized ||
    fillSignViewerReady ||
    cropPdfDoc !== null
  );
}

function syncModeTabsAndChrome(): void {
  const buttons: Array<{ id: string; mode: EditPdfMode }> = [
    { id: 'mode-annotate-btn', mode: 'annotate' },
    { id: 'mode-fill-sign-btn', mode: 'fill-sign' },
    { id: 'mode-crop-btn', mode: 'crop' },
  ];

  for (const { id, mode } of buttons) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const isActive = activeMode === mode;
    btn.setAttribute('aria-selected', String(isActive));
    btn.classList.toggle('bg-indigo-600', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('text-gray-300', !isActive);
  }

  const annotateStage = document.getElementById('embed-pdf-container');
  const fillSignStage = document.getElementById('fill-sign-stage');
  const cropStage = document.getElementById('cropper-editor');

  if (hasLoadedDocument()) {
    document.getElementById('embed-pdf-wrapper')?.classList.remove('hidden');
  }

  annotateStage?.classList.toggle('hidden', activeMode !== 'annotate');
  fillSignStage?.classList.toggle('hidden', activeMode !== 'fill-sign');
  cropStage?.classList.toggle('hidden', activeMode !== 'crop');

  const isFillSign = activeMode === 'fill-sign';
  const signAddBtn = document.getElementById('shift-sign-add');
  const flattenControl = document.querySelector<HTMLElement>(
    '[data-viewer-chrome="flatten"]'
  );
  if (signAddBtn) signAddBtn.hidden = !isFillSign;
  if (flattenControl) flattenControl.hidden = !isFillSign;

  syncToolOutputToolbar();
}

function cleanupAnnotateStage(): void {
  unbindHistory?.();
  unbindHistory = null;
  viewerInstance = null;
  docManagerPlugin = null;
  historyPlugin = null;
  printPlugin = null;
  isViewerInitialized = false;
  exportEditedPdf = null;
  const pdfContainer = document.getElementById('embed-pdf-container');
  if (pdfContainer) pdfContainer.textContent = '';
}

function cleanupFillSignStage(): void {
  fillSignLoadVersion++;
  unbindFillSignHistory?.();
  unbindFillSignHistory = null;
  fillSignEditorHistory = EMPTY_PDFJS_EDITOR_HISTORY;
  fillSignFormDirty = false;
  fillSignViewerReady = false;
  fillSignApp = null;
  if (fillSignBlobUrl) {
    URL.revokeObjectURL(fillSignBlobUrl);
    fillSignBlobUrl = null;
  }
  fillSignIframe?.remove();
  fillSignIframe = null;
  const container = document.getElementById('canvas-container-sign');
  if (container) container.textContent = '';
}

function cleanupCropStage(): void {
  if (cropInstance) {
    cropInstance.destroy();
    cropInstance = null;
  }
  cropPdfDoc?.destroy?.();
  cropPdfDoc = null;
  cropCurrentPageNum = 1;
  cropHistory.reset();
  const container = document.getElementById('cropper-container');
  if (container) container.innerHTML = '';
}

function resetViewer(): void {
  cleanupAnnotateStage();
  cleanupFillSignStage();
  cleanupCropStage();

  workingPdfBytes = null;
  hasAccumulatedModeEdits = false;

  const pdfWrapper = document.getElementById('embed-pdf-wrapper');
  const fileDisplayArea = document.getElementById('file-display-area');
  const fileInput = document.getElementById(
    'file-input'
  ) as HTMLInputElement | null;
  const flattenCheckbox = document.getElementById(
    'flatten-signature-toggle'
  ) as HTMLInputElement | null;
  const destructiveCheckbox = document.getElementById(
    'destructive-crop-toggle'
  ) as HTMLInputElement | null;
  const applyAllCheckbox = document.getElementById(
    'apply-to-all-toggle'
  ) as HTMLInputElement | null;

  if (pdfWrapper) pdfWrapper.classList.add('hidden');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';
  if (fileInput) fileInput.value = '';
  if (flattenCheckbox) flattenCheckbox.checked = false;
  if (destructiveCheckbox) destructiveCheckbox.checked = false;
  if (applyAllCheckbox) applyAllCheckbox.checked = false;

  void clearWorkspaceOpenFile();
  syncModeTabsAndChrome();
}

function activateStampToolIfNeeded(
  registry: { getPlugin: (id: string) => { provides?: () => unknown } },
  docId?: string
): void {
  if (!shouldAutoActivateStampTool(activeEntryId)) return;

  const commandsPlugin = getRegistryPlugin<{
    execute?: (commandId: string, documentId?: string) => void;
    forDocument?: (documentId: string) => {
      execute?: (commandId: string) => void;
    };
  }>(registry, 'commands');
  if (commandsPlugin?.execute) {
    commandsPlugin.execute('annotation:add-stamp', docId);
  } else if (docId && commandsPlugin?.forDocument) {
    commandsPlugin.forDocument(docId).execute?.('annotation:add-stamp');
  }

  const annotationPlugin = getRegistryPlugin<{
    setActiveTool?: (toolId: string | null) => void;
    forDocument?: (documentId: string) => {
      setActiveTool?: (toolId: string | null) => void;
    };
  }>(registry, 'annotation');
  if (docId && annotationPlugin?.forDocument) {
    annotationPlugin.forDocument(docId).setActiveTool?.('stamp');
  } else {
    annotationPlugin?.setActiveTool?.('stamp');
  }
}

async function mountAnnotateStage(bytes: Uint8Array): Promise<void> {
  const pdfWrapper = document.getElementById('embed-pdf-wrapper');
  const pdfContainer = document.getElementById('embed-pdf-container');
  if (!pdfWrapper || !pdfContainer) return;

  cleanupAnnotateStage();
  pdfWrapper.classList.remove('hidden');
  pdfContainer.classList.remove('hidden');

  const { default: EmbedPDF } = await import('embedpdf-snippet');
  const disabledCategories = getEditorDisabledCategories();
  viewerInstance =
    EmbedPDF.init({
      disabledCategories,
      type: 'container',
      target: pdfContainer,
      worker: true,
      wasmUrl: embedPdfWasmUrl,
      export: {
        defaultFileName: currentFileName,
      },
      documentManager: {
        maxDocuments: 1,
      },
      tabBar: 'never',
    }) ?? null;

  if (!viewerInstance) return;

  const registry = await viewerInstance.registry;
  docManagerPlugin = registry
    .getPlugin('document-manager')
    .provides() as unknown as DocManagerPlugin;
  historyPlugin = getRegistryPlugin<HistoryPlugin>(registry, 'history');
  printPlugin = getRegistryPlugin<PrintPlugin>(registry, 'print');
  unbindHistory?.();
  const unbind = historyPlugin?.onHistoryChange(() => {
    syncToolOutputToolbar();
  });
  unbindHistory = typeof unbind === 'function' ? unbind : null;

  docManagerPlugin.onDocumentOpened((data: { id?: string; name?: string }) => {
    activateStampToolIfNeeded(registry, data?.id);
  });

  const bufferCopy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;

  docManagerPlugin.openDocumentBuffer({
    buffer: bufferCopy,
    name: makeUniqueFileKey(0, currentFileName),
    autoActivate: true,
  });

  isViewerInitialized = true;
  exportEditedPdf = async (): Promise<Uint8Array> => {
    const exportPlugin = registry.getPlugin('export').provides() as {
      saveAsCopy: () => { toPromise: () => Promise<ArrayBuffer> };
    };
    const arrayBuffer = await exportPlugin.saveAsCopy().toPromise();
    return new Uint8Array(arrayBuffer);
  };
  syncToolOutputToolbar();
}

function bindFillSignHistory(
  application: NonNullable<PDFViewerWindow['PDFViewerApplication']>
): void {
  unbindFillSignHistory?.();
  fillSignEditorHistory = EMPTY_PDFJS_EDITOR_HISTORY;
  const unbindEvents = bindPdfJsEditorHistory(application, (next) => {
    fillSignEditorHistory = next;
    syncToolOutputToolbar();
  });
  const storage = application.pdfDocument?.annotationStorage as
    | {
        onSetModified?: (() => void) | null;
        onResetModified?: (() => void) | null;
      }
    | undefined;
  const previousModified = storage?.onSetModified;
  const previousReset = storage?.onResetModified;
  if (storage) {
    storage.onSetModified = () => {
      previousModified?.();
      fillSignFormDirty = true;
      if (!fillSignEditorHistory.hasEdits || !fillSignEditorHistory.canUndo) {
        fillSignEditorHistory = {
          ...fillSignEditorHistory,
          hasEdits: true,
          canUndo: true,
        };
      }
      syncToolOutputToolbar();
    };
    storage.onResetModified = () => {
      previousReset?.();
      fillSignFormDirty = false;
      syncToolOutputToolbar();
    };
  }
  unbindFillSignHistory = () => {
    unbindEvents();
    if (storage) {
      storage.onSetModified = previousModified ?? null;
      storage.onResetModified = previousReset ?? null;
    }
  };
}

async function mountFillSignStage(bytes: Uint8Array): Promise<void> {
  const pdfWrapper = document.getElementById('embed-pdf-wrapper');
  const fillSignStage = document.getElementById('fill-sign-stage');
  const container = document.getElementById('canvas-container-sign');
  if (!pdfWrapper || !fillSignStage || !container) return;

  cleanupFillSignStage();
  pdfWrapper.classList.remove('hidden');
  fillSignStage.classList.remove('hidden');

  const loadVersion = ++fillSignLoadVersion;
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  fillSignBlobUrl = URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  iframe.title =
    activeEntryId === 'form-filler'
      ? 'Interactive PDF form editor'
      : 'Visual signature editor';
  iframe.className = 'shift-pdf-viewer-frame';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';

  const viewerUrl = new URL(
    `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html`,
    window.location.origin
  );
  const query = new URLSearchParams({
    file: withPdfViewerFilename(fillSignBlobUrl, currentFileName),
    bentoSign: '1',
    shiftLaunchpad: '1',
  });
  iframe.src = `${viewerUrl.toString()}?${query.toString()}`;

  iframe.addEventListener('load', () => {
    if (fillSignIframe !== iframe || loadVersion !== fillSignLoadVersion) {
      return;
    }
    hidePdfJsPrintControls(iframe.contentDocument);
    void (async () => {
      try {
        const app = await waitForPdfJsSignViewer(iframe);
        fillSignApp = app;
        applyPdfViewerDownloadFilename(app, currentFileName);
        configureSessionOnlySignatureUi(iframe, app, {
          autoActivateSignatureMode: shouldAutoArmSignatureMode(activeEntryId),
        });
        fillSignViewerReady = true;
        bindFillSignHistory(app);
        syncToolOutputToolbar();
      } catch (error) {
        console.error('Could not initialize PDF.js viewer:', error);
        showAlert(
          'Viewer failed to load',
          error instanceof Error
            ? error.message
            : 'Could not initialize the Fill & Sign editor.'
        );
      } finally {
        hideLoader();
      }
    })();
  });

  container.appendChild(iframe);
  fillSignIframe = iframe;
}

function recordCurrentCropFromCropper(): void {
  if (!cropInstance) return;
  const currentCrop = cropInstance.getData(true);
  const imageData = cropInstance.getImageData();
  if (!imageData.naturalWidth || !imageData.naturalHeight) return;

  const cropPercentages = {
    x: currentCrop.x / imageData.naturalWidth,
    y: currentCrop.y / imageData.naturalHeight,
    width: currentCrop.width / imageData.naturalWidth,
    height: currentCrop.height / imageData.naturalHeight,
  };
  cropHistory.recordCrop(cropCurrentPageNum, cropPercentages);
  syncToolOutputToolbar();
}

function applySavedCropToCropper(pageNum: number): void {
  if (!cropInstance) return;
  const savedCrop = cropHistory.pageCrops[pageNum];
  if (!savedCrop) return;
  const imageData = cropInstance.getImageData();
  cropInstance.setData({
    x: savedCrop.x * imageData.naturalWidth,
    y: savedCrop.y * imageData.naturalHeight,
    width: savedCrop.width * imageData.naturalWidth,
    height: savedCrop.height * imageData.naturalHeight,
  });
}

function updateCropControls(): void {
  const totalPages = cropPdfDoc?.numPages ?? 1;
  const pageInfo = document.getElementById('page-info');
  if (pageInfo) {
    pageInfo.textContent = `Page ${cropCurrentPageNum} of ${totalPages}`;
  }
  const prevBtn = document.getElementById(
    'prev-page'
  ) as HTMLButtonElement | null;
  const nextBtn = document.getElementById(
    'next-page'
  ) as HTMLButtonElement | null;
  if (prevBtn) prevBtn.disabled = cropCurrentPageNum <= 1;
  if (nextBtn) nextBtn.disabled = cropCurrentPageNum >= totalPages;
}

async function displayCropPage(pageNum: number): Promise<void> {
  if (!cropPdfDoc) return;
  const page = await cropPdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.5 });

  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  tempCanvas.width = viewport.width;
  tempCanvas.height = viewport.height;
  if (page.render) {
    await page.render({
      canvas: null,
      canvasContext: tempCtx,
      viewport,
    }).promise;
  }

  if (cropInstance) {
    cropInstance.destroy();
    cropInstance = null;
  }

  const cropperEditor = document.getElementById('cropper-editor');
  cropperEditor?.classList.remove('hidden');

  const container = document.getElementById('cropper-container');
  if (!container) return;

  container.innerHTML = '';
  const image = document.createElement('img');
  try {
    image.src = tempCanvas.toDataURL('image/png');
  } catch {
    image.src = 'data:image/png;base64,';
  }
  container.appendChild(image);

  image.onload = () => {
    cropInstance = new Cropper(image, {
      viewMode: 1,
      background: false,
      autoCropArea: 0.8,
      responsive: true,
      rotatable: false,
      zoomable: false,
      cropend() {
        recordCurrentCropFromCropper();
      },
    });
    applySavedCropToCropper(pageNum);
    updateCropControls();
    syncToolOutputToolbar();
    hideLoader();
  };

  updateCropControls();
}

async function mountCropStage(bytes: Uint8Array): Promise<void> {
  const pdfWrapper = document.getElementById('embed-pdf-wrapper');
  const cropperEditor = document.getElementById('cropper-editor');
  if (!pdfWrapper || !cropperEditor) return;

  cleanupCropStage();
  pdfWrapper.classList.remove('hidden');
  cropperEditor.classList.remove('hidden');

  const loadingTask = getPDFDocument({ data: bytes.slice(0) });
  cropPdfDoc = (await loadingTask.promise) as unknown as CropPdfJsDocument & {
    destroy?: () => void;
  };
  cropCurrentPageNum = 1;
  await displayCropPage(1);
}

export async function exportWorkingPdfBytes(): Promise<Uint8Array | null> {
  if (!workingPdfBytes) return null;

  if (activeMode === 'annotate') {
    if (isViewerInitialized && exportEditedPdf && annotateHasEdits()) {
      const exported = await exportEditedPdf();
      workingPdfBytes = exported;
      return exported;
    }
    return workingPdfBytes;
  }

  if (activeMode === 'fill-sign') {
    const app = getFillSignViewerApplication();
    if (fillSignViewerReady && app?.pdfDocument && fillSignHasEdits()) {
      const shouldFlatten = isFlattenChecked();
      const exported = shouldFlatten
        ? await exportFlattenedSignedPdf(app.pdfDocument)
        : await exportPdfJsAnnotations(app.pdfDocument);
      workingPdfBytes = new Uint8Array(exported);
      return workingPdfBytes;
    }
    return workingPdfBytes;
  }

  // Crop mode
  if (cropPdfDoc && cropHistory.hasCrops()) {
    const effectiveCrops = cropHistory.resolveEffectiveCropData(
      cropPdfDoc.numPages,
      cropCurrentPageNum,
      isApplyToAllCropChecked()
    );
    if (Object.keys(effectiveCrops).length > 0) {
      const exported = isDestructiveCropChecked()
        ? await performFlatteningCrop(
            workingPdfBytes,
            cropPdfDoc,
            effectiveCrops
          )
        : await performMetadataCrop(
            workingPdfBytes,
            cropPdfDoc,
            effectiveCrops
          );
      workingPdfBytes = new Uint8Array(exported);
      return workingPdfBytes;
    }
  }

  return workingPdfBytes;
}

export async function loadWorkingPdf(bytes: Uint8Array): Promise<void> {
  workingPdfBytes = new Uint8Array(bytes);
  syncModeTabsAndChrome();

  if (activeMode === 'annotate') {
    await mountAnnotateStage(workingPdfBytes);
    return;
  }
  if (activeMode === 'fill-sign') {
    await mountFillSignStage(workingPdfBytes);
    return;
  }
  await mountCropStage(workingPdfBytes);
}

async function switchEditPdfMode(nextMode: EditPdfMode): Promise<void> {
  if (nextMode === activeMode || modeSwitchInFlight) return;
  modeSwitchInFlight = true;

  try {
    const hadEditsInOutgoingMode = currentModeHasEdits();
    const bytesToHandOff = hasLoadedDocument()
      ? await exportWorkingPdfBytes()
      : null;

    if (hadEditsInOutgoingMode) {
      hasAccumulatedModeEdits = true;
    }

    if (activeMode === 'annotate') cleanupAnnotateStage();
    else if (activeMode === 'fill-sign') cleanupFillSignStage();
    else cleanupCropStage();

    activeMode = nextMode;
    const nextEntryId = entryIdForEditPdfMode(nextMode, activeEntryId);
    activeEntryId = setLaunchContext(nextEntryId, document).entryId;
    syncModeTabsAndChrome();

    if (bytesToHandOff) {
      await loadWorkingPdf(bytesToHandOff);
    }
  } catch (error) {
    console.error('Failed to switch Edit PDF mode:', error);
    showAlert('Error', 'Could not switch editor modes.');
  } finally {
    modeSwitchInFlight = false;
    syncToolOutputToolbar();
  }
}

async function applyEditedPdf(): Promise<void> {
  if (!hasLoadedDocument() || !workingPdfBytes) return;

  try {
    if (activeMode === 'fill-sign') {
      const app = getFillSignViewerApplication();
      const shouldFlatten = isFlattenChecked();
      let outputBytes: Uint8Array;
      if (app?.pdfDocument) {
        outputBytes = shouldFlatten
          ? await exportFlattenedSignedPdf(app.pdfDocument)
          : await exportPdfJsAnnotations(app.pdfDocument);
      } else {
        outputBytes = workingPdfBytes;
      }
      workingPdfBytes = new Uint8Array(outputBytes);
      const filename =
        activeEntryId === 'form-filler' && !shouldFlatten
          ? getDerivedPdfFilename(currentFileName, '_filled')
          : getSignedPdfFilename(currentFileName, shouldFlatten);
      downloadFile(
        new Blob([new Uint8Array(outputBytes)], { type: 'application/pdf' }),
        filename
      );
      return;
    }

    if (activeMode === 'crop') {
      if (cropInstance && !cropHistory.hasCrops()) {
        recordCurrentCropFromCropper();
      }
      if (!cropPdfDoc) return;
      const effectiveCrops = cropHistory.resolveEffectiveCropData(
        cropPdfDoc.numPages,
        cropCurrentPageNum,
        isApplyToAllCropChecked()
      );
      let outputBytes = workingPdfBytes;
      if (Object.keys(effectiveCrops).length > 0) {
        outputBytes = isDestructiveCropChecked()
          ? await performFlatteningCrop(
              workingPdfBytes,
              cropPdfDoc,
              effectiveCrops
            )
          : await performMetadataCrop(
              workingPdfBytes,
              cropPdfDoc,
              effectiveCrops
            );
        workingPdfBytes = new Uint8Array(outputBytes);
      }
      downloadFile(
        new Blob([new Uint8Array(outputBytes)], { type: 'application/pdf' }),
        currentFileName
      );
      return;
    }

    // Annotate & Redact mode
    let outputBytes = workingPdfBytes;
    if (exportEditedPdf) {
      outputBytes = await exportEditedPdf();
      workingPdfBytes = new Uint8Array(outputBytes);
    }
    downloadFile(
      new Blob([new Uint8Array(outputBytes)], { type: 'application/pdf' }),
      currentFileName
    );
  } catch (err) {
    console.error('Error exporting PDF:', err);
    showAlert('Error', 'Failed to export the edited PDF.');
  }
}

async function printEditedPdf(): Promise<void> {
  if (activeMode === 'fill-sign' && fillSignIframe) {
    await printPdfJsViewerFrame(fillSignIframe);
    return;
  }
  if (activeMode === 'annotate' && printPlugin) {
    const task = printPlugin.print();
    if (task && typeof task.wait === 'function') {
      await new Promise<void>((resolve, reject) => {
        task.wait!(
          () => resolve(),
          (error) =>
            reject(error instanceof Error ? error : new Error('Print failed.'))
        );
      });
      return;
    }
  }
  const bytes = await exportWorkingPdfBytes();
  if (!bytes) {
    throw new Error('Printing is unavailable in this editor.');
  }
  await printPdfBlob(
    new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  );
}

function undoActiveMode(): void {
  if (activeMode === 'annotate') {
    historyPlugin?.undo();
    return;
  }
  if (activeMode === 'fill-sign') {
    undoPdfJsEditor(getFillSignViewerApplication());
    return;
  }
  cropHistory.undo();
  applySavedCropToCropper(cropCurrentPageNum);
  syncToolOutputToolbar();
}

function redoActiveMode(): void {
  if (activeMode === 'annotate') {
    historyPlugin?.redo();
    return;
  }
  if (activeMode === 'fill-sign') {
    redoPdfJsEditor(getFillSignViewerApplication());
    return;
  }
  cropHistory.redo();
  applySavedCropToCropper(cropCurrentPageNum);
  syncToolOutputToolbar();
}

function canUndoActiveMode(): boolean {
  if (activeMode === 'annotate') return historyPlugin?.canUndo() ?? false;
  if (activeMode === 'fill-sign') return fillSignEditorHistory.canUndo;
  return cropHistory.canUndo();
}

function canRedoActiveMode(): boolean {
  if (activeMode === 'annotate') return historyPlugin?.canRedo() ?? false;
  if (activeMode === 'fill-sign') return fillSignEditorHistory.canRedo;
  return cropHistory.canRedo();
}

async function changeCropPage(offset: number): Promise<void> {
  if (!cropPdfDoc) return;
  const nextPage = cropCurrentPageNum + offset;
  if (nextPage < 1 || nextPage > cropPdfDoc.numPages) return;
  cropCurrentPageNum = nextPage;
  await displayCropPage(cropCurrentPageNum);
}

function renderSingleFileEntry(fileDisplayArea: HTMLElement, file: File): void {
  fileDisplayArea.innerHTML = '';
  const fileDiv = document.createElement('div');
  fileDiv.className =
    'flex items-center justify-between bg-gray-700 p-3 rounded-lg';
  mountToolInputPreview(fileDiv, file);

  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex flex-col flex-1 min-w-0';

  const nameSpan = document.createElement('div');
  nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
  nameSpan.textContent = file.name;

  const metaSpan = document.createElement('div');
  metaSpan.className = 'text-xs text-gray-400';
  metaSpan.textContent = formatBytes(file.size);

  infoContainer.append(nameSpan, metaSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
  removeBtn.title = `Remove ${file.name}`;
  removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
  removeBtn.setAttribute('data-remove-btn', 'true');
  removeBtn.onclick = () => {
    resetViewer();
  };

  fileDiv.append(infoContainer, removeBtn);
  fileDisplayArea.appendChild(fileDiv);
  createIcons({ icons });
}

async function handleFiles(files: FileList | File[]): Promise<boolean> {
  const pdfFiles = Array.from(files).filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  if (pdfFiles.length === 0) {
    showAlert('Invalid File', 'Please upload a valid PDF file.');
    return false;
  }

  showLoader('Loading PDF Editor...');

  try {
    const fileDisplayArea = document.getElementById('file-display-area');
    if (!fileDisplayArea) return false;

    hideLoader();
    const decryptedFiles = await batchDecryptIfNeeded([pdfFiles[0]]);
    showLoader('Loading PDF Editor...');

    if (decryptedFiles.length === 0) {
      hideLoader();
      return false;
    }

    const firstFile = decryptedFiles[0];
    currentFileName = firstFile.name;
    hasAccumulatedModeEdits = false;
    const firstBuffer = await firstFile.arrayBuffer();

    renderSingleFileEntry(fileDisplayArea, firstFile);
    setWorkspaceFilesFromTool([firstFile]);

    await loadWorkingPdf(new Uint8Array(firstBuffer));
    return true;
  } catch (error) {
    console.error('Error loading PDF Editor:', error);
    showAlert('Error', 'Failed to load the PDF Editor.');
    return false;
  } finally {
    hideLoader();
  }
}

export function initializeEditPdfPage(): void {
  const context = applyLaunchContextToDom(document);
  activeEntryId = context.entryId;
  activeMode = resolveInitialEditPdfMode(activeEntryId);

  createIcons({ icons });
  registerToolOutputSession({
    reset: resetViewer,
    apply: applyEditedPdf,
    print: printEditedPdf,
    undo: undoActiveMode,
    redo: redoActiveMode,
    canUndo: canUndoActiveMode,
    canRedo: canRedoActiveMode,
    canReset: hasLoadedDocument,
    canSave: () => editorHasEdits(),
    canPrint: () => hasLoadedDocument(),
  });

  syncModeTabsAndChrome();

  const fileInput = document.getElementById(
    'file-input'
  ) as HTMLInputElement | null;
  const dropZone = document.getElementById('drop-zone');

  if (fileInput) {
    fileInput.multiple = false;
    fileInput.removeAttribute('multiple');
    fileInput.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files && input.files.length > 0) {
        void handleFiles(input.files);
      }
    });
    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('border-indigo-500');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('border-indigo-500');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-indigo-500');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        void handleFiles(files);
      }
    });
  }

  document
    .getElementById('mode-annotate-btn')
    ?.addEventListener('click', () => {
      void switchEditPdfMode('annotate');
    });
  document
    .getElementById('mode-fill-sign-btn')
    ?.addEventListener('click', () => {
      void switchEditPdfMode('fill-sign');
    });
  document.getElementById('mode-crop-btn')?.addEventListener('click', () => {
    void switchEditPdfMode('crop');
  });

  document.getElementById('shift-sign-add')?.addEventListener('click', () => {
    openPdfJsSignatureDialog(fillSignIframe, getFillSignViewerApplication());
  });
  document
    .getElementById('flatten-signature-toggle')
    ?.addEventListener('change', () => {
      syncToolOutputToolbar();
    });

  document.getElementById('prev-page')?.addEventListener('click', () => {
    void changeCropPage(-1);
  });
  document.getElementById('next-page')?.addEventListener('click', () => {
    void changeCropPage(1);
  });

  if (!moduleListenersBound) {
    moduleListenersBound = true;
    onToolFilesSeeded(() => {
      if (hasLoadedDocument() || state.files.length === 0) return;
      void handleFiles([state.files[0]]);
    });
    listenForShiftFileHandoff({
      onFile: (file) => {
        markFileFromHandoff(file);
        return handleFiles([file]);
      },
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeEditPdfPage);
} else {
  initializeEditPdfPage();
}
