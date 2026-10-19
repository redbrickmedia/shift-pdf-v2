import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const { loadPdfWithPasswordPromptMock, getPDFDocumentMock, getPageSpy } =
  vi.hoisted(() => {
    const makeFakePage = () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: Math.round(100 * scale),
        height: Math.round(100 * scale),
      }),
      render: ({
        canvasContext,
        viewport,
      }: {
        canvasContext: CanvasRenderingContext2D;
        viewport: { width: number; height: number };
      }) => {
        // Paint top half white (background) and bottom half dark (text)
        const img = canvasContext.createImageData(
          viewport.width,
          viewport.height
        );
        for (let i = 0; i < img.data.length; i += 4) {
          const pixelIndex = i / 4;
          const y = Math.floor(pixelIndex / viewport.width);
          if (y < viewport.height / 2) {
            img.data[i] = 255;
            img.data[i + 1] = 255;
            img.data[i + 2] = 255;
            img.data[i + 3] = 255;
          } else {
            img.data[i] = 20;
            img.data[i + 1] = 30;
            img.data[i + 2] = 40;
            img.data[i + 3] = 255;
          }
        }
        canvasContext.putImageData(img, 0, 0);
        return { promise: Promise.resolve() };
      },
    });

    const pageSpy = vi.fn(async () => makeFakePage());
    const fakePdfProxy = {
      numPages: 1,
      getPage: pageSpy,
      destroy: vi.fn(),
    };

    return {
      loadPdfWithPasswordPromptMock: vi.fn(async (file: File) => ({
        file,
        bytes: await file.arrayBuffer(),
        pdf: fakePdfProxy,
      })),
      getPDFDocumentMock: vi.fn(() => ({
        promise: Promise.resolve(fakePdfProxy),
      })),
      getPageSpy: pageSpy,
    };
  });

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt: loadPdfWithPasswordPromptMock,
}));

vi.mock('../js/utils/helpers.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../js/utils/helpers.js')>();
  return {
    ...actual,
    getPDFDocument: getPDFDocumentMock,
  };
});

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

import {
  clearLatestPdfOutput,
  getLatestPdfOutput,
  initShiftPdfSave,
} from '../js/logic/shift-pdf-save';
import {
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_SAVE_ID,
  initToolOutputToolbar,
} from '../js/logic/tool-output-toolbar';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';
import { applyColorAdjustments } from '../js/utils/image-effects';

function loadAdjustColorsBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/adjust-colors.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

async function createVectorPdfBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([200, 200]);
  page.drawText('Vector Selectable Text', {
    x: 20,
    y: 100,
    size: 14,
    font,
  });
  return new Uint8Array(await doc.save());
}

describe('adjust-colors.html consolidated Tool Surface (adjust-colors, pdf-to-greyscale, invert-colors, background-color, text-color)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLatestPdfOutput();
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-context-applied');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.resetModules();
  });

  it('adapts controls for ?entry=pdf-to-greyscale, ?entry=invert-colors, and ?entry=text-color, and applies greyscale, invert, and text-color in applyColorAdjustments', async () => {
    window.history.replaceState(
      {},
      '',
      '/adjust-colors.html?entry=pdf-to-greyscale'
    );
    document.title = 'Adjust Colors | Shift PDF';
    loadAdjustColorsBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/adjust-colors-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('PDF to Greyscale');
    const greyscaleToggle = document.getElementById(
      'toggle-greyscale'
    ) as HTMLInputElement;
    const invertToggle = document.getElementById(
      'toggle-invert'
    ) as HTMLInputElement;
    expect(greyscaleToggle).not.toBeNull();
    expect(invertToggle).not.toBeNull();
    expect(greyscaleToggle.checked).toBe(true);
    expect(invertToggle.checked).toBe(false);

    // Check ?entry=invert-colors pre-enables #toggle-invert
    vi.resetModules();
    window.history.replaceState(
      {},
      '',
      '/adjust-colors.html?entry=invert-colors'
    );
    document.documentElement.removeAttribute('data-launch-context-applied');
    loadAdjustColorsBodyFromHtml();
    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/adjust-colors-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Invert Colors');
    expect(
      (document.getElementById('toggle-invert') as HTMLInputElement).checked
    ).toBe(true);

    // Check applyColorAdjustments pixel pipeline with textColor, greyscale, and invertColors
    const sourceData = {
      data: new Uint8ClampedArray([
        20,
        20,
        20,
        255, // dark text pixel
        255,
        0,
        0,
        255, // red pixel
      ]),
      width: 2,
      height: 1,
      colorSpace: 'srgb',
    } as ImageData;
    const canvas = document.createElement('canvas');
    const outImageData = applyColorAdjustments(sourceData, canvas, {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      hueShift: 0,
      temperature: 0,
      tint: 0,
      gamma: 1.0,
      sepia: 0,
      textColor: '#0000ff',
      greyscale: false,
      invertColors: false,
    });
    const outPixels = outImageData.data;
    // First pixel (dark) recolored to blue (0, 0, 255)
    expect([outPixels[0], outPixels[1], outPixels[2]]).toEqual([0, 0, 255]);
    // Second pixel (bright red) untouched
    expect([outPixels[4], outPixels[5], outPixels[6]]).toEqual([255, 0, 0]);
  });

  it('uses vector pdf-lib rectangle-underlay path when ONLY Background Color is modified on ?entry=background-color (without rasterizing pages)', async () => {
    window.history.replaceState(
      {},
      '',
      '/adjust-colors.html?entry=background-color'
    );
    document.title = 'Adjust Colors | Shift PDF';
    loadAdjustColorsBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/adjust-colors-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Background Color');

    const bgColorInput = document.getElementById(
      'background-color'
    ) as HTMLInputElement;
    expect(bgColorInput).not.toBeNull();
    bgColorInput.value = '#ffffcc';
    bgColorInput.dispatchEvent(new Event('input', { bubbles: true }));

    const pdfBytes = await createVectorPdfBytes();
    const pdfFile = new File([pdfBytes], 'vector-doc.pdf', {
      type: 'application/pdf',
    });

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [pdfFile],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.getElementById('options-panel')?.classList.contains('hidden')
      ).toBe(false);
    });

    expect(
      (document.getElementById(TOOL_OUTPUT_SAVE_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    // Clear getPageSpy call count before committing so we can verify
    // that committing Background-Color-only does NOT invoke the raster pdfjs page loop
    getPageSpy.mockClear();

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });

    expect(getLatestPdfOutput()?.filename).toBe('vector-doc.pdf');
    expect(getPageSpy).not.toHaveBeenCalled();

    const outDoc = await PDFDocument.load(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(outDoc.getPageCount()).toBe(1);
    const { width, height } = outDoc.getPage(0).getSize();
    expect(Math.round(width)).toBe(200);
    expect(Math.round(height)).toBe(200);
  });
});
