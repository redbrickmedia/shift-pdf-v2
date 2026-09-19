import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSignedPdfFilename } from '../js/utils/sign-pdf-export';
import {
  applyPdfViewerDownloadFilename,
  DEFAULT_PDF_VIEWER_FILENAME,
  encodePdfjsViewerFileParam,
  getPdfFilenameFromViewerFileUrl,
  sanitizePdfViewerFilename,
  withPdfViewerFilename,
} from '../js/utils/pdfjs-viewer-filename';

function readSrc(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('pdfjs viewer filename bridge', () => {
  it('sanitizes paths, missing extensions, and URL breakers', () => {
    expect(sanitizePdfViewerFilename('folder/contract.PDF')).toBe(
      'contract.PDF'
    );
    expect(sanitizePdfViewerFilename('invoice')).toBe('invoice.pdf');
    expect(sanitizePdfViewerFilename('a#b?c.pdf')).toBe('a_b_c.pdf');
    expect(sanitizePdfViewerFilename('')).toBe(DEFAULT_PDF_VIEWER_FILENAME);
    expect(sanitizePdfViewerFilename(undefined)).toBe(
      DEFAULT_PDF_VIEWER_FILENAME
    );
  });

  it('appends a PDF.js-compatible hash to blob URLs', () => {
    const blobUrl = 'blob:http://localhost:5173/abc-123';
    const withName = withPdfViewerFilename(blobUrl, 'Contract Draft.pdf');

    expect(withName).toBe(`${blobUrl}#Contract Draft.pdf`);
    expect(getPdfFilenameFromViewerFileUrl(withName)).toBe(
      'Contract Draft.pdf'
    );
    expect(getPdfFilenameFromViewerFileUrl(blobUrl)).toBe(
      DEFAULT_PDF_VIEWER_FILENAME
    );
  });

  it('replaces an existing blob hash instead of stacking names', () => {
    const first = withPdfViewerFilename('blob:http://x/1', 'old.pdf');
    expect(withPdfViewerFilename(first, 'new.pdf')).toBe(
      'blob:http://x/1#new.pdf'
    );
  });

  it('encodes file query params the way embed iframes pass them', () => {
    const blobUrl = 'blob:http://localhost/uuid';
    const encoded = encodePdfjsViewerFileParam(blobUrl, 'sign-me.pdf');
    const decoded = decodeURIComponent(encoded);

    expect(encoded).toContain('%23');
    expect(decoded).toBe(`${blobUrl}#sign-me.pdf`);
    expect(getPdfFilenameFromViewerFileUrl(decoded)).toBe('sign-me.pdf');
  });

  it('builds representative viewer iframe URLs for each embed tool', () => {
    const blobUrl = 'blob:http://localhost/file-id';

    const signSrc = new URLSearchParams({
      file: withPdfViewerFilename(blobUrl, 'nda.pdf'),
      bentoSign: '1',
      shiftLaunchpad: '1',
    }).toString();
    expect(decodeURIComponent(signSrc)).toContain(`${blobUrl}#nda.pdf`);
    expect(signSrc).toContain('bentoSign=1');
    expect(signSrc).toContain('shiftLaunchpad=1');

    const formSrc = `pdfjs-viewer/viewer.html?file=${encodePdfjsViewerFileParam(blobUrl, 'tax-form.pdf')}`;
    expect(
      getPdfFilenameFromViewerFileUrl(
        decodeURIComponent(formSrc.split('file=')[1])
      )
    ).toBe('tax-form.pdf');

    const stampsSrc = `pdfjs-annotation-viewer/web/viewer.html?file=${encodePdfjsViewerFileParam(blobUrl, 'stamped.pdf')}#ae_username=Ada`;
    const stampsFile = decodeURIComponent(
      stampsSrc.split('file=')[1].split('#')[0]
    );
    expect(getPdfFilenameFromViewerFileUrl(stampsFile)).toBe('stamped.pdf');
    expect(stampsSrc.endsWith('#ae_username=Ada')).toBe(true);
  });

  it('pins contentDispositionFilename on a loaded viewer application', () => {
    const app = {
      _contentDispositionFilename: null as string | null,
      _title: 'document.pdf',
      setTitle(title: string) {
        this._title = title;
      },
    };

    expect(applyPdfViewerDownloadFilename(app, 'folder/report.pdf')).toBe(
      'report.pdf'
    );
    expect(app._contentDispositionFilename).toBe('report.pdf');
    expect(app._title).toBe('report.pdf');
  });

  it('keeps Sign process/completion naming derived from the source', () => {
    expect(getSignedPdfFilename('nda.pdf')).toBe('nda_signed.pdf');
    expect(getSignedPdfFilename('nda.pdf', true)).toBe(
      'nda_signed_flattened.pdf'
    );
  });

  it('does not invent undefined or empty download names', () => {
    expect(sanitizePdfViewerFilename(undefined)).not.toMatch(/undefined/i);
    expect(sanitizePdfViewerFilename('undefined')).toBe('undefined.pdf');
    expect(withPdfViewerFilename('blob:http://x/1', null)).toBe(
      `blob:http://x/1#${DEFAULT_PDF_VIEWER_FILENAME}`
    );
  });

  it('wires the filename bridge into Sign, Form Filler, and Stamps viewers', () => {
    const sign = readSrc('src/js/logic/sign-pdf-page.ts');
    expect(sign).toContain('withPdfViewerFilename(signState.blobUrl');
    expect(sign).toContain(
      'applyPdfViewerDownloadFilename(app, signState.file'
    );

    const form = readSrc('src/js/logic/form-filler-page.ts');
    expect(form).toContain(
      'encodePdfjsViewerFileParam(blobUrl, currentFile.name)'
    );
    expect(form).toContain(
      'applyPdfViewerDownloadFilename(app, currentFile?.name)'
    );

    const stamps = readSrc('src/js/logic/add-stamps.ts');
    expect(stamps).toContain(
      'encodePdfjsViewerFileParam(currentBlobUrl, file.name)'
    );
    expect(stamps).toContain(
      'applyPdfViewerDownloadFilename(app, sourceFilename)'
    );
  });
});
