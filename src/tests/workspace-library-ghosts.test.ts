import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/utils/pdf-thumbnail.js', () => ({
  renderPdfFirstPage: vi.fn().mockResolvedValue(undefined),
}));

/**
 * In-flight store work is how a deleted PDF comes back: an adopt started
 * before the delete still writes, or a sync started before the delete still
 * paints. The tests below freeze those awaits so the delete can win the race
 * the way it does on a slow IndexedDB write, then assert the file stays gone.
 */
const addHold = { current: Promise.resolve() };
const readHold = {
  current: Promise.resolve(),
  pendingSnapshot: null as unknown[] | null,
};

vi.mock('../js/logic/pdf-library-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../js/logic/pdf-library-store.js')>();
  return {
    ...actual,
    addPdfToLibrary: vi.fn(
      async (file: File, source: 'upload' | 'handoff' | 'download') => {
        await addHold.current;
        return actual.addPdfToLibrary(file, source);
      }
    ),
    readPdfLibrary: vi.fn(async () => {
      // Capture once before the hold so the in-flight sync sees the pre-delete
      // library; later reads must hit the real store or the assertion that
      // IndexedDB is empty would keep reading this snapshot.
      if (readHold.pendingSnapshot) {
        const snapshot = readHold.pendingSnapshot;
        readHold.pendingSnapshot = null;
        await readHold.current;
        return snapshot;
      }
      await readHold.current;
      return actual.readPdfLibrary();
    }),
  };
});

import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import { initHomeFiles } from '../js/logic/home-files';
import { readPersistedOpenFiles } from '../js/logic/open-file-store';
import {
  getHomeLibraryFiles,
  getWorkspaceFiles,
  resetWorkspaceFileIndicator,
  setHomeLibraryFiles,
  setWorkspaceFiles,
  syncHomeLibraryFromStore,
} from '../js/logic/workspace-files';

function mountLibrary(): void {
  document.body.innerHTML = `
    <section id="shift-my-pdfs" data-view="thumbnail">
      <div id="shift-open-file-tools" hidden></div>
      <h2 id="shift-my-pdfs-heading">My PDFs</h2>
      <table class="shift-my-pdfs-table">
        <tbody id="shift-my-pdfs-body"></tbody>
      </table>
      <div id="shift-my-pdfs-thumbs" class="shift-open-file-thumbs"></div>
    </section>
  `;
}

function pdf(name: string, bytes: string): File {
  return new File([bytes], name, { type: 'application/pdf' });
}

async function confirmDelete(
  selector = '#shift-my-pdfs-body .shift-my-pdfs-delete'
): Promise<void> {
  document.querySelector<HTMLButtonElement>(selector)?.click();
  document.querySelector<HTMLButtonElement>('.shift-confirm-accept')?.click();
  await vi.waitFor(() => {
    expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
  });
}

async function confirmNamedDelete(fileName: string): Promise<void> {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '#shift-my-pdfs-body .shift-my-pdfs-delete'
    )
  ).find((entry) => entry.closest('tr')?.textContent?.includes(fileName));
  button?.click();
  document.querySelector<HTMLButtonElement>('.shift-confirm-accept')?.click();
  await vi.waitFor(() => {
    expect(
      Array.from(document.querySelectorAll('.shift-my-pdfs-row')).every(
        (row) => !row.textContent?.includes(fileName)
      )
    ).toBe(true);
  });
}

function libraryNames(): string[] {
  return getHomeLibraryFiles().map((file) => file.name);
}

afterEach(async () => {
  addHold.current = Promise.resolve();
  readHold.current = Promise.resolve();
  readHold.pendingSnapshot = null;
  resetWorkspaceFileIndicator();
  document.body.innerHTML = '';
  await clearPdfLibrary();
});

