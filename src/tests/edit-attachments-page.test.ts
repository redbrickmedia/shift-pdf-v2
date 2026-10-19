import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const {
  loadPdfWithPasswordPromptMock,
  batchDecryptIfNeededMock,
  downloadBlobSpy,
  workerInstances,
  isCpdfAvailableMock,
} = vi.hoisted(() => {
  const instances: Array<{
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    loadPdfWithPasswordPromptMock: vi.fn(),
    batchDecryptIfNeededMock: vi.fn(async (files: File[]) => files),
    downloadBlobSpy: vi.fn(),
    workerInstances: instances,
    isCpdfAvailableMock: vi.fn(() => true),
  };
});

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt: loadPdfWithPasswordPromptMock,
  batchDecryptIfNeeded: batchDecryptIfNeededMock,
}));

vi.mock('../js/utils/cpdf-helper.js', () => ({
  isCpdfAvailable: isCpdfAvailableMock,
}));

vi.mock('../js/utils/wasm-provider.js', () => ({
  showWasmRequiredDialog: vi.fn(),
  WasmProvider: {
    getUrl: vi.fn(() => 'https://example.test/cpdf/'),
    isConfigured: vi.fn(() => true),
  },
}));

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

vi.mock('../js/utils/helpers.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../js/utils/helpers.js')>();
  return {
    ...actual,
    downloadBlob: downloadBlobSpy,
  };
});

class MockAttachmentsWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workerInstances.push(this);
  }
}

vi.stubGlobal('Worker', MockAttachmentsWorker);

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

function loadEditAttachmentsBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/edit-attachments.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

