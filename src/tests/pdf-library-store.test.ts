import { afterEach, describe, expect, it } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';

afterEach(async () => {
  await clearPdfLibrary();
});

describe('PDF library store', () => {
  it('keeps uploaded and handed-off PDFs for later use', async () => {
    await addPdfToLibrary(
      new File(['upload'], 'upload.pdf', { type: 'application/pdf' }),
      'upload'
    );
    await addPdfToLibrary(
      new File(['handoff'], 'from-tab.pdf', { type: 'application/pdf' }),
      'handoff'
    );

    const entries = await readPdfLibrary();

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['from-tab.pdf', 'upload.pdf'])
    );
    expect(entries.find((entry) => entry.name === 'from-tab.pdf')?.source).toBe(
      'handoff'
    );
    expect(entries.find((entry) => entry.name === 'upload.pdf')?.source).toBe(
      'upload'
    );
    expect(entries[0]?.file).toBeInstanceOf(File);
  });

  it('returns independent File objects when the library is read', async () => {
    const original = new File(['pdf'], 'saved.pdf', {
      type: 'application/pdf',
    });
    await addPdfToLibrary(original, 'upload');

    const [saved] = await readPdfLibrary();

    expect(saved?.file).not.toBe(original);
    expect(saved?.file.name).toBe('saved.pdf');
    await expect(saved?.file.text()).resolves.toBe('pdf');
  });
});