describe('workspace library ghosts', () => {
  it('does not resurrect a PDF whose library write finished after it was deleted', async () => {
    mountLibrary();
    const file = pdf('ghost.pdf', 'ghost-bytes');

    let releaseAdd: () => void = () => undefined;
    addHold.current = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });

    // Claim the blob for adopt while the store write is still blocked.
    setWorkspaceFiles([file]);
    // A row has to exist to delete; the pending adopt already captured the
    // blob, so this paint does not stop that write from completing later.
    setHomeLibraryFiles([
      {
        id: 'not-yet-stored',
        name: file.name,
        size: file.size,
        source: 'upload',
        blob: file,
      },
    ]);

    await confirmDelete();
    expect(getHomeLibraryFiles()).toHaveLength(0);

    releaseAdd();
    await vi.waitFor(async () => {
      await expect(readPdfLibrary()).resolves.toHaveLength(0);
    });
    expect(getHomeLibraryFiles()).toHaveLength(0);
    expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
  });

  it('ignores a store read that started before the delete resolved', async () => {
    mountLibrary();
    const saved = await addPdfToLibrary(
      pdf('stale.pdf', 'stale-bytes'),
      'upload'
    );
    setHomeLibraryFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
      },
    ]);

    const preDeleteLibrary = await readPdfLibrary();
    expect(preDeleteLibrary).toHaveLength(1);

    let releaseRead: () => void = () => undefined;
    readHold.current = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    readHold.pendingSnapshot = preDeleteLibrary;
    const sync = syncHomeLibraryFromStore();

    await confirmDelete();
    expect(getHomeLibraryFiles()).toHaveLength(0);

    releaseRead();
    await sync;

    expect(getHomeLibraryFiles()).toHaveLength(0);
    await expect(readPdfLibrary()).resolves.toHaveLength(0);
    expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
  });

  it('removes the stored copy even when the row never received a library id', async () => {
    mountLibrary();
    const saved = await addPdfToLibrary(
      pdf('noid.pdf', 'noid-bytes'),
      'upload'
    );
    // The grid can paint from a selection before adopt has copied the store
    // id onto the row. Delete still has to find the IndexedDB record.
    setHomeLibraryFiles([
      {
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
      },
    ]);

    await confirmDelete();

    await expect(readPdfLibrary()).resolves.toHaveLength(0);
    expect(getHomeLibraryFiles()).toHaveLength(0);
    expect(getWorkspaceFiles()).toHaveLength(0);
  });

  it('lets the same PDF be added again after it was deleted', async () => {
    mountLibrary();
    const first = pdf('again.pdf', 'again-bytes');
    setWorkspaceFiles([first]);
    await vi.waitFor(() => {
      expect(
        getHomeLibraryFiles().some((file) => file.name === 'again.pdf')
      ).toBe(true);
    });

    await confirmDelete();
    await expect(readPdfLibrary()).resolves.toHaveLength(0);

    const second = pdf('again.pdf', 'again-bytes');
    setWorkspaceFiles([second]);
    await vi.waitFor(() => {
      expect(
        getHomeLibraryFiles().some((file) => file.name === 'again.pdf')
      ).toBe(true);
    });
    await expect(readPdfLibrary()).resolves.toHaveLength(1);
  });

  it('does not abandon a sibling PDF when one in-flight adopt is deleted', async () => {
    mountLibrary();
    const keep = pdf('keep.pdf', 'keep-bytes');
    const drop = pdf('drop.pdf', 'drop-bytes');

    let releaseAdd: () => void = () => undefined;
    addHold.current = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });

    setWorkspaceFiles([keep, drop]);
    setHomeLibraryFiles([
      {
        id: 'pending-keep',
        name: keep.name,
        size: keep.size,
        source: 'upload',
        blob: keep,
      },
      {
        id: 'pending-drop',
        name: drop.name,
        size: drop.size,
        source: 'upload',
        blob: drop,
      },
    ]);

    await confirmNamedDelete('drop.pdf');
    expect(libraryNames()).toEqual(['keep.pdf']);

    releaseAdd();
    await vi.waitFor(async () => {
      const stored = await readPdfLibrary();
      expect(stored.map((entry) => entry.name)).toEqual(['keep.pdf']);
    });
    expect(libraryNames()).toEqual(['keep.pdf']);
    expect(document.querySelector('.shift-my-pdfs-row')?.textContent).toContain(
      'keep.pdf'
    );
    expect(document.body.textContent).not.toContain('drop.pdf');
  });

  it('clears every selected PDF through the toolbar delete control', async () => {
    mountLibrary();
    const first = await addPdfToLibrary(pdf('one.pdf', 'one-bytes'), 'upload');
    const second = await addPdfToLibrary(pdf('two.pdf', 'two-bytes'), 'upload');
    setHomeLibraryFiles([
      {
        id: first.id,
        name: first.name,
        size: first.size,
        source: first.source,
        blob: first.file,
      },
      {
        id: second.id,
        name: second.name,
        size: second.size,
        source: second.source,
        blob: second.file,
      },
    ]);
    setWorkspaceFiles([first.file, second.file]);

    expect(getWorkspaceFiles()).toHaveLength(2);
    const bulk = document.getElementById(
      'shift-my-pdfs-delete-selected'
    ) as HTMLButtonElement | null;
    expect(bulk).not.toBeNull();
    expect(bulk?.disabled).toBe(false);
    bulk?.click();
    expect(document.getElementById('shift-confirm-dialog')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.shift-confirm-accept')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
    });

    await expect(readPdfLibrary()).resolves.toHaveLength(0);
    expect(getHomeLibraryFiles()).toHaveLength(0);
    expect(getWorkspaceFiles()).toHaveLength(0);
  });

  it('does not resurrect selected files whose adopt finished after a bulk delete', async () => {
    mountLibrary();
    const first = pdf('bulk-a.pdf', 'a-bytes');
    const second = pdf('bulk-b.pdf', 'b-bytes');

    let releaseAdd: () => void = () => undefined;
    addHold.current = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });

    setWorkspaceFiles([first, second]);
    setHomeLibraryFiles([
      {
        id: 'pending-a',
        name: first.name,
        size: first.size,
        source: 'upload',
        blob: first,
      },
      {
        id: 'pending-b',
        name: second.name,
        size: second.size,
        source: 'upload',
        blob: second,
      },
    ]);

    document.getElementById('shift-my-pdfs-delete-selected')?.click();
    expect(document.getElementById('shift-confirm-dialog')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.shift-confirm-accept')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
    });

    releaseAdd();
    await vi.waitFor(async () => {
      await expect(readPdfLibrary()).resolves.toHaveLength(0);
    });
    expect(getHomeLibraryFiles()).toHaveLength(0);
  });

  it('removes the file from the thumbnail delete control as well as the list', async () => {
    mountLibrary();
    const saved = await addPdfToLibrary(
      pdf('thumb.pdf', 'thumb-bytes'),
      'upload'
    );
    setHomeLibraryFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
      },
    ]);

    await confirmDelete('#shift-my-pdfs-thumbs .shift-my-pdfs-delete');

    await expect(readPdfLibrary()).resolves.toHaveLength(0);
    expect(document.querySelector('.shift-open-file-thumb.is-selected')).toBe(
      null
    );
    expect(
      document.querySelector(
        '.shift-open-file-thumb:not(.shift-my-pdfs-empty-card)'
      )
    ).toBeNull();
  });

  it('leaves a same-name PDF alone when a different-sized sibling is deleted', async () => {
    mountLibrary();
    const keep = await addPdfToLibrary(
      pdf('invoice.pdf', 'keep-invoice'),
      'upload'
    );
    const drop = await addPdfToLibrary(
      pdf('invoice.pdf', 'drop-invoice-longer'),
      'upload'
    );
    setHomeLibraryFiles([
      {
        id: keep.id,
        name: keep.name,
        size: keep.size,
        source: keep.source,
        blob: keep.file,
      },
      {
        id: drop.id,
        name: drop.name,
        size: drop.size,
        source: drop.source,
        blob: drop.file,
      },
    ]);

    const dropButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '#shift-my-pdfs-body .shift-my-pdfs-delete'
      )
    ).find((button) =>
      button.closest('tr')?.textContent?.includes(String(drop.size))
    );
    dropButton?.click();
    document.querySelector<HTMLButtonElement>('.shift-confirm-accept')?.click();
    await vi.waitFor(async () => {
      const stored = await readPdfLibrary();
      expect(stored.map((entry) => entry.id)).toEqual([keep.id]);
    });
    expect(getHomeLibraryFiles().map((file) => file.id)).toEqual([keep.id]);
  });

  it('still saves a PDF when the delete dialog is cancelled during an in-flight adopt', async () => {
    mountLibrary();
    const file = pdf('kept-after-cancel.pdf', 'cancel-bytes');

    let releaseAdd: () => void = () => undefined;
    addHold.current = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });

    setWorkspaceFiles([file]);
    setHomeLibraryFiles([
      {
        id: 'pending-cancel',
        name: file.name,
        size: file.size,
        source: 'upload',
        blob: file,
      },
    ]);

    document
      .querySelector<HTMLButtonElement>(
        '#shift-my-pdfs-body .shift-my-pdfs-delete'
      )
      ?.click();
    document.querySelector<HTMLButtonElement>('.shift-confirm-cancel')?.click();
    await Promise.resolve();

    expect(document.querySelector('.shift-my-pdfs-row')).not.toBeNull();

    releaseAdd();
    await vi.waitFor(async () => {
      await expect(readPdfLibrary()).resolves.toHaveLength(1);
    });
    expect(libraryNames()).toContain('kept-after-cancel.pdf');
  });

  it('does not persist a deleted selection for the next page load', async () => {
    mountLibrary();
    const saved = await addPdfToLibrary(
      pdf('session.pdf', 'session-bytes'),
      'upload'
    );
    setWorkspaceFiles([saved.file]);
    setHomeLibraryFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
      },
    ]);
    await vi.waitFor(async () => {
      await expect(readPersistedOpenFiles()).resolves.toHaveLength(1);
    });

    await confirmDelete();

    await vi.waitFor(async () => {
      await expect(readPersistedOpenFiles()).resolves.toHaveLength(0);
    });
    await expect(readPdfLibrary()).resolves.toHaveLength(0);
  });

  it('does not restore a deleted PDF when My PDFs boots from an empty store', async () => {
    document.body.className = 'shift-home';
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf,.pdf" multiple />
      </div>
      <section id="shift-my-pdfs" data-view="thumbnail">
        <div id="shift-open-file-tools" hidden></div>
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;

    const saved = await addPdfToLibrary(
      pdf('boot.pdf', 'boot-bytes'),
      'upload'
    );
    setHomeLibraryFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
      },
    ]);
    await confirmDelete();
    await expect(readPdfLibrary()).resolves.toHaveLength(0);

    initHomeFiles();
    await vi.waitFor(() => {
      expect(getHomeLibraryFiles()).toHaveLength(0);
    });
    expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
  });

  it('does not adopt a non-PDF selection into the library', async () => {
    mountLibrary();
    setWorkspaceFiles([
      new File(['plain'], 'notes.txt', { type: 'text/plain' }),
    ]);
    await Promise.resolve();
    await Promise.resolve();

    await expect(readPdfLibrary()).resolves.toHaveLength(0);
    expect(getHomeLibraryFiles()).toHaveLength(0);
  });

  it('still bulk-deletes after the library chrome is remounted', async () => {
    mountLibrary();
    setHomeLibraryFiles([
      {
        id: 'first-mount',
        name: 'first.pdf',
        size: 4,
        source: 'upload',
        blob: pdf('first.pdf', 'one'),
      },
    ]);
    document.body.innerHTML = '';
    mountLibrary();
    const saved = await addPdfToLibrary(pdf('second.pdf', 'two'), 'upload');
    setHomeLibraryFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
      },
    ]);
    setWorkspaceFiles([saved.file]);

    const bulk = document.getElementById('shift-my-pdfs-delete-selected');
    expect(bulk).not.toBeNull();
    bulk?.click();
    expect(document.getElementById('shift-confirm-dialog')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.shift-confirm-accept')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
    });
    await expect(readPdfLibrary()).resolves.toHaveLength(0);
  });
});
