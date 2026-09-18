import { afterEach, describe, expect, it } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
  removePdfFromLibrary,
  replacePdfInLibrary,
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

  it('preserves downloaded outputs as downloaded copies', async () => {
    await addPdfToLibrary(
      new File(['output'], 'compressed.pdf', { type: 'application/pdf' }),
      'download'
    );

    const [entry] = await readPdfLibrary();

    expect(entry).toMatchObject({
      name: 'compressed.pdf',
      source: 'download',
    });
  });

  it('reuses the stored record when the same PDF is added again', async () => {
    const first = await addPdfToLibrary(
      new File(['same'], 'repeat.pdf', { type: 'application/pdf' }),
      'upload'
    );
    const second = await addPdfToLibrary(
      new File(['same'], 'repeat.pdf', { type: 'application/pdf' }),
      'handoff'
    );

    expect(second.id).toBe(first.id);
    await expect(readPdfLibrary()).resolves.toHaveLength(1);
  });

  it('keeps PDFs that share a name but differ in content', async () => {
    await addPdfToLibrary(
      new File(['first'], 'invoice.pdf', { type: 'application/pdf' }),
      'upload'
    );
    await addPdfToLibrary(
      new File(['second'], 'invoice.pdf', { type: 'application/pdf' }),
      'upload'
    );

    const entries = await readPdfLibrary();

    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });

  it('removes a stored PDF from memory and IndexedDB', async () => {
    const saved = await addPdfToLibrary(
      new File(['keep-me'], 'keep.pdf', { type: 'application/pdf' }),
      'upload'
    );
    await addPdfToLibrary(
      new File(['drop-me'], 'drop.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await removePdfFromLibrary(saved.id);

    const entries = await readPdfLibrary();
    expect(entries.map((entry) => entry.name)).toEqual(['drop.pdf']);
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

  it('replaces bytes in place while preserving the stable library id', async () => {
    const original = await addPdfToLibrary(
      new File(['original-bytes'], 'contract.pdf', {
        type: 'application/pdf',
      }),
      'upload'
    );

    const replaced = await replacePdfInLibrary(
      original.id,
      new File(['edited-bytes'], 'contract-signed.pdf', {
        type: 'application/pdf',
      })
    );

    expect(replaced).toMatchObject({
      id: original.id,
      name: 'contract.pdf',
      size: 'edited-bytes'.length,
    });
    await expect(replaced?.file.text()).resolves.toBe('edited-bytes');

    const entries = await readPdfLibrary();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(original.id);
    await expect(entries[0]?.file.text()).resolves.toBe('edited-bytes');
  });

  it('returns null when replacing a missing library id', async () => {
    await expect(
      replacePdfInLibrary(
        'missing-id',
        new File(['x'], 'x.pdf', { type: 'application/pdf' })
      )
    ).resolves.toBeNull();
  });
});
