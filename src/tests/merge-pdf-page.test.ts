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

const { getPDFDocument, batchDecryptIfNeeded } = vi.hoisted(() => ({
  getPDFDocument: vi.fn(),
  batchDecryptIfNeeded: vi.fn(async (files: File[]) => files),
}));

vi.mock('../js/utils/pdfjs.js', () => ({
  pdfjsLib: {},
  getPDFDocument,
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
  WasmProvider: { getUrl: vi.fn(() => 'https://example.test/') },
}));

vi.mock('../js/utils/render-utils.js', () => ({
  cleanupLazyRendering: vi.fn(),
  renderPageToCanvas: vi.fn(),
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
  <div id="file-mode-panel"></div>
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
    document.body.innerHTML = MERGE_PAGE_DOM;
    await import('../js/logic/merge-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  beforeEach(async () => {
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
    await addPdfToLibrary(
      new File(['pdf'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await clearPersistedOpenFile();
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
});
