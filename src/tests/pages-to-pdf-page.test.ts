import { describe, expect, it } from 'vitest';
import { getCatalogEntryById } from '../js/config/tools';
import {
  getConvertDestinationById,
  getToPdfDestination,
} from '../js/config/convert-destinations';
import { acceptForToolId } from '../js/logic/tool-input-accept';

describe('pages to pdf catalog entry and convert hub destination', () => {
  it('routes Pages to PDF to pdf-converter.html?entry=pages-to-pdf with Apple Pages copy and .pages accept string', () => {
    const entry = getCatalogEntryById('pages-to-pdf');
    expect(entry).toMatchObject({
      id: 'pages-to-pdf',
      surface: 'pdf-converter',
      name: 'Pages to PDF',
      subtitle: 'Convert Apple Pages documents to PDF.',
      cardinality: 'batch',
    });
    expect(entry?.href).toContain('pdf-converter.html?entry=pages-to-pdf');
    expect(entry?.subtitle).not.toMatch(/WordPerfect/i);
    expect(acceptForToolId('pages-to-pdf')).toBe('.pages');
  });

  it('resolves .pages files to the Pages to PDF destination in the Convert hub', () => {
    const file = new File(['pages'], 'Quarterly.PAGES', {
      type: 'application/octet-stream',
    });
    const destination = getToPdfDestination(file);
    expect(destination).toMatchObject({
      id: 'pages-to-pdf',
      name: 'Pages to PDF',
      outputExtension: 'pdf',
      acceptsMultiple: true,
      producesPdf: true,
    });
    expect(getConvertDestinationById('pages-to-pdf')?.id).toBe('pages-to-pdf');
  });
});
