import { afterEach, describe, expect, it } from 'vitest';
import {
  addPdfToLibrary,
  classifyHandleFailure,
  clearPdfLibrary,
  readPdfLibrary,
  removePdfFromLibrary,
  updatePdfInLibrary,
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

  it('updates a stored PDF snapshot and name', async () => {
    const saved = await addPdfToLibrary(
      new File(['before'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );
    await updatePdfInLibrary(saved.id, {
      name: 'renamed.pdf',
      file: new File(['after'], 'renamed.pdf', { type: 'application/pdf' }),
    });

    const [updated] = await readPdfLibrary();
    expect(updated).toMatchObject({
      id: saved.id,
      name: 'renamed.pdf',
    });
    await expect(updated?.file.text()).resolves.toBe('after');
  });

  it('treats a revoked grant as recoverable and a missing file as not', () => {
    expect(
      classifyHandleFailure(new DOMException('nope', 'NotAllowedError'))
    ).toBe('needs-permission');
    expect(
      classifyHandleFailure(new DOMException('nope', 'SecurityError'))
    ).toBe('needs-permission');
    expect(
      classifyHandleFailure(new DOMException('gone', 'NotFoundError'))
    ).toBe('unavailable');
    expect(
      classifyHandleFailure(new DOMException('offline', 'NotReadableError'))
    ).toBe('unavailable');
  });

  it('re-persists the handle after a rename so the entry stays readable', async () => {
    const before = movableHandle('before.pdf');
    const saved = await addPdfToLibrary(
      new File(['doc'], 'before.pdf', { type: 'application/pdf' }),
      'upload',
      { handle: before }
    );

    await before.move('after.pdf');
    await updatePdfInLibrary(saved.id, { name: 'after.pdf', handle: before });

    const [entry] = await readPdfLibrary();
    expect(entry).toMatchObject({
      id: saved.id,
      name: 'after.pdf',
      availability: 'ready',
    });
  });
});

function movableHandle(
  name: string
): FileSystemFileHandle & { move: (next: string) => Promise<void> } {
  const handle = {
    kind: 'file',
    name,
    getFile: () =>
      Promise.resolve(
        new File(['doc'], handle.name, { type: 'application/pdf' })
      ),
    isSameEntry: (other: FileSystemFileHandle) =>
      Promise.resolve(other === (handle as unknown as FileSystemFileHandle)),
    move: (next: string) => {
      handle.name = next;
      return Promise.resolve();
    },
  };
  return handle as unknown as FileSystemFileHandle & {
    move: (next: string) => Promise<void>;
  };
}
