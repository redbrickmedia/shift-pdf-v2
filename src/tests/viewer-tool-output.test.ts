import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDerivedPdfFilename } from '../js/utils/derived-pdf-filename';
import { captureIframeFileSave } from '../js/utils/iframe-file-save';
import { getSignedPdfFilename } from '../js/utils/sign-pdf-export';

function readSrc(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('derived PDF filenames', () => {
  it('keeps a stable suffix for filled, stamped, and signed files', () => {
    expect(getDerivedPdfFilename('invoice.PDF', '_filled')).toBe(
      'invoice_filled.pdf'
    );
    expect(getDerivedPdfFilename('invoice.pdf', '_stamped')).toBe(
      'invoice_stamped.pdf'
    );
    expect(getDerivedPdfFilename(undefined, '_filled')).toBe(
      'document_filled.pdf'
    );
    expect(getSignedPdfFilename('nda.pdf')).toBe('nda_signed.pdf');
  });
});

describe('iframe file-save capture', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('captures a FileSaver-style iframe download instead of navigating', async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const win = iframe.contentWindow as (Window & typeof globalThis) | null;
    const doc = iframe.contentDocument;
    if (!win || !doc) {
      throw new Error('jsdom iframe is unavailable');
    }

    const blob = new Blob(['stamped'], { type: 'application/pdf' });
    const created: string[] = [];
    win.URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = `blob:test/${created.length}`;
      created.push(url);
      void obj;
      return url;
    };

    const result = await captureIframeFileSave(iframe, () => {
      const url = win.URL.createObjectURL(blob);
      const anchor = doc.createElement('a');
      anchor.href = url;
      anchor.download = 'invoice_stamped.pdf';
      anchor.dispatchEvent(new MouseEvent('click'));
    });

    expect(result.filename).toBe('invoice_stamped.pdf');
    expect(result.blob).toBe(blob);
  });
});

describe('viewer tool output sessions', () => {
  it('publishes edit, fill-sign, stamp, and crop output only after a real change', () => {
    const edit = readSrc('src/js/logic/edit-pdf-page.ts');
    expect(edit).toContain('exportPdfJsAnnotations');
    expect(edit).toContain('downloadFile');
    expect(edit).toContain('fillSignFormDirty');
    expect(edit).toContain('shouldAutoActivateStampTool');
    expect(edit).toContain('registerToolOutputSession');
    expect(edit).toContain('canSave: () => editorHasEdits()');
    expect(edit).toContain(
      "getRegistryPlugin<HistoryPlugin>(registry, 'history')"
    );
    expect(edit).not.toContain('canSave: () => isViewerInitialized');
  });

  it('resets Edit PDF viewer state and clears workspace file', () => {
    const edit = readSrc('src/js/logic/edit-pdf-page.ts');
    expect(edit).toContain('reset: resetViewer');
    expect(edit).toContain('canReset: hasLoadedDocument');
    expect(edit).toMatch(
      /registerToolOutputSession\(\{[\s\S]*reset: resetViewer/
    );
    expect(edit).toContain('void clearWorkspaceOpenFile()');
  });

  it('publishes Compare PDFs through the shared Save session', () => {
    const compare = readSrc('src/js/logic/compare-pdfs-page.ts');
    expect(compare).toContain('registerToolOutputSession');
    expect(compare).toContain('canSave: () => pageState.pagePairs.length > 0');
    expect(compare).toContain(
      'apply: () => runCompareExport(getCompareExportMode())'
    );
  });
});
