import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import { seedToolOpenFile } from '../js/logic/seed-tool-open-file';
import { state } from '../js/state';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';
import { clearPersistedOpenFile } from '../js/logic/open-file-store';
import * as openFileStore from '../js/logic/open-file-store';

const { getPDFDocument, batchDecryptIfNeeded, interleavePdfsMock } = vi.hoisted(
  () => ({
    getPDFDocument: vi.fn(),
    batchDecryptIfNeeded: vi.fn(async (files: File[]) => files),
    interleavePdfsMock: vi.fn(
      async () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])
    ),
  })
);

vi.mock('../js/utils/pdfjs.js', () => ({
  pdfjsLib: {},
  getPDFDocument,
}));

vi.mock('../js/utils/alternate-merge.js', () => ({
  interleavePdfs: interleavePdfsMock,
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  batchDecryptIfNeeded,
}));

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn(() => ({ destroy: vi.fn() })),
  },
}));

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

vi.mock('../js/analytics/index.js', () => ({
  pdfEngineAnalytics: null,
}));

vi.mock('../js/utils/wasm-provider.js', () => ({
  isCpdfAvailable: vi.fn(() => true),
  showWasmRequiredDialog: vi.fn(),
  WasmProvider: {
    getUrl: vi.fn(() => 'https://example.test/'),
    isConfigured: vi.fn(() => true),
  },
}));

vi.mock('../js/utils/render-utils.js', () => ({
  cleanupLazyRendering: vi.fn(),
  renderPageToCanvas: vi.fn(async () => ({
    toDataURL: () => 'data:image/jpeg;base64,',
  })),
}));

vi.mock('../js/embedder/shift-file-handoff.js', () => ({
  listenForShiftFileHandoff: vi.fn(),
  hasShiftFileHandoffRequest: vi.fn(() => false),
}));

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

vi.stubGlobal('Worker', MockWorker);

