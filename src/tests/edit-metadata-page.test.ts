import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

const { loadPdfWithPasswordPromptMock } = vi.hoisted(() => ({
  loadPdfWithPasswordPromptMock: vi.fn(),
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt: loadPdfWithPasswordPromptMock,
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
  TOOL_OUTPUT_PRINT_ID,
  TOOL_OUTPUT_SAVE_ID,
  initToolOutputToolbar,
} from '../js/logic/tool-output-toolbar';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';

function loadEditMetadataBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/edit-metadata.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

describe('edit-metadata.html consolidated Tool Surface (edit-metadata + view-metadata)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLatestPdfOutput();
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-context-applied');

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.resetModules();
  });

  it('combines the read-only metadata/XMP inspector and editable form, keeps Save disabled on ?entry=view-metadata until a field or Clear All Metadata is used while Download & Print stay enabled, and stages updated PDF on commit', async () => {
    window.history.replaceState(
      {},
      '',
      '/edit-metadata.html?entry=view-metadata'
    );
    document.title = 'Edit Metadata | Shift PDF';
    loadEditMetadataBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/edit-metadata-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('View Metadata');
    expect(document.title).toBe('View Metadata | Shift PDF');

    const srcDoc = await PDFDocument.create();
    srcDoc.setTitle('Quarterly Report');
    srcDoc.setAuthor('Ada Lovelace');
    srcDoc.setSubject('Financials');
    srcDoc.addPage([200, 200]);
    const pdfBytes = await srcDoc.save();
    const pdfFile = new File([new Uint8Array(pdfBytes)], 'report.pdf', {
      type: 'application/pdf',
    });

    loadPdfWithPasswordPromptMock.mockResolvedValue({
      file: pdfFile,
      bytes: pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ),
      pdf: {
        numPages: 1,
        destroy: vi.fn(),
        getMetadata: vi.fn().mockResolvedValue({
          info: {
            Title: 'Quarterly Report',
            Author: 'Ada Lovelace',
            Subject: 'Financials',
          },
          metadata: {
            getRaw: () =>
              '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description><dc:title>Quarterly Report</dc:title></rdf:Description></rdf:RDF>',
          },
        }),
        getFieldObjects: vi.fn().mockResolvedValue({
          Department: [{ fieldValue: 'Engineering' }],
        }),
      },
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
        document.getElementById('tool-options')?.classList.contains('hidden')
      ).toBe(false);
    });

    // Both inspector and editable fields are populated
    const metadataDisplay = document.getElementById('metadata-display');
    expect(metadataDisplay?.textContent).toContain('Info Dictionary');
    expect(metadataDisplay?.textContent).toContain('Quarterly Report');
    expect(metadataDisplay?.textContent).toContain('Interactive Form Fields');
    expect(metadataDisplay?.textContent).toContain('Engineering');
    expect(metadataDisplay?.textContent).toContain('XMP Metadata');

    const titleInput = document.getElementById(
      'meta-title'
    ) as HTMLInputElement;
    const authorInput = document.getElementById(
      'meta-author'
    ) as HTMLInputElement;
    expect(titleInput.value).toBe('Quarterly Report');
    expect(authorInput.value).toBe('Ada Lovelace');

    // Copy Metadata as JSON works inline
    document.getElementById('copy-metadata')?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"Title": "Quarterly Report"')
    );

    // On ?entry=view-metadata before any edit: Save is visible but disabled; Download & Print are enabled
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

    // Editing a metadata field flips isDirty = true and enables Save
    titleInput.value = 'Updated Report Title';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(saveBtn.disabled).toBe(false);

    // Clicking Clear All Metadata clears inputs and keeps Save enabled
    const clearAllBtn = document.getElementById(
      'clear-all-metadata'
    ) as HTMLButtonElement;
    expect(clearAllBtn).not.toBeNull();
    clearAllBtn.click();
    expect(titleInput.value).toBe('');
    expect(authorInput.value).toBe('');
    expect(saveBtn.disabled).toBe(false);

    // Set a new title and custom field, then commit via Download
    titleInput.value = 'Final Approved Title';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    document.getElementById('add-custom-field')?.click();
    const customKey = document.querySelector(
      '.custom-meta-key'
    ) as HTMLInputElement;
    const customVal = document.querySelector(
      '.custom-meta-value'
    ) as HTMLInputElement;
    customKey.value = 'ReviewedBy';
    customVal.value = 'Security Team';

    downloadBtn.click();
    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });

    const outDoc = await PDFDocument.load(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(outDoc.getTitle()).toBe('Final Approved Title');
    expect(outDoc.getAuthor() ?? '').toBe('');
  });
});
