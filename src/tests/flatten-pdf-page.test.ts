import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

const {
  rasterizePdfMock,
  loadPyMuPDFMock,
  isPyMuPDFAvailableMock,
  batchDecryptIfNeededMock,
  flattenAnnotationsSpy,
} = vi.hoisted(() => {
  const rasterizeFn = vi.fn(
    async () =>
      new Blob([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], {
        type: 'application/pdf',
      })
  );
  return {
    rasterizePdfMock: rasterizeFn,
    loadPyMuPDFMock: vi.fn(async () => ({
      rasterizePdf: rasterizeFn,
    })),
    isPyMuPDFAvailableMock: vi.fn(() => true),
    batchDecryptIfNeededMock: vi.fn(async (files: File[]) => files),
    flattenAnnotationsSpy: vi.fn(),
  };
});

vi.mock('../js/utils/pymupdf-loader.js', () => ({
  loadPyMuPDF: loadPyMuPDFMock,
  isPyMuPDFAvailable: isPyMuPDFAvailableMock,
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  batchDecryptIfNeeded: batchDecryptIfNeededMock,
}));

vi.mock('../js/utils/flatten-annotations.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../js/utils/flatten-annotations.js')>();
  return {
    ...actual,
    flattenAnnotations: vi.fn((doc: PDFDocument) => {
      flattenAnnotationsSpy(doc);
      return actual.flattenAnnotations(doc);
    }),
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

function loadFlattenPdfBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/flatten-pdf.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

async function createFormPdfBytes(
  fieldValue = 'Alice'
): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();
  const textField = form.createTextField('applicant.name');
  textField.setText(fieldValue);
  textField.addToPage(page, { x: 20, y: 200, width: 150, height: 24 });
  return new Uint8Array(await doc.save());
}

describe('flatten-pdf.html consolidated Tool Surface (flatten-pdf, rasterize-pdf)', () => {
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

  it('defaults to Flatten Forms & Annotations on flatten-pdf.html with both checkboxes checked, switches to Rasterize Pages to Images on ?entry=rasterize-pdf without dropping loaded files, and stages .pdf for 1 file or .zip for 2+ files', async () => {
    window.history.replaceState({}, '', '/flatten-pdf.html');
    document.title = 'Flatten PDF | Shift PDF';
    loadFlattenPdfBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/flatten-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const modeFlattenBtn = document.getElementById(
      'mode-flatten'
    ) as HTMLButtonElement;
    const modeRasterizeBtn = document.getElementById(
      'mode-rasterize'
    ) as HTMLButtonElement;
    expect(modeFlattenBtn).not.toBeNull();
    expect(modeRasterizeBtn).not.toBeNull();
    expect(modeFlattenBtn.getAttribute('aria-pressed')).toBe('true');
    expect(modeRasterizeBtn.getAttribute('aria-pressed')).toBe('false');

    const flattenFormFields = document.getElementById(
      'flatten-form-fields'
    ) as HTMLInputElement;
    const flattenAnnots = document.getElementById(
      'flatten-annotations'
    ) as HTMLInputElement;
    expect(flattenFormFields.checked).toBe(true);
    expect(flattenAnnots.checked).toBe(true);

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);

    const pdfBytes1 = await createFormPdfBytes('Alice');
    const pdf1 = new File([pdfBytes1], 'form-1.pdf', {
      type: 'application/pdf',
    });

    Object.defineProperty(fileInput, 'files', {
      value: [pdf1],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.getElementById('tool-options')?.classList.contains('hidden')
      ).toBe(false);
    });

    expect(
      (document.getElementById(TOOL_OUTPUT_SAVE_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    // Uncheck flatten-annotations so only form fields are flattened
    flattenAnnots.checked = false;
    flattenAnnots.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toBe('flattened_form-1.pdf');
    expect(flattenAnnotationsSpy).not.toHaveBeenCalled();

    const flattenedDoc = await PDFDocument.load(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(flattenedDoc.getForm().getFields()).toHaveLength(0);

    // Add a second PDF and switch to Rasterize mode tab without dropping loaded files
    const pdfBytes2 = await createFormPdfBytes('Bob');
    const pdf2 = new File([pdfBytes2], 'form-2.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(fileInput, 'files', {
      value: [pdf2],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.getElementById('file-display-area')?.textContent
      ).toContain('form-2.pdf');
    });

    clearLatestPdfOutput();
    modeRasterizeBtn.click();

    expect(window.location.search).toBe('?entry=rasterize-pdf');
    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Rasterize PDF');
    expect(modeRasterizeBtn.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('file-display-area')?.textContent).toContain(
      'form-1.pdf'
    );
    expect(document.getElementById('file-display-area')?.textContent).toContain(
      'form-2.pdf'
    );

    const dpiSelect = document.getElementById(
      'rasterize-dpi'
    ) as HTMLSelectElement;
    const formatSelect = document.getElementById(
      'rasterize-format'
    ) as HTMLSelectElement;
    const grayscaleCheckbox = document.getElementById(
      'rasterize-grayscale'
    ) as HTMLInputElement;
    expect(dpiSelect.value).toBe('150');
    dpiSelect.value = '300';
    formatSelect.value = 'jpeg';
    grayscaleCheckbox.checked = true;

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toMatch(/\.zip$/);
    expect(rasterizePdfMock).toHaveBeenCalledTimes(2);
    expect(rasterizePdfMock).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        dpi: 300,
        format: 'jpeg',
        grayscale: true,
      })
    );

    const zip = await JSZip.loadAsync(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(Object.keys(zip.files).sort()).toEqual(['form-1.pdf', 'form-2.pdf']);
  });

  it('pre-selects Rasterize Pages to Images mode when launched with ?entry=rasterize-pdf', async () => {
    window.history.replaceState(
      {},
      '',
      '/flatten-pdf.html?entry=rasterize-pdf'
    );
    document.title = 'Flatten PDF | Shift PDF';
    loadFlattenPdfBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/flatten-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Rasterize PDF');
    expect(
      document.getElementById('mode-rasterize')?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      document.getElementById('rasterize-options')?.classList.contains('hidden')
    ).toBe(false);
    expect(
      document.getElementById('flatten-options')?.classList.contains('hidden')
    ).toBe(true);
  });
});
