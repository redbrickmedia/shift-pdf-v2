import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

const {
  embedPdfInitMock,
  openDocumentBufferMock,
  saveAsCopyToPromiseMock,
  executeCommandMock,
  setActiveToolMock,
  historyStateMock,
  waitForPdfJsSignViewerMock,
  exportPdfJsAnnotationsMock,
  exportFlattenedSignedPdfMock,
  getPDFDocumentMock,
  cropperInstances,
} = vi.hoisted(() => {
  const openDoc = vi.fn();
  const saveCopy = vi.fn(
    async () => new Uint8Array([37, 80, 68, 70, 45, 97, 110, 110]).buffer
  );
  const execCmd = vi.fn();
  const setTool = vi.fn();
  const histState = {
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
  };
  const instances: Array<{
    getData: () => { x: number; y: number; width: number; height: number };
    getImageData: () => { naturalWidth: number; naturalHeight: number };
    setData: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    options: { cropend?: () => void };
  }> = [];

  return {
    embedPdfInitMock: vi.fn(),
    openDocumentBufferMock: openDoc,
    saveAsCopyToPromiseMock: saveCopy,
    executeCommandMock: execCmd,
    setActiveToolMock: setTool,
    historyStateMock: histState,
    waitForPdfJsSignViewerMock: vi.fn(),
    exportPdfJsAnnotationsMock: vi.fn(
      async () => new Uint8Array([37, 80, 68, 70, 45, 115, 105, 103, 110])
    ),
    exportFlattenedSignedPdfMock: vi.fn(
      async () => new Uint8Array([37, 80, 68, 70, 45, 102, 108, 97, 116])
    ),
    getPDFDocumentMock: vi.fn(),
    cropperInstances: instances,
  };
});

vi.mock('embedpdf-snippet', () => ({
  default: {
    init: embedPdfInitMock,
  },
}));

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  batchDecryptIfNeeded: vi.fn(async (files: File[]) => files),
  loadPdfWithPasswordPrompt: vi.fn(async (file: File) => ({
    file,
    bytes: await file.arrayBuffer(),
    pdf: {
      numPages: 2,
      destroy: vi.fn(),
      getPage: vi.fn(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 200 * scale,
          height: 400 * scale,
          convertToPdfPoint: (x: number, y: number): [number, number] => [
            x,
            400 - y,
          ],
        }),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
      })),
    },
  })),
}));

vi.mock('../js/utils/pdfjs.js', () => ({
  pdfjsLib: {},
  getPDFDocument: getPDFDocumentMock,
}));

vi.mock('../js/utils/sign-pdf-export.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../js/utils/sign-pdf-export.js')>();
  return {
    ...actual,
    exportPdfJsAnnotations: exportPdfJsAnnotationsMock,
    exportFlattenedSignedPdf: exportFlattenedSignedPdfMock,
  };
});

vi.mock('../js/utils/pdfjs-sign-viewer.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../js/utils/pdfjs-sign-viewer.js')>();
  return {
    ...actual,
    waitForPdfJsSignViewer: waitForPdfJsSignViewerMock,
  };
});

vi.mock('cropperjs', () => ({
  default: class FakeCropper {
    options: { cropend?: () => void };
    setData = vi.fn();
    destroy = vi.fn();
    private data = { x: 20, y: 40, width: 100, height: 200 };
    constructor(_img: HTMLImageElement, options: { cropend?: () => void }) {
      this.options = options;
      cropperInstances.push(this);
    }
    getData() {
      return this.data;
    }
    getImageData() {
      return { naturalWidth: 200, naturalHeight: 400 };
    }
  },
}));

import {
  entryIdForEditPdfMode,
  resolveInitialEditPdfMode,
  shouldAutoActivateStampTool,
  shouldAutoArmSignatureMode,
} from '../js/logic/edit-pdf-modes';
import {
  CropHistoryController,
  performFlatteningCrop,
  performMetadataCrop,
} from '../js/logic/edit-pdf-crop';
import {
  clearLatestPdfOutput,
  getLatestPdfOutput,
  initShiftPdfSave,
} from '../js/logic/shift-pdf-save';
import {
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_REDO_ID,
  TOOL_OUTPUT_UNDO_ID,
  initToolOutputToolbar,
} from '../js/logic/tool-output-toolbar';

function loadEditPdfBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/edit-pdf.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = bodyHtml;
}

describe('edit-pdf Launch Context & mode resolution', () => {
  it('resolves the initial mode from ?entry=<id> and maps mode switches back to Catalog Entry IDs', () => {
    expect(resolveInitialEditPdfMode('edit-pdf')).toBe('annotate');
    expect(resolveInitialEditPdfMode('add-stamps')).toBe('annotate');
    expect(resolveInitialEditPdfMode('sign-pdf')).toBe('fill-sign');
    expect(resolveInitialEditPdfMode('form-filler')).toBe('fill-sign');
    expect(resolveInitialEditPdfMode('crop-pdf')).toBe('crop');
    expect(resolveInitialEditPdfMode('unknown')).toBe('annotate');

    expect(entryIdForEditPdfMode('annotate', 'add-stamps')).toBe('edit-pdf');
    expect(entryIdForEditPdfMode('fill-sign', 'edit-pdf')).toBe('sign-pdf');
    expect(entryIdForEditPdfMode('fill-sign', 'form-filler')).toBe(
      'form-filler'
    );
    expect(entryIdForEditPdfMode('crop', 'sign-pdf')).toBe('crop-pdf');
  });

  it('distinguishes Add Stamps and Form Filler Launch Context behaviors', () => {
    expect(shouldAutoActivateStampTool('add-stamps')).toBe(true);
    expect(shouldAutoActivateStampTool('edit-pdf')).toBe(false);

    expect(shouldAutoArmSignatureMode('sign-pdf')).toBe(true);
    expect(shouldAutoArmSignatureMode('form-filler')).toBe(false);
  });
});

describe('edit-pdf Crop history and crop execution', () => {
  it('tracks per-page crop boxes with undo, redo, reset, and apply-to-all resolution', () => {
    const history = new CropHistoryController();
    expect(history.hasCrops()).toBe(false);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);

    history.recordCrop(1, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(history.hasCrops()).toBe(true);
    expect(history.canUndo()).toBe(true);
    expect(history.pageCrops[1]).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
    });

    history.recordCrop(2, { x: 0.2, y: 0.2, width: 0.6, height: 0.6 });
    expect(Object.keys(history.pageCrops)).toHaveLength(2);

    history.undo();
    expect(history.pageCrops[2]).toBeUndefined();
    expect(history.pageCrops[1]).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
    });
    expect(history.canRedo()).toBe(true);

    history.redo();
    expect(history.pageCrops[2]).toEqual({
      x: 0.2,
      y: 0.2,
      width: 0.6,
      height: 0.6,
    });

    const allPages = history.resolveEffectiveCropData(3, 1, true);
    expect(allPages).toEqual({
      1: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      2: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      3: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    });

    history.reset();
    expect(history.hasCrops()).toBe(false);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it('performs metadata crop (CropBox) and destructive flattening crop on PDF bytes', async () => {
    const srcDoc = await PDFDocument.create();
    srcDoc.addPage([200, 400]);
    srcDoc.addPage([200, 400]);
    const srcBytes = await srcDoc.save();

    const fakePdfJsDoc = {
      numPages: 2,
      getPage: vi.fn(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 200 * scale,
          height: 400 * scale,
          convertToPdfPoint: (x: number, y: number): [number, number] => [
            x,
            400 - y,
          ],
        }),
      })),
    };

    const croppedBytes = await performMetadataCrop(srcBytes, fakePdfJsDoc, {
      1: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
    });

    const loadedCropped = await PDFDocument.load(croppedBytes);
    const page1CropBox = loadedCropped.getPage(0).getCropBox();
    expect(page1CropBox.x).toBeCloseTo(20);
    expect(page1CropBox.y).toBeCloseTo(120);
    expect(page1CropBox.width).toBeCloseTo(100);
    expect(page1CropBox.height).toBeCloseTo(200);

    const png1x1 = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      ),
      (c) => c.charCodeAt(0)
    );

    const flattenedBytes = await performFlatteningCrop(
      srcBytes,
      fakePdfJsDoc,
      {
        1: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      },
      async () => ({
        pngBytes: png1x1.buffer.slice(
          png1x1.byteOffset,
          png1x1.byteOffset + png1x1.byteLength
        ),
        width: 100,
        height: 200,
      })
    );

    const loadedFlattened = await PDFDocument.load(flattenedBytes);
    expect(loadedFlattened.getPageCount()).toBe(2);
    expect(loadedFlattened.getPage(0).getSize()).toEqual({
      width: 100,
      height: 200,
    });
    expect(loadedFlattened.getPage(1).getSize()).toEqual({
      width: 200,
      height: 400,
    });
  });
});

