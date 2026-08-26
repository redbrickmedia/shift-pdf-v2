import { describe, expect, it } from 'vitest';

import {
  fileFromShiftReadResult,
  getSourceTabIdFromLocation,
  sanitizeIncomingPdfFilename,
} from '../js/embedder/shift-file-access';

describe('shift-file-access', () => {
  it('reads the source tab id from the query string', () => {
    expect(getSourceTabIdFromLocation('?sourceTab=12')).toBe(12);
    expect(getSourceTabIdFromLocation('?action=merge')).toBeUndefined();
    expect(getSourceTabIdFromLocation('?sourceTab=nope')).toBeUndefined();
  });

  it('sanitizes incoming filenames', () => {
    expect(sanitizeIncomingPdfFilename('C:\\tmp\\q*uote.pdf')).toBe(
      'q-uote.pdf'
    );
    expect(sanitizeIncomingPdfFilename('')).toBe('document.pdf');
  });

  it('turns a Shift payload into a File', () => {
    const file = fileFromShiftReadResult({
      bytesBase64: btoa('hello-pdf'),
      filename: 'report.pdf',
      mimeType: 'application/pdf',
    });

    expect(file.name).toBe('report.pdf');
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBe('hello-pdf'.length);
  });

  it('rejects empty payloads', () => {
    expect(() =>
      fileFromShiftReadResult({
        bytesBase64: '',
        filename: 'empty.pdf',
        mimeType: 'application/pdf',
      })
    ).toThrow('This PDF is empty or could not be read.');
  });
});
