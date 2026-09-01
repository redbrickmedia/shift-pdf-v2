import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PDFDocument } from 'pdf-lib';
import {
  exportFlattenedSignedPdf,
  exportPdfJsAnnotations,
  getSignedPdfFilename,
} from '../js/utils/sign-pdf-export';
import {
  buildSignViewerUrl,
  configureSessionOnlySignatureUi,
  PDFJS_SIGNATURE_MODE,
} from '../js/utils/pdfjs-sign-viewer';
import type { PDFViewerApplication } from '../js/types/sign-pdf-type';

describe('Sign PDF exports', () => {
  it('preserves PDF.js annotations in the standard export', async () => {
    const annotationStorage = { size: 1 };
    const saveDocument = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(
      exportPdfJsAnnotations({ annotationStorage, saveDocument })
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(saveDocument).toHaveBeenCalledWith();
  });

  it('flattens the annotated PDF.js result before saving', async () => {
    const annotatedBytes = new Uint8Array([4, 5, 6]);
    const outputBytes = new Uint8Array([7, 8, 9]);
    const flattenForm = vi.fn();
    const save = vi.fn().mockResolvedValue(outputBytes);
    const document = {
      getForm: () => ({ flatten: flattenForm }),
      save,
    } as unknown as PDFDocument;
    const loadDocument = vi.fn().mockResolvedValue(document);
    const flatten = vi.fn();

    await expect(
      exportFlattenedSignedPdf(
        {
          annotationStorage: { size: 1 },
          saveDocument: vi.fn().mockResolvedValue(annotatedBytes),
        },
        { loadDocument, flatten }
      )
    ).resolves.toEqual(outputBytes);

    expect(loadDocument).toHaveBeenCalledWith(annotatedBytes);
    expect(flattenForm).toHaveBeenCalledOnce();
    expect(flatten).toHaveBeenCalledWith(document);
    expect(save).toHaveBeenCalledOnce();
  });

  it('derives clear signed filenames from the original name', () => {
    expect(getSignedPdfFilename('contract.PDF')).toBe('contract_signed.pdf');
    expect(getSignedPdfFilename('contract.pdf', true)).toBe(
      'contract_signed_flattened.pdf'
    );
    expect(getSignedPdfFilename(undefined)).toBe('document_signed.pdf');
  });
});

describe('PDF.js visual signature mode', () => {
  it('loads the PDF.js viewer directly with the sign flag', () => {
    const url = buildSignViewerUrl('blob:https://shift.test/abc', {
      baseUrl: '/',
      origin: 'https://preview.shift-pdf-neo.pages.dev',
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/pdfjs-viewer/viewer.html');
    expect(parsed.searchParams.get('bentoSign')).toBe('1');
    expect(parsed.searchParams.get('file')).toBe('blob:https://shift.test/abc');
    expect(url).not.toContain('sign-viewer.html');
  });

  it('activates Signature mode and disables persistent signature controls', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const viewerDocument = iframe.contentDocument!;
    viewerDocument.body.innerHTML = `
      <div id="editorHighlight"></div>
      <div id="editorSignature" hidden></div>
      <button id="editorSignatureButton" disabled></button>
      <div id="addSignatureSaveContainer"></div>
      <input id="addSignatureSaveCheckbox" type="checkbox" checked />
    `;
    const dispatch = vi.fn();
    const application = {
      eventBus: { dispatch, _on: vi.fn() },
    } as PDFViewerApplication;

    configureSessionOnlySignatureUi(iframe, application);

    expect(viewerDocument.getElementById('editorHighlight')?.hidden).toBe(true);
    expect(viewerDocument.getElementById('editorSignature')?.hidden).toBe(
      false
    );
    expect(
      (
        viewerDocument.getElementById(
          'addSignatureSaveCheckbox'
        ) as HTMLInputElement
      ).checked
    ).toBe(false);
    expect(
      (
        viewerDocument.getElementById(
          'addSignatureSaveCheckbox'
        ) as HTMLInputElement
      ).disabled
    ).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('switchannotationeditormode', {
      source: window,
      mode: PDFJS_SIGNATURE_MODE,
    });
  });

  it('keeps the vendored signature store session-only', async () => {
    const viewerBundle = await readFile(
      resolve(process.cwd(), 'public/pdfjs-viewer/viewer.mjs'),
      'utf8'
    );
    const storageStart = viewerBundle.indexOf('class SignatureStorage');
    const storageEnd = viewerBundle.indexOf('// ./web/genericcom.js');
    expect(storageStart).toBeGreaterThanOrEqual(0);
    expect(storageEnd).toBeGreaterThan(storageStart);
    const signatureStorage = viewerBundle.slice(storageStart, storageEnd);

    expect(signatureStorage).not.toContain('pdfjs.signature');
    expect(signatureStorage).not.toContain('localStorage');
  });
});
