import { describe, expect, it } from 'vitest';
import * as convertDestinations from '../js/config/convert-destinations';
import {
  filterConvertDestinations,
  getConvertDestinationById,
  getOutputFilename,
  getPdfDestinations,
  getSharedDestinations,
  getToPdfDestination,
} from '../js/config/convert-destinations';

function pdf(name: string): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

describe('shared convert destinations', () => {
  it('keeps the whole grid for a batch of PDFs', () => {
    const single = getSharedDestinations([pdf('one.pdf')]);
    const batch = getSharedDestinations([pdf('one.pdf'), pdf('two.pdf')]);

    expect(single.primary.length).toBeGreaterThan(0);
    expect(batch.primary.map((entry) => entry.id)).toEqual(
      single.primary.map((entry) => entry.id)
    );
    expect(batch.secondary.map((entry) => entry.id)).toEqual(
      single.secondary.map((entry) => entry.id)
    );
  });

  it('shares one to-PDF destination across files of the same type', () => {
    const shared = getSharedDestinations([
      new File(['a'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'two.jpg', { type: 'image/jpeg' }),
    ]);

    expect(shared.primary.map((entry) => entry.id)).toEqual(['jpg-to-pdf']);
    expect(shared.primary[0]?.producesPdf).toBe(true);
    expect(shared.primary[0]?.acceptsMultiple).toBe(true);
  });

  it('resolves image-to-pdf when a batch mixes different image formats', () => {
    const shared = getSharedDestinations([
      new File(['a'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'two.png', { type: 'image/png' }),
    ]);

    expect(shared.primary.map((entry) => entry.id)).toEqual(['image-to-pdf']);
    expect(shared.primary[0]?.producesPdf).toBe(true);
    expect(shared.primary[0]?.acceptsMultiple).toBe(true);
  });

  it('finds nothing in common for a mixed selection of PDF and non-PDF', () => {
    const shared = getSharedDestinations([
      pdf('one.pdf'),
      new File(['b'], 'two.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ]);

    expect(shared.primary).toEqual([]);
    expect(shared.secondary).toEqual([]);
  });

  it('has no destinations without a selection', () => {
    expect(getSharedDestinations([])).toEqual({ primary: [], secondary: [] });
  });
});

describe('destination batch capability and in-place routing', () => {
  it('retires SINGLE_FILE_DESTINATION_IDS so every destination accepts multiple files', () => {
    expect('SINGLE_FILE_DESTINATION_IDS' in convertDestinations).toBe(false);

    const { primary, secondary } = getPdfDestinations();
    const allPdfDestinations = [...primary, ...secondary];

    expect(allPdfDestinations).toHaveLength(13);
    for (const destination of allPdfDestinations) {
      expect(destination.acceptsMultiple).toBe(true);
      expect(destination.producesPdf).toBe(false);
      expect(destination.href).toMatch(
        new RegExp(`pdf-converter\\.html\\?entry=${destination.id}$`)
      );
    }
  });

  it('returns the exact 13 in-place Convert from PDF destinations and excludes standalone extract-images', () => {
    const { primary, secondary } = getPdfDestinations();
    const allIds = [...primary, ...secondary].map((entry) => entry.id);

    expect(allIds).not.toContain('extract-images');
    expect(allIds.sort()).toEqual(
      [
        'pdf-to-jpg',
        'pdf-to-png',
        'pdf-to-webp',
        'pdf-to-bmp',
        'pdf-to-tiff',
        'pdf-to-svg',
        'pdf-to-docx',
        'pdf-to-pptx',
        'pdf-to-excel',
        'pdf-to-csv',
        'pdf-to-text',
        'pdf-to-markdown',
        'extract-tables',
      ].sort()
    );
  });

  it('resolves all 26 Convert to PDF and 13 Convert from PDF destinations by id with producesPdf and in-place href', () => {
    const toPdfIds = [
      'image-to-pdf',
      'jpg-to-pdf',
      'png-to-pdf',
      'webp-to-pdf',
      'svg-to-pdf',
      'bmp-to-pdf',
      'heic-to-pdf',
      'tiff-to-pdf',
      'psd-to-pdf',
      'word-to-pdf',
      'excel-to-pdf',
      'powerpoint-to-pdf',
      'odt-to-pdf',
      'ods-to-pdf',
      'odp-to-pdf',
      'odg-to-pdf',
      'rtf-to-pdf',
      'pages-to-pdf',
      'pub-to-pdf',
      'vsd-to-pdf',
      'epub-to-pdf',
      'mobi-to-pdf',
      'xps-to-pdf',
      'csv-to-pdf',
      'xml-to-pdf',
      'email-to-pdf',
    ];

    for (const id of toPdfIds) {
      const dest = getConvertDestinationById(id);
      expect(dest, `Expected destination for ${id}`).not.toBeNull();
      expect(dest?.producesPdf).toBe(true);
      expect(dest?.acceptsMultiple).toBe(true);
      expect(dest?.outputExtension).toBe('pdf');
      expect(dest?.href).toMatch(
        new RegExp(`pdf-converter\\.html\\?entry=${id}$`)
      );
    }

    const txtDest = getToPdfDestination(
      new File(['hello'], 'notes.txt', { type: 'text/plain' })
    );
    expect(txtDest?.id).toBe('txt-to-pdf');
    expect(txtDest?.producesPdf).toBe(true);
    expect(txtDest?.acceptsMultiple).toBe(true);
    expect(txtDest?.href).toMatch(/pdf-converter\.html\?entry=txt-to-pdf$/);

    const mdDest = getToPdfDestination(
      new File(['# Title'], 'readme.md', { type: 'text/markdown' })
    );
    expect(mdDest?.id).toBe('markdown-to-pdf');
    expect(mdDest?.producesPdf).toBe(true);
    expect(mdDest?.acceptsMultiple).toBe(true);
    expect(mdDest?.href).toMatch(/pdf-converter\.html\?entry=markdown-to-pdf$/);
  });

  it('filters destinations by name, subtitle, or extension', () => {
    const { primary, secondary } = getPdfDestinations();
    const all = [...primary, ...secondary];

    expect(
      filterConvertDestinations(all, 'word').map((entry) => entry.id)
    ).toEqual(['pdf-to-docx']);
    expect(
      filterConvertDestinations(all, 'powerpoint').map((entry) => entry.id)
    ).toEqual(['pdf-to-pptx']);
    expect(
      filterConvertDestinations(all, 'jpg').some(
        (entry) => entry.id === 'pdf-to-jpg'
      )
    ).toBe(true);
    expect(filterConvertDestinations(all, '   ')).toHaveLength(all.length);
    expect(filterConvertDestinations(all, 'zzzz-nope')).toEqual([]);
  });

  it('previews the extension the tool actually downloads', () => {
    const { primary, secondary } = getPdfDestinations();
    const byId = new Map(
      [...primary, ...secondary].map((entry) => [entry.id, entry])
    );

    expect(getOutputFilename('basicapi.pdf', byId.get('pdf-to-excel')!)).toBe(
      'basicapi.xlsx'
    );
    expect(getOutputFilename('basicapi.pdf', byId.get('pdf-to-text')!)).toBe(
      'basicapi.txt'
    );
    expect(
      getOutputFilename('basicapi.pdf', byId.get('pdf-to-markdown')!)
    ).toBe('basicapi.md');
    expect(getOutputFilename('basicapi.pdf', byId.get('extract-tables')!)).toBe(
      'basicapi.csv'
    );
    expect(getOutputFilename('notes.pdf', byId.get('pdf-to-csv')!)).toBe(
      'notes.csv'
    );
    expect(getOutputFilename('basicapi.pdf', byId.get('pdf-to-docx')!)).toBe(
      'basicapi.docx'
    );
    expect(getOutputFilename('basicapi.pdf', byId.get('pdf-to-pptx')!)).toBe(
      'basicapi.pptx'
    );
  });

  it('carries the capability onto to-PDF destinations', () => {
    const destination = getToPdfDestination(
      new File(['a'], 'photo.jpg', { type: 'image/jpeg' })
    );
    expect(destination?.acceptsMultiple).toBe(true);
    expect(destination?.producesPdf).toBe(true);
  });
});
