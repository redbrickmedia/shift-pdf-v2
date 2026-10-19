import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFAnnotation, PDFDocument, PDFName } from 'pdf-lib';

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
  TOOL_OUTPUT_RESET_ID,
  initToolOutputToolbar,
} from '../js/logic/tool-output-toolbar';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';

const SANITIZE_CHECKBOX_IDS = [
  'flatten-forms',
  'remove-metadata',
  'remove-annotations',
  'remove-javascript',
  'remove-embedded-files',
  'remove-layers',
  'remove-links',
  'remove-structure-tree',
  'remove-markinfo',
  'remove-fonts',
] as const;

function loadSanitizeBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/sanitize-pdf.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

describe('sanitize-pdf.html consolidated Tool Surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLatestPdfOutput();
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-context-applied');

    loadPdfWithPasswordPromptMock.mockImplementation(async (file: File) => ({
      file,
      bytes: await file.arrayBuffer(),
      pdf: { numPages: 1, destroy: vi.fn() },
    }));
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.resetModules();
  });

  it('adapts Launch Context for sanitize-pdf, ?entry=remove-annotations, and ?entry=remove-metadata while keeping all 10 checkboxes interactive and staging output via Output Session', async () => {
    window.history.replaceState(
      {},
      '',
      '/sanitize-pdf.html?entry=remove-annotations'
    );
    document.title = 'Sanitize PDF | Shift PDF';
    loadSanitizeBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/sanitize-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Remove Annotations');
    expect(document.title).toBe('Remove Annotations | Shift PDF');

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    expect(fileInput.multiple).toBe(false);

    // Only #remove-annotations is checked on ?entry=remove-annotations, all 10 are interactive
    for (const id of SANITIZE_CHECKBOX_IDS) {
      const box = document.getElementById(id) as HTMLInputElement;
      expect(box).not.toBeNull();
      expect(box.disabled).toBe(false);
      expect(box.checked).toBe(id === 'remove-annotations');
    }

    // Re-running on ?entry=remove-metadata pre-checks only #remove-metadata
    vi.resetModules();
    window.history.replaceState(
      {},
      '',
      '/sanitize-pdf.html?entry=remove-metadata'
    );
    document.documentElement.removeAttribute('data-launch-context-applied');
    loadSanitizeBodyFromHtml();
    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/sanitize-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Remove Metadata');
    for (const id of SANITIZE_CHECKBOX_IDS) {
      const box = document.getElementById(id) as HTMLInputElement;
      expect(box.disabled).toBe(false);
      expect(box.checked).toBe(id === 'remove-metadata');
    }

    // Upload a PDF with metadata and an annotation; verify only metadata is stripped when committed
    const doc = await PDFDocument.create();
    doc.setTitle('Secret Title');
    doc.setAuthor('Secret Author');
    const page = doc.addPage([200, 200]);
    const annotDict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [10, 10, 50, 50],
      Contents: 'Keep this note',
    });
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([doc.context.register(annotDict)])
    );
    const pdfBytes = await doc.save();
    const pdfFile = new File([new Uint8Array(pdfBytes)], 'annotated.pdf', {
      type: 'application/pdf',
    });

    const activeInput = document.getElementById(
      'file-input'
    ) as HTMLInputElement;
    Object.defineProperty(activeInput, 'files', {
      value: [pdfFile],
      configurable: true,
    });
    activeInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.getElementById('tool-options')?.classList.contains('hidden')
      ).toBe(false);
    });

    // Commit via header Download
    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toBe('annotated.pdf');

    const sanitizedDoc = await PDFDocument.load(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(sanitizedDoc.getTitle() ?? '').toBe('');
    expect(sanitizedDoc.getAuthor() ?? '').toBe('');
    // Annotation should still be present because only #remove-metadata was checked
    const annotsAfter =
      sanitizedDoc.getPages()[0]?.node.Annots()?.asArray() ?? [];
    expect(annotsAfter.length).toBe(1);
    expect(PDFAnnotation).toBeDefined();

    // Toggle #remove-annotations on and reset -> restores ?entry=remove-metadata defaults
    const removeAnnotationsBox = document.getElementById(
      'remove-annotations'
    ) as HTMLInputElement;
    removeAnnotationsBox.checked = true;
    document.getElementById(TOOL_OUTPUT_RESET_ID)?.click();

    await vi.waitFor(() => {
      expect(removeAnnotationsBox.checked).toBe(false);
      expect(
        (document.getElementById('remove-metadata') as HTMLInputElement).checked
      ).toBe(true);
    });
  });
});