describe('unified edit-pdf.html Tool Surface controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLatestPdfOutput();
    cropperInstances.length = 0;
    historyStateMock.canUndo = false;
    historyStateMock.canRedo = false;
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-context-applied');

    let openedCallback:
      | ((data: { id?: string; name?: string }) => void)
      | null = null;
    openDocumentBufferMock.mockImplementation(
      (opts: { name?: string; buffer: ArrayBuffer }) => {
        openedCallback?.({ id: 'doc-1', name: opts.name });
      }
    );

    embedPdfInitMock.mockImplementation(() => ({
      registry: Promise.resolve({
        getPlugin: (id: string) => {
          if (id === 'document-manager') {
            return {
              provides: () => ({
                onDocumentClosed: vi.fn(),
                onDocumentOpened: (
                  cb: (data: { id?: string; name?: string }) => void
                ) => {
                  openedCallback = cb;
                },
                openDocumentBuffer: openDocumentBufferMock,
                closeDocument: vi.fn(),
              }),
            };
          }
          if (id === 'history') {
            return {
              provides: () => ({
                undo: historyStateMock.undo,
                redo: historyStateMock.redo,
                canUndo: () => historyStateMock.canUndo,
                canRedo: () => historyStateMock.canRedo,
                getHistoryState: () => ({
                  global: {
                    canUndo: historyStateMock.canUndo,
                    canRedo: historyStateMock.canRedo,
                  },
                }),
                onHistoryChange: vi.fn(() => () => {}),
              }),
            };
          }
          if (id === 'export') {
            return {
              provides: () => ({
                saveAsCopy: () => ({
                  toPromise: saveAsCopyToPromiseMock,
                }),
              }),
            };
          }
          if (id === 'commands') {
            return {
              provides: () => ({
                execute: executeCommandMock,
                forDocument: () => ({ execute: executeCommandMock }),
              }),
            };
          }
          if (id === 'annotation') {
            return {
              provides: () => ({
                setActiveTool: setActiveToolMock,
                forDocument: () => ({ setActiveTool: setActiveToolMock }),
              }),
            };
          }
          return { provides: (): unknown => null };
        },
      }),
    }));

    getPDFDocumentMock.mockImplementation(() => ({
      promise: Promise.resolve({
        numPages: 2,
        destroy: vi.fn(),
        getPage: vi.fn(async () => ({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 200 * scale,
            height: 400 * scale,
            convertToPdfPoint: (x: number, y: number): [number, number] => [
              x,
              400 - y,
            ],
          }),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
        })),
      }),
    }));
  });

  it('configures single-document EmbedPDF (maxDocuments: 1, tabBar: never), pre-activates stamp tool on ?entry=add-stamps, and hands off PDF bytes in-memory across Annotate & Redact, Fill & Sign, and Crop', async () => {
    window.history.replaceState({}, '', '/edit-pdf.html?entry=add-stamps');
    document.title = 'PDF Editor | Shift PDF';
    loadEditPdfBodyFromHtml();

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    expect(fileInput.hasAttribute('multiple')).toBe(false);

    const { initializeEditPdfPage } =
      await import('../js/logic/edit-pdf-page.ts');
    initShiftPdfSave();
    initializeEditPdfPage();
    initToolOutputToolbar();

    const annotateBtn = document.getElementById(
      'mode-annotate-btn'
    ) as HTMLButtonElement;
    const fillSignBtn = document.getElementById(
      'mode-fill-sign-btn'
    ) as HTMLButtonElement;
    const cropBtn = document.getElementById(
      'mode-crop-btn'
    ) as HTMLButtonElement;

    expect(annotateBtn.getAttribute('aria-selected')).toBe('true');
    expect(fillSignBtn.getAttribute('aria-selected')).toBe('false');
    expect(cropBtn.getAttribute('aria-selected')).toBe('false');
    expect(document.getElementById('shift-sign-add')?.hidden).toBe(true);

    // Upload a valid 1-page PDF
    const srcDoc = await PDFDocument.create();
    srcDoc.addPage([200, 400]);
    const pdfBytes = await srcDoc.save();
    saveAsCopyToPromiseMock.mockResolvedValue(
      pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ) as ArrayBuffer
    );
    exportPdfJsAnnotationsMock.mockResolvedValue(new Uint8Array(pdfBytes));
    exportFlattenedSignedPdfMock.mockResolvedValue(new Uint8Array(pdfBytes));
    const pdfFile = new File([new Uint8Array(pdfBytes)], 'contract.pdf', {
      type: 'application/pdf',
    });

    Object.defineProperty(fileInput, 'files', {
      value: [pdfFile],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(embedPdfInitMock).toHaveBeenCalledTimes(1);
    });

    expect(embedPdfInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documentManager: { maxDocuments: 1 },
        tabBar: 'never',
      })
    );
    expect(executeCommandMock).toHaveBeenCalledWith(
      'annotation:add-stamp',
      'doc-1'
    );

    // Simulate an annotation edit in EmbedPDF
    historyStateMock.canUndo = true;

    // Switch to Fill & Sign mode -> exports working bytes in-memory without calling downloadFile
    const dispatchMock = vi.fn();
    waitForPdfJsSignViewerMock.mockResolvedValue({
      eventBus: { dispatch: dispatchMock, on: vi.fn(), _on: vi.fn() },
      pdfDocument: {
        numPages: 1,
        annotationStorage: { onSetModified: null, size: 1 },
        saveDocument: vi.fn(async () => pdfBytes),
      },
    });

    fillSignBtn.click();

    await vi.waitFor(() => {
      expect(fillSignBtn.getAttribute('aria-selected')).toBe('true');
      expect(
        document.querySelector('#canvas-container-sign iframe')
      ).not.toBeNull();
    });

    // Mode switch did NOT stage a downloadFile output yet
    expect(getLatestPdfOutput()).toBeNull();
    // SaveAsCopy was called to hand off annotated bytes in-memory
    expect(saveAsCopyToPromiseMock).toHaveBeenCalledTimes(1);
    // Launch Context synced to ?entry=sign-pdf
    expect(window.location.search).toBe('?entry=sign-pdf');
    // + Sign and Flatten controls are visible in Fill & Sign mode
    expect(document.getElementById('shift-sign-add')?.hidden).toBe(false);
    expect(
      document.querySelector<HTMLElement>('[data-viewer-chrome="flatten"]')
        ?.hidden
    ).toBe(false);

    const signIframe = document.querySelector<HTMLIFrameElement>(
      '#canvas-container-sign iframe'
    )!;
    expect(signIframe.src).toContain('bentoSign=1');
    expect(signIframe.src).toContain('shiftLaunchpad=1');
    signIframe.dispatchEvent(new Event('load'));

    await vi.waitFor(() => {
      expect(waitForPdfJsSignViewerMock).toHaveBeenCalled();
    });

    // Check Flatten toggle and commit via header Download -> calls exportFlattenedSignedPdf
    const flattenToggle = document.getElementById(
      'flatten-signature-toggle'
    ) as HTMLInputElement;
    flattenToggle.checked = true;
    flattenToggle.dispatchEvent(new Event('change'));

    exportFlattenedSignedPdfMock.mockResolvedValueOnce(
      new Uint8Array(pdfBytes)
    );
    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(exportFlattenedSignedPdfMock).toHaveBeenCalledTimes(1);
      expect(getLatestPdfOutput()).not.toBeNull();
    });

    clearLatestPdfOutput();

    // Switch to Crop mode -> exports Fill & Sign bytes in-memory and loads Cropper stage
    cropBtn.click();

    await vi.waitFor(() => {
      expect(cropBtn.getAttribute('aria-selected')).toBe('true');
      expect(
        document.getElementById('cropper-editor')?.classList.contains('hidden')
      ).toBe(false);
    });

    expect(window.location.search).toBe('?entry=crop-pdf');
    expect(document.getElementById('shift-sign-add')?.hidden).toBe(true);
    expect(
      document.querySelector<HTMLElement>('[data-viewer-chrome="flatten"]')
        ?.hidden
    ).toBe(true);

    // Trigger image load inside cropper-container so FakeCropper mounts
    const cropImg = document.querySelector<HTMLImageElement>(
      '#cropper-container img'
    );
    cropImg?.dispatchEvent(new Event('load'));

    await vi.waitFor(() => {
      expect(cropperInstances.length).toBeGreaterThan(0);
    });

    // Simulate crop gesture and verify Undo/Redo via header buttons
    cropperInstances[cropperInstances.length - 1]?.options.cropend?.();
    expect(
      (document.getElementById(TOOL_OUTPUT_UNDO_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    document.getElementById(TOOL_OUTPUT_UNDO_ID)?.click();
    expect(
      (document.getElementById(TOOL_OUTPUT_REDO_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    document.getElementById(TOOL_OUTPUT_REDO_ID)?.click();

    // Commit Crop output via header Download
    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();
    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toBe('contract.pdf');
  });

  it('opens ?entry=form-filler in Fill & Sign mode without auto-arming PDFJS_SIGNATURE_MODE', async () => {
    window.history.replaceState({}, '', '/edit-pdf.html?entry=form-filler');
    document.title = 'PDF Editor | Shift PDF';
    loadEditPdfBodyFromHtml();

    const { initializeEditPdfPage } =
      await import('../js/logic/edit-pdf-page.ts');
    initShiftPdfSave();
    initializeEditPdfPage();
    initToolOutputToolbar();

    const fillSignBtn = document.getElementById(
      'mode-fill-sign-btn'
    ) as HTMLButtonElement;
    expect(fillSignBtn.getAttribute('aria-selected')).toBe('true');

    const srcDoc = await PDFDocument.create();
    srcDoc.addPage([200, 400]);
    const pdfBytes = await srcDoc.save();
    const pdfFile = new File([new Uint8Array(pdfBytes)], 'tax-form.pdf', {
      type: 'application/pdf',
    });

    const dispatchMock = vi.fn();
    waitForPdfJsSignViewerMock.mockResolvedValue({
      eventBus: { dispatch: dispatchMock, on: vi.fn(), _on: vi.fn() },
      pdfDocument: {
        numPages: 1,
        annotationStorage: { onSetModified: null, size: 0 },
        saveDocument: vi.fn(async () => pdfBytes),
      },
    });

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [pdfFile],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.querySelector('#canvas-container-sign iframe')
      ).not.toBeNull();
    });

    const iframe = document.querySelector<HTMLIFrameElement>(
      '#canvas-container-sign iframe'
    )!;
    iframe.dispatchEvent(new Event('load'));

    await vi.waitFor(() => {
      expect(waitForPdfJsSignViewerMock).toHaveBeenCalled();
    });

    // Form filler does NOT dispatch switchannotationeditormode to PDFJS_SIGNATURE_MODE (101)
    expect(dispatchMock).not.toHaveBeenCalledWith(
      'switchannotationeditormode',
      expect.objectContaining({ mode: 101 })
    );
  });
});
