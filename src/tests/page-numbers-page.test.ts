import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

const { loadPdfWithPasswordPromptMock } = vi.hoisted(() => ({
  loadPdfWithPasswordPromptMock: vi.fn(async (file: File) => ({
    file,
    bytes: await file.arrayBuffer(),
    pdf: {
      numPages: 2,
      destroy: vi.fn(),
    },
  })),
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt: loadPdfWithPasswordPromptMock,
  batchDecryptIfNeeded: vi.fn(async (files: File[]) => files),
}));

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

function loadPageNumbersBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/page-numbers.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

async function createMultiPagePdfBytes(
  pageCount = 2
): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([300, 400]);
  }
  return new Uint8Array(await doc.save());
}

describe('page-numbers.html consolidated Tool Surface (page-numbers, header-footer, bates-numbering)', () => {
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

  it('supports Page Numbers, Header & Footer, and Bates Numbering tabs across 1+ PDFs without dropping files, updates #stamp-preview and ?entry= on tab switch, and stages .pdf for 1 file or .zip for 2+ files', async () => {
    window.history.replaceState({}, '', '/page-numbers.html');
    document.title = 'Page Numbers | Shift PDF';
    loadPageNumbersBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/page-numbers-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const modePageNumbers = document.getElementById(
      'mode-page-numbers'
    ) as HTMLButtonElement;
    const modeHeaderFooter = document.getElementById(
      'mode-header-footer'
    ) as HTMLButtonElement;
    const modeBates = document.getElementById(
      'mode-bates'
    ) as HTMLButtonElement;

    expect(modePageNumbers).not.toBeNull();
    expect(modeHeaderFooter).not.toBeNull();
    expect(modeBates).not.toBeNull();
    expect(modePageNumbers.getAttribute('aria-pressed')).toBe('true');

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);

    // Upload 1 PDF (2 pages)
    const bytes1 = await createMultiPagePdfBytes(2);
    const file1 = new File([bytes1], 'exhibit-a.pdf', {
      type: 'application/pdf',
    });

    Object.defineProperty(fileInput, 'files', {
      value: [file1],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.getElementById('options-panel')?.classList.contains('hidden')
      ).toBe(false);
    });

    // Check shared controls and Page Numbers controls
    const startingNumber = document.getElementById(
      'starting-number'
    ) as HTMLInputElement;
    const numberFormat = document.getElementById(
      'number-format'
    ) as HTMLSelectElement;
    const stampPreview = document.getElementById('stamp-preview');
    expect(startingNumber).not.toBeNull();
    expect(numberFormat).not.toBeNull();
    expect(stampPreview).not.toBeNull();

    startingNumber.value = '5';
    startingNumber.dispatchEvent(new Event('input', { bubbles: true }));
    numberFormat.value = 'page_x_of_y';
    numberFormat.dispatchEvent(new Event('change', { bubbles: true }));
    expect(stampPreview?.textContent).toContain('5 / 6');

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toBe('exhibit-a.pdf');

    // Switch to Header & Footer tab -> syncs ?entry=header-footer and keeps file loaded
    clearLatestPdfOutput();
    modeHeaderFooter.click();

    expect(window.location.search).toBe('?entry=header-footer');
    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Header & Footer');
    expect(document.getElementById('file-display-area')?.textContent).toContain(
      'exhibit-a.pdf'
    );

    const headerCenter = document.getElementById(
      'header-center'
    ) as HTMLInputElement;
    const footerRight = document.getElementById(
      'footer-right'
    ) as HTMLInputElement;
    headerCenter.value = 'Confidential';
    headerCenter.dispatchEvent(new Event('input', { bubbles: true }));
    footerRight.value = 'Page {page} of {total}';
    footerRight.dispatchEvent(new Event('input', { bubbles: true }));

    expect(stampPreview?.textContent).toContain('Confidential');
    expect(stampPreview?.textContent).toContain('Page 1 of 2');
    expect(
      (document.getElementById(TOOL_OUTPUT_SAVE_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();
    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toBe('exhibit-a.pdf');

    // Add a second PDF (3 pages) and switch to Bates Numbering tab
    const bytes2 = await createMultiPagePdfBytes(3);
    const file2 = new File([bytes2], 'exhibit-b.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(fileInput, 'files', {
      value: [file2],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.getElementById('file-display-area')?.textContent
      ).toContain('exhibit-b.pdf');
    });

    clearLatestPdfOutput();
    modeBates.click();

    expect(window.location.search).toBe('?entry=bates-numbering');
    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Bates Numbering');

    const batesTemplate = document.getElementById(
      'bates-template'
    ) as HTMLInputElement;
    const batesStart = document.getElementById(
      'bates-start'
    ) as HTMLInputElement;
    expect(batesTemplate.value).toBe('[BATES]');
    batesStart.value = '100';
    batesStart.dispatchEvent(new Event('input', { bubbles: true }));
    expect(stampPreview?.textContent).toContain('000100');
    expect(stampPreview?.textContent).toContain('000104');

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toBe('bates_numbered.zip');

    const zip = await JSZip.loadAsync(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(Object.keys(zip.files).sort()).toEqual([
      'exhibit-a.pdf',
      'exhibit-b.pdf',
    ]);
  });

  it('pre-selects Header & Footer mode on ?entry=header-footer and Bates Numbering mode on ?entry=bates-numbering', async () => {
    window.history.replaceState(
      {},
      '',
      '/page-numbers.html?entry=header-footer'
    );
    document.title = 'Page Numbers | Shift PDF';
    loadPageNumbersBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/page-numbers-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Header & Footer');
    expect(
      document
        .getElementById('mode-header-footer')
        ?.getAttribute('aria-pressed')
    ).toBe('true');

    vi.resetModules();
    window.history.replaceState(
      {},
      '',
      '/page-numbers.html?entry=bates-numbering'
    );
    document.documentElement.removeAttribute('data-launch-context-applied');
    loadPageNumbersBodyFromHtml();
    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/page-numbers-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Bates Numbering');
    expect(
      document.getElementById('mode-bates')?.getAttribute('aria-pressed')
    ).toBe('true');
  });
});
