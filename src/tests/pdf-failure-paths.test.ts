import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPDFDocument, pdfjsLib } from '../js/utils/pdfjs.js';

// Vitest serves the bundled worker as an http URL, which Node's ESM loader
// rejects. Point the real pdf.js worker at the package file instead.
const require = createRequire(import.meta.url);
const workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
).href;

// Tiny fixtures from the pdf.js corpus. pdf.js is Apache-2.0; these attachments are under 6 KB.
// https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/empty_protected.pdf
// https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/bug1020226.pdf
// https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/helloworld-bad.pdf
const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(fixtureDir, name)));
}

describe('PDF failure paths at the pdf.js boundary', () => {
  beforeEach(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  });

  it('opens encrypted empty_protected.pdf without a password prompt', async () => {
    const task = getPDFDocument({ data: readFixture('empty_protected.pdf') });
    let prompted = false;
    task.onPassword = () => {
      prompted = true;
    };

    const document = await task.promise;
    const metadata = await document.getMetadata();
    const info = metadata.info as { EncryptFilterName?: string };

    expect(prompted).toBe(false);
    expect(document.numPages).toBe(1);
    expect(info.EncryptFilterName).toBe('Standard');

    await document.destroy();
  });

  it('rejects corrupt bug1020226.pdf with InvalidPDFException', async () => {
    let task: ReturnType<typeof getPDFDocument> | undefined;
    expect(() => {
      task = getPDFDocument({ data: readFixture('bug1020226.pdf') });
    }).not.toThrow();

    await expect(task!.promise).rejects.toMatchObject({
      name: 'InvalidPDFException',
    });
    await task!.destroy();
  });

  it('loads malformed helloworld-bad.pdf without throwing', async () => {
    let task: ReturnType<typeof getPDFDocument> | undefined;
    expect(() => {
      task = getPDFDocument({ data: readFixture('helloworld-bad.pdf') });
    }).not.toThrow();

    const document = await task!.promise;
    expect(document.numPages).toBe(1);
    await document.destroy();
  });
});
