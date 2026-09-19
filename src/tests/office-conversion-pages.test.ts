import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Office conversion pages', () => {
  for (const page of ['excel-to-pdf-page.ts', 'powerpoint-to-pdf-page.ts']) {
    it(`${page} applies the shared conversion safeguards`, async () => {
      const source = await readFile(
        resolve(process.cwd(), 'src/js/logic', page),
        'utf8'
      );

      expect(source).toContain('assertLibreOfficeAssetsAvailable');
      expect(source).toContain('assertSharedArrayBufferAvailable');
      expect(source).toContain('createConversionSession');
      expect(source).toContain('runWithTimeout');
      expect(source).toContain('validateInputFile');
      expect(source).toContain('validateOutputBlob');
      expect(source).toContain('showCancellableLoader');
    });
  }
});