describe('edit-attachments.html consolidated Tool Surface (edit, add, extract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLatestPdfOutput();
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    workerInstances.length = 0;
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-context-applied');

    loadPdfWithPasswordPromptMock.mockImplementation(async (file: File) => ({
      file,
      bytes: await file.arrayBuffer(),
      pdf: { numPages: 3, destroy: vi.fn() },
    }));
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.resetModules();
  });

  it('consolidates get-attachments, edit-attachments, add-attachments, and extract-attachments commands in edit-attachments.worker.js', () => {
    const workerSource = readFileSync(
      resolve(process.cwd(), 'public/workers/edit-attachments.worker.js'),
      'utf8'
    );
    expect(workerSource).toContain("command === 'get-attachments'");
    expect(workerSource).toContain("command === 'edit-attachments'");
    expect(workerSource).toContain("command === 'add-attachments'");
    expect(workerSource).toContain("command === 'extract-attachments'");
  });

  it('accepts 1+ PDFs across all 3 mode tabs without dropping files, syncs ?entry= and header features on tab switch, supports inline per-attachment download/remove and adding attachments, and stages extracted-attachments.zip in Extract mode', async () => {
    window.history.replaceState(
      {},
      '',
      '/edit-attachments.html?entry=add-attachments'
    );
    document.title = 'Edit Attachments | Shift PDF';
    loadEditAttachmentsBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/edit-attachments-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const activeWorker = workerInstances[workerInstances.length - 1]!;
    activeWorker.postMessage.mockImplementation((msg: { command: string }) => {
      if (msg.command === 'get-attachments') {
        const attBytes = new TextEncoder().encode('invoice-csv-bytes');
        activeWorker.onmessage?.({
          data: {
            status: 'success',
            fileName: 'doc1.pdf',
            attachments: [
              {
                index: 0,
                name: 'invoice.csv',
                page: 0,
                data: attBytes.buffer.slice(0),
              },
            ],
          },
        } as MessageEvent);
      } else if (
        msg.command === 'add-attachments' ||
        msg.command === 'edit-attachments'
      ) {
        const modPdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
        activeWorker.onmessage?.({
          data: {
            status: 'success',
            fileName: 'doc1.pdf',
            modifiedPDF: modPdf.buffer.slice(0),
          },
        } as MessageEvent);
      } else if (msg.command === 'extract-attachments') {
        const att1 = new TextEncoder().encode('attachment-one');
        const att2 = new TextEncoder().encode('attachment-two');
        activeWorker.onmessage?.({
          data: {
            status: 'success',
            attachments: [
              { name: 'doc1_invoice.csv', data: att1.buffer.slice(0) },
              { name: 'doc2_notes.txt', data: att2.buffer.slice(0) },
            ],
          },
        } as MessageEvent);
      }
    });

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Add Attachments');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);

    const modeEditBtn = document.getElementById(
      'mode-edit'
    ) as HTMLButtonElement;
    const modeAddBtn = document.getElementById('mode-add') as HTMLButtonElement;
    const modeExtractBtn = document.getElementById(
      'mode-extract'
    ) as HTMLButtonElement;
    expect(modeAddBtn.getAttribute('aria-pressed')).toBe('true');

    // Load 2 PDFs
    const pdf1 = new File(['%PDF-1.4 one'], 'doc1.pdf', {
      type: 'application/pdf',
    });
    const pdf2 = new File(['%PDF-1.4 two'], 'doc2.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(fileInput, 'files', {
      value: [pdf1, pdf2],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.getElementById('tool-options')?.classList.contains('hidden')
      ).toBe(false);
      expect(
        document.getElementById('attachments-list')?.textContent
      ).toContain('invoice.csv');
    });

    // Per-row inline download triggers downloadBlob for invoice.csv
    const rowDownloadBtn = document.querySelector<HTMLButtonElement>(
      '[data-attachment-download]'
    );
    expect(rowDownloadBtn).not.toBeNull();
    rowDownloadBtn?.click();
    expect(downloadBlobSpy).toHaveBeenCalledWith(
      expect.any(Blob),
      'invoice.csv'
    );

    // Switch to Extract Attachments tab -> syncs ?entry=extract-attachments, keeps 2 files loaded, and hides Save & Print in header
    modeExtractBtn.click();
    expect(window.location.search).toBe('?entry=extract-attachments');
    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Extract Attachments');
    expect(document.getElementById('file-display-area')?.textContent).toContain(
      'doc1.pdf'
    );
    expect(document.getElementById('file-display-area')?.textContent).toContain(
      'doc2.pdf'
    );

    const header = document.querySelector('.shift-pdf-viewer-header');
    expect(
      header
        ?.querySelector('[data-viewer-chrome="save"]')
        ?.hasAttribute('hidden')
    ).toBe(true);
    expect(
      header
        ?.querySelector('[data-viewer-chrome="print"]')
        ?.hasAttribute('hidden')
    ).toBe(true);

    // Clicking header Download in Extract mode runs extract-attachments and stages extracted-attachments.zip
    downloadBlobSpy.mockClear();
    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(getLatestPdfOutput()?.filename).toBe('extracted-attachments.zip');
    });
    const zip = await JSZip.loadAsync(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(Object.keys(zip.files).sort()).toEqual([
      'doc1_invoice.csv',
      'doc2_notes.txt',
    ]);

    // Switch to Edit & Manage Attachments tab -> restores Save & Print in header and syncs to bare /edit-attachments.html
    clearLatestPdfOutput();
    modeEditBtn.click();
    expect(window.location.search).toBe('');
    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Edit Attachments');
    expect(
      header
        ?.querySelector('[data-viewer-chrome="save"]')
        ?.hasAttribute('hidden')
    ).toBe(false);
    expect(
      header
        ?.querySelector('[data-viewer-chrome="print"]')
        ?.hasAttribute('hidden')
    ).toBe(false);
    expect(document.getElementById(TOOL_OUTPUT_SAVE_ID)).not.toBeNull();
    expect(document.getElementById(TOOL_OUTPUT_PRINT_ID)).not.toBeNull();

    // Add a new attachment file and commit -> stages multi-PDF zip when 2 PDFs are loaded
    const attInput = document.getElementById(
      'attachment-files-input'
    ) as HTMLInputElement;
    const attachmentToAdd = new File(['hello'], 'readme.txt', {
      type: 'text/plain',
    });
    Object.defineProperty(attInput, 'files', {
      value: [attachmentToAdd],
      configurable: true,
    });
    attInput.dispatchEvent(new Event('change'));

    expect(
      (document.getElementById(TOOL_OUTPUT_SAVE_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();
    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toMatch(/\.zip$/);
  });
});