async function deleteIndexedDatabases(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  if (typeof indexedDB.databases !== 'function') return;
  const databases = await indexedDB.databases();
  await Promise.all(
    databases.map(
      (database) =>
        new Promise<void>((resolve, reject) => {
          if (!database.name) {
            resolve();
            return;
          }
          const request = indexedDB.deleteDatabase(database.name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        })
    )
  );
}

const MERGE_PAGE_DOM = `
  <div id="uploader">
    <div id="tool-uploader">
      <h1 data-i18n="tools:mergePdf.name">Merge PDF</h1>
      <p data-i18n="tools:mergePdf.subtitle">Combine whole files, or select specific pages to merge into a new document.</p>
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" multiple />
      </div>
      <div id="file-controls" class="hidden"></div>
      <div id="merge-options" class="hidden"></div>
      <button id="add-more-btn" type="button"></button>
      <button id="clear-files-btn" type="button"></button>
      <button id="process-btn" type="button" disabled></button>
      <button id="undo-merge-btn" type="button" disabled></button>
      <button id="redo-merge-btn" type="button" disabled></button>
      <button id="file-mode-btn" type="button"></button>
      <button id="page-mode-btn" type="button"></button>
      <button id="alternate-mode-btn" type="button"></button>
      <div id="file-mode-panel"></div>
      <div id="alternate-mode-panel" class="hidden"></div>
      <div id="page-mode-panel" class="hidden"></div>
      <ul id="file-list"></ul>
      <div id="page-merge-preview"></div>
      <input id="retain-page-labels" type="checkbox" />
      <section id="completion-panel" class="hidden">
        <p id="completion-summary"></p>
        <span id="completion-timing"></span>
        <a id="completion-download" href="#"></a>
        <button id="completion-start-over" type="button"></button>
      </section>
    </div>
  </div>
`;

function mockPdfDocument(numPages = 2) {
  return {
    numPages,
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(async () => {
  state.files = [];
  resetToolFilesSeededState();
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  await clearPersistedOpenFile();
  await deleteIndexedDatabases();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('merge pdf page', () => {
  beforeAll(async () => {
    await import('../js/logic/merge-pdf-page.ts');
  });

  beforeEach(async () => {
    window.history.replaceState({}, '', '/merge-pdf.html');
    document.title = 'Merge PDF | Shift PDF';
    document.body.innerHTML = MERGE_PAGE_DOM;
    document.dispatchEvent(new Event('DOMContentLoaded'));
    state.files = [];
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    await deleteIndexedDatabases();
    await clearPdfLibrary();
    await clearPersistedOpenFile();
    vi.spyOn(openFileStore, 'readPersistedOpenFiles').mockResolvedValue([]);
    getPDFDocument.mockReturnValue({
      promise: Promise.resolve(mockPdfDocument()),
    });
    batchDecryptIfNeeded.mockImplementation(async (files: File[]) => files);
    document.getElementById('clear-files-btn')?.click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#file-list li')).toHaveLength(0);
    });
  });

  it('seeds one active file and adds another from the library picker', async () => {
    const active = new File(['pdf'], 'saved.pdf', {
      type: 'application/pdf',
    });
    await addPdfToLibrary(active, 'upload');
    vi.spyOn(openFileStore, 'readPersistedOpenFiles').mockResolvedValue([
      {
        name: active.name,
        type: active.type,
        source: 'upload',
        file: active,
      },
    ]);

    openFileStore.markOpenWithSelection();
    await expect(seedToolOpenFile()).resolves.toBe(true);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#file-list li')).toHaveLength(1);
    });

    expect(state.files).toHaveLength(1);
    expect(state.files[0]?.name).toBe('saved.pdf');
    expect(
      document.getElementById('merge-options')?.classList.contains('hidden')
    ).toBe(false);
    expect(
      (document.getElementById('process-btn') as HTMLButtonElement).disabled
    ).toBe(true);

    await addPdfToLibrary(
      new File(['two'], 'second.pdf', { type: 'application/pdf' }),
      'upload'
    );

    document.getElementById('add-more-btn')?.click();
    await vi.waitFor(() => {
      expect(
        document.getElementById('shift-pdf-library-picker')
      ).not.toBeNull();
    });

    document
      .querySelector<HTMLButtonElement>(
        '.shift-library-picker-row:not(:disabled)'
      )
      ?.click();

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#file-list li')).toHaveLength(2);
    });

    const names = Array.from(
      document.querySelectorAll<HTMLSpanElement>('#file-list .truncate')
    ).map((node) => node.textContent);
    expect(names).toEqual(['saved.pdf', 'second.pdf']);
    expect(
      (document.getElementById('process-btn') as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('pre-selects Alternate & Mix on ?entry=alternate-merge, syncs ?entry via replaceState when switching tabs, supports per-file reverse toggles + undo/redo, and interleaves via interleavePdfs on commit', async () => {
    const { getLatestPdfOutput, clearLatestPdfOutput } =
      await import('../js/logic/shift-pdf-save');
    clearLatestPdfOutput();

    window.history.replaceState(
      {},
      '',
      '/merge-pdf.html?entry=alternate-merge'
    );
    document.title = 'Merge PDF | Shift PDF';
    document.getElementById('clear-files-btn')?.click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#file-list li')).toHaveLength(0);
    });

    const alternateBtn = document.getElementById(
      'alternate-mode-btn'
    ) as HTMLButtonElement;
    const fileBtn = document.getElementById(
      'file-mode-btn'
    ) as HTMLButtonElement;
    const pageBtn = document.getElementById(
      'page-mode-btn'
    ) as HTMLButtonElement;

    expect(alternateBtn.getAttribute('aria-pressed')).toBe('true');
    expect(fileBtn.getAttribute('aria-pressed')).toBe('false');
    expect(
      document
        .getElementById('alternate-mode-panel')
        ?.classList.contains('hidden')
    ).toBe(false);
    expect(
      document.getElementById('file-mode-panel')?.classList.contains('hidden')
    ).toBe(true);

    // Upload two files
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const f1 = new File(['one'], 'odd-pages.pdf', { type: 'application/pdf' });
    const f2 = new File(['two'], 'even-pages.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', {
      value: [f1, f2],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#file-list li')).toHaveLength(2);
    });

    // Switching to File Mode clears ?entry=alternate-merge -> bare /merge-pdf.html
    fileBtn.click();
    expect(window.location.search).toBe('');
    expect(fileBtn.getAttribute('aria-pressed')).toBe('true');
    expect(alternateBtn.getAttribute('aria-pressed')).toBe('false');

    // Switching to Page Mode keeps bare /merge-pdf.html
    pageBtn.click();
    expect(window.location.search).toBe('');
    expect(pageBtn.getAttribute('aria-pressed')).toBe('true');

    // Switching back to Alternate & Mix sets ?entry=alternate-merge
    alternateBtn.click();
    expect(window.location.search).toBe('?entry=alternate-merge');
    expect(alternateBtn.getAttribute('aria-pressed')).toBe('true');

    // Per-file reverse toggles are rendered in Alternate & Mix mode
    const reverseToggles = () =>
      Array.from(
        document.querySelectorAll<HTMLInputElement>(
          '#file-list input[data-reverse-toggle]'
        )
      );
    expect(reverseToggles()).toHaveLength(2);
    expect(reverseToggles()[1]?.checked).toBe(false);

    // Toggle reverse on second file and retainPageLabels
    reverseToggles()[1]!.checked = true;
    reverseToggles()[1]!.dispatchEvent(new Event('change'));

    const retainLabels = document.getElementById(
      'retain-page-labels'
    ) as HTMLInputElement;
    retainLabels.checked = true;
    retainLabels.dispatchEvent(new Event('change'));

    // Undo unchecks retainPageLabels, Redo restores it
    document.getElementById('undo-merge-btn')?.click();
    await vi.waitFor(() => {
      expect(retainLabels.checked).toBe(false);
    });
    document.getElementById('redo-merge-btn')?.click();
    await vi.waitFor(() => {
      expect(retainLabels.checked).toBe(true);
    });

    // Commit in alternate mode invokes interleavePdfs and stages alternated-mixed.pdf
    document.getElementById('process-btn')?.click();
    await vi.waitFor(() => {
      expect(interleavePdfsMock).toHaveBeenCalledTimes(1);
    });
    expect(interleavePdfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({ reverse: false }),
          expect.objectContaining({ reverse: true }),
        ],
        reverseFlags: [false, true],
        retainPageLabels: true,
      })
    );
    expect(getLatestPdfOutput()?.filename).toBe('alternated-mixed.pdf');

    window.history.replaceState({}, '', '/merge-pdf.html');
  });
});
