import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

vi.mock('../js/ui.js', () => ({
  showAlert: vi.fn(),
  showLoader: vi.fn(),
  hideLoader: vi.fn(),
}));

vi.mock('../js/utils/libreoffice-loader.js', () => ({
  getLibreOfficeConverter: vi.fn(),
}));

const PAGE_DOM = `
  <div id="drop-zone">
    <input id="file-input" type="file" accept=".pages" multiple />
  </div>
  <div id="file-controls" class="hidden"></div>
  <div id="file-display-area"></div>
  <div id="convert-options" class="hidden">
    <button id="process-btn" type="button">Convert to PDF</button>
  </div>
  <button id="add-more-btn" type="button"></button>
  <button id="clear-files-btn" type="button"></button>
`;

type AlertFn = ReturnType<typeof vi.fn>;

function pagesFile(name = 'report.pages'): File {
  return new File(['pages'], name, { type: 'application/octet-stream' });
}

function pdfFile(name = 'sample.pdf'): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

function selectFiles(files: File[]): void {
  const input = document.getElementById('file-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: files,
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function dropFiles(files: File[]): void {
  const dropZone = document.getElementById('drop-zone');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  dropZone?.dispatchEvent(event);
}

function convertHidden(): boolean {
  return (
    document.getElementById('convert-options')?.classList.contains('hidden') ??
    true
  );
}

describe('pages to pdf page', () => {
  it('names Apple Pages in the title, heading, and subtitle', async () => {
    const html = await readFile(
      resolve(process.cwd(), 'src/pages/pages-to-pdf.html'),
      'utf8'
    );
    const title = html
      .match(/<title>([\s\S]*?)<\/title>/)?.[1]
      .replace(/\s+/g, ' ')
      .trim();
    const heading = html
      .match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const subtitle = html
      .match(/data-i18n="tools:pagesToPdf\.subtitle"[^>]*>([\s\S]*?)<\/p>/)?.[1]
      .replace(/\s+/g, ' ')
      .trim();

    expect(title).toBe('Pages to PDF - Convert Apple Pages to PDF | Shift PDF');
    expect(heading).toBe('Pages to PDF');
    expect(subtitle).toBe(
      'Convert Apple Pages documents to PDF format. Supports multiple files.'
    );
    expect(html).not.toMatch(/WordPerfect/i);
    expect(html).toContain('accept=".pages"');
  });

  describe('file selection', () => {
    let showAlert: AlertFn;

    beforeEach(async () => {
      vi.resetModules();
      document.body.innerHTML = PAGE_DOM;
      const ui = await import('../js/ui.js');
      showAlert = ui.showAlert as AlertFn;
      showAlert.mockClear();
      await import('../js/logic/pages-to-pdf-page.ts');
      document.dispatchEvent(new Event('DOMContentLoaded'));
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('alerts and leaves Convert hidden when every selected file is not .pages', () => {
      selectFiles([pdfFile(), new File(['x'], 'notes.docx')]);

      expect(showAlert).toHaveBeenCalledWith(
        'Invalid Files',
        'Please choose an Apple Pages file.'
      );
      expect(convertHidden()).toBe(true);
      expect(document.getElementById('file-display-area')?.textContent).toBe(
        ''
      );
    });

    it('alerts when a drop contains no .pages files', () => {
      dropFiles([pdfFile()]);

      expect(showAlert).toHaveBeenCalledWith(
        'Invalid Files',
        'Please choose an Apple Pages file.'
      );
      expect(convertHidden()).toBe(true);
    });

    it('enables Convert for an Apple Pages file without an alert', () => {
      selectFiles([pagesFile('Quarterly.PAGES')]);

      expect(showAlert).not.toHaveBeenCalled();
      expect(convertHidden()).toBe(false);
      expect(
        document.getElementById('file-display-area')?.textContent
      ).toContain('Quarterly.PAGES');
    });

    it('keeps only .pages files when a selection is mixed', () => {
      selectFiles([pdfFile(), pagesFile('notes.pages')]);

      expect(showAlert).not.toHaveBeenCalled();
      expect(convertHidden()).toBe(false);
      expect(
        document.getElementById('file-display-area')?.textContent
      ).toContain('notes.pages');
      expect(
        document.getElementById('file-display-area')?.textContent
      ).not.toContain('sample.pdf');
    });

    it('does not alert when the picker is cancelled', () => {
      selectFiles([]);

      expect(showAlert).not.toHaveBeenCalled();
      expect(convertHidden()).toBe(true);
    });
  });
});
