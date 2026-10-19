import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Office conversion runner', () => {
  it('routes Office and OpenDocument conversions through the shared LibreOffice runner in convert-runner.ts', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/js/logic/convert-runner.ts'),
      'utf8'
    );

    expect(source).toContain('LIBREOFFICE_TO_PDF_DESTINATION_IDS');
    expect(source).toContain("'word-to-pdf'");
    expect(source).toContain("'excel-to-pdf'");
    expect(source).toContain("'powerpoint-to-pdf'");
    expect(source).toContain('getLibreOfficeConverter');
    expect(source).toContain('convertToPdf');
  });
});
