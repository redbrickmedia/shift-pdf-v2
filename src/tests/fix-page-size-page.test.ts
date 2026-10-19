import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PageSizes } from 'pdf-lib';

const { loadPdfWithPasswordPromptMock, downloadBlobSpy } = vi.hoisted(() => ({
  loadPdfWithPasswordPromptMock: vi.fn(async (file: File) => ({
    file,
    bytes: await file.arrayBuffer(),
    pdf: {
      numPages: 2,
      destroy: vi.fn(),
    },
  })),
  downloadBlobSpy: vi.fn(),
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt: loadPdfWithPasswordPromptMock,
}));

vi.mock('../js/utils/helpers.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../js/utils/helpers.js')>();
  return {
    ...actual,
    downloadBlob: vi.fn((blob: Blob, filename: string) => {
      downloadBlobSpy(blob, filename);
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
  TOOL_OUTPUT_PRINT_ID,
  TOOL_OUTPUT_SAVE_ID,
  initToolOutputToolbar,
} from '../js/logic/tool-output-toolbar';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';

function loadFixPageSizeBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/fix-page-size.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

async function createMixedSizesPdfBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  doc.addPage(PageSizes.A4); // 595.28 x 841.89 (Portrait)
  doc.addPage([792, 612]); // Letter Landscape
  return new Uint8Array(await doc.save());
}

describe('fix-page-size.html consolidated Tool Surface (fix-page-size, page-dimensions)', () => {
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

  it('renders both the Current Page Dimensions & Mixed-Size Inspector and Standardize Page Size controls, keeps Save disabled on ?entry=page-dimensions until a standardize control is modified, exports CSV via downloadBlob, and standardizes page sizes on commit', async () => {
    window.history.replaceState(
      {},
      '',
      '/fix-page-size.html?entry=page-dimensions'
    );
    document.title = 'Fix Page Size | Shift PDF';
    loadFixPageSizeBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/fix-page-size-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Page Dimensions');
    expect(document.title).toContain('Page Dimensions');

    const mixedPdfBytes = await createMixedSizesPdfBytes();
    const pdfFile = new File([mixedPdfBytes], 'mixed-pages.pdf', {
      type: 'application/pdf',
    });

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    expect(fileInput.multiple).toBe(false);
    Object.defineProperty(fileInput, 'files', {
      value: [pdfFile],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document
          .getElementById('dimensions-results')
          ?.classList.contains('hidden')
      ).toBe(false);
      expect(
        document.getElementById('tool-options')?.classList.contains('hidden')
      ).toBe(false);
    });

    // Verify Current Page Dimensions & Mixed-Size Inspector
    const summaryText =
      document.getElementById('dimensions-summary')?.textContent ?? '';
    expect(summaryText).toContain('Mixed Sizes');
    expect(summaryText).toContain('Mixed Page Sizes Detected');

    const tableRows = document.querySelectorAll('#dimensions-table-body tr');
    expect(tableRows).toHaveLength(2);
    expect(tableRows[0]?.textContent).toContain('pt');

    // Switch units to mm and verify table updates
    const unitsSelect = document.getElementById(
      'units-select'
    ) as HTMLSelectElement;
    unitsSelect.value = 'mm';
    unitsSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(
      document.querySelector('#dimensions-table-body tr')?.textContent
    ).toContain('mm');

    // Inline Export CSV button uses downloadBlob
    document.getElementById('export-csv-btn')?.click();
    expect(downloadBlobSpy).toHaveBeenCalledTimes(1);
    expect(downloadBlobSpy.mock.calls[0]?.[1]).toBe('page-dimensions.csv');

    // On ?entry=page-dimensions before any standardize control is touched:
    // Save is visible in the header but disabled, while Download and Print are enabled
    const saveBtn = document.getElementById(
      TOOL_OUTPUT_SAVE_ID
    ) as HTMLButtonElement;
    const downloadBtn = document.getElementById(
      TOOL_OUTPUT_DOWNLOAD_ID
    ) as HTMLButtonElement;
    const printBtn = document.getElementById(
      TOOL_OUTPUT_PRINT_ID
    ) as HTMLButtonElement;

    expect(saveBtn.hidden).toBe(false);
    expect(saveBtn.disabled).toBe(true);
    expect(downloadBtn.disabled).toBe(false);
    expect(printBtn.disabled).toBe(false);

    // Modify a Standardize Page Size control -> enables Save
    const targetSize = document.getElementById(
      'target-size'
    ) as HTMLSelectElement;
    const orientation = document.getElementById(
      'orientation'
    ) as HTMLSelectElement;
    targetSize.value = 'A4';
    targetSize.dispatchEvent(new Event('change', { bubbles: true }));
    orientation.value = 'portrait';
    orientation.dispatchEvent(new Event('change', { bubbles: true }));

    expect(saveBtn.disabled).toBe(false);

    // Commit output and verify both pages are now uniform A4 Portrait
    downloadBtn.click();
    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });

    const outDoc = await PDFDocument.load(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(outDoc.getPageCount()).toBe(2);
    for (const page of outDoc.getPages()) {
      const { width, height } = page.getSize();
      expect(Math.round(width)).toBe(Math.round(PageSizes.A4[0]));
      expect(Math.round(height)).toBe(Math.round(PageSizes.A4[1]));
    }
  });

  it('enables Save immediately once a PDF is loaded on canonical fix-page-size.html', async () => {
    window.history.replaceState({}, '', '/fix-page-size.html');
    document.title = 'Fix Page Size | Shift PDF';
    loadFixPageSizeBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/fix-page-size-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const mixedPdfBytes = await createMixedSizesPdfBytes();
    const pdfFile = new File([mixedPdfBytes], 'mixed-pages.pdf', {
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
        document.getElementById('tool-options')?.classList.contains('hidden')
      ).toBe(false);
    });

    const saveBtn = document.getElementById(
      TOOL_OUTPUT_SAVE_ID
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });
});
