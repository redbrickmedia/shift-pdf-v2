import { describe, expect, it } from 'vitest';
import {
  buildConvertSourceAccept,
  getConvertSourceKind,
  getFilenameWithoutExtension,
  getOutputFilename,
  getPdfDestinations,
  getToPdfDestination,
  isPdfFile,
  resolveDestinationHref,
} from '../js/config/convert-destinations';

describe('convert destinations', () => {
  it('detects PDF sources', () => {
    const file = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    expect(isPdfFile(file)).toBe(true);
    expect(getConvertSourceKind(file)).toBe('pdf');
  });

  it('detects office documents as convert-to-pdf sources', () => {
    const file = new File(['doc'], 'briefing.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(getConvertSourceKind(file)).toBe('to-pdf');
  });

  it('lists primary PDF destinations in a stable order', () => {
    const { primary } = getPdfDestinations();
    expect(primary.map((destination) => destination.id)).toEqual([
      'pdf-to-docx',
      'pdf-to-excel',
      'pdf-to-jpg',
      'pdf-to-png',
    ]);
  });

  it('builds output filenames for destination cards', () => {
    const destination = getPdfDestinations().primary[0];
    expect(getFilenameWithoutExtension('Quarterly Report.pdf')).toBe(
      'Quarterly Report'
    );
    expect(getOutputFilename('Quarterly Report.pdf', destination)).toBe(
      'Quarterly Report.docx'
    );
  });

  it('routes DOCX uploads to the Word to PDF tool', () => {
    const file = new File(['doc'], 'briefing.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const destination = getToPdfDestination(file, '/');
    expect(destination?.id).toBe('word-to-pdf');
    expect(resolveDestinationHref(file, destination!)).toContain(
      'word-to-pdf.html'
    );
  });

  it('includes PDF and common extensions in the source accept list', () => {
    expect(buildConvertSourceAccept()).toContain('application/pdf');
    expect(buildConvertSourceAccept()).toContain('.docx');
    expect(buildConvertSourceAccept()).toContain('.jpg');
  });
});
