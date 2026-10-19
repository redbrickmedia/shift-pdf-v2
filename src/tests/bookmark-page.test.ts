import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';

const {
  loadPdfWithPasswordPromptMock,
  getPDFDocumentMock,
  workerInstances,
  isCpdfAvailableMock,
} = vi.hoisted(() => {
  const instances: Array<{
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    loadPdfWithPasswordPromptMock: vi.fn(),
    getPDFDocumentMock: vi.fn(),
    workerInstances: instances,
    isCpdfAvailableMock: vi.fn(() => true),
  };
});

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

vi.mock('sortablejs', () => ({
  default: class FakeSortable {
    destroy = vi.fn();
  },
}));

vi.mock('../js/utils/shortcuts-init.js', () => ({
  initializeGlobalShortcuts: vi.fn(),
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt: loadPdfWithPasswordPromptMock,
}));

vi.mock('../js/utils/pdfjs.js', () => ({
  pdfjsLib: {},
  getPDFDocument: getPDFDocumentMock,
}));

vi.mock('../js/utils/cpdf-helper.js', () => ({
  isCpdfAvailable: isCpdfAvailableMock,
}));

vi.mock('../js/utils/wasm-provider.js', () => ({
  showWasmRequiredDialog: vi.fn(),
  WasmProvider: {
    getUrl: vi.fn(() => 'https://example.test/cpdf/'),
    isConfigured: vi.fn(() => true),
  },
}));

class MockTocWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workerInstances.push(this);
  }
}

vi.stubGlobal('Worker', MockTocWorker);

import {
  clearLatestPdfOutput,
  getLatestPdfOutput,
  initShiftPdfSave,
} from '../js/logic/shift-pdf-save';
import {
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_REDO_ID,
  TOOL_OUTPUT_UNDO_ID,
  initToolOutputToolbar,
} from '../js/logic/tool-output-toolbar';

function loadBookmarkBodyFromHtml(): string {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/bookmark.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = bodyHtml;
  return rawHtml;
}

describe('unified bookmark.html (Bookmarks & Table of Contents) Tool Surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLatestPdfOutput();
    workerInstances.length = 0;
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-context-applied');

    const fakePdfJsDoc = {
      numPages: 2,
      destroy: vi.fn(),
      getOutline: vi.fn(async () => []),
      getPage: vi.fn(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 200 * scale,
          height: 300 * scale,
        }),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
      })),
    };

    getPDFDocumentMock.mockReturnValue({
      promise: Promise.resolve(fakePdfJsDoc),
    });

    loadPdfWithPasswordPromptMock.mockImplementation(async (file: File) => ({
      file,
      bytes: await file.arrayBuffer(),
      pdf: fakePdfJsDoc,
    }));
  });

  it('replaces custom #app > header.shift-chrome-bar and #download-btn with top viewer-chrome header and keeps Delete All + CSV/JSON import/export inline', () => {
    const rawHtml = loadBookmarkBodyFromHtml();

    expect(rawHtml).toContain('class="shift-pdf-viewer-header"');
    expect(rawHtml).toContain('data-shift-viewer-actions');
    expect(rawHtml).not.toContain('id="back-btn"');
    expect(rawHtml).not.toContain('id="download-btn"');
    expect(document.getElementById('delete-all-btn')).not.toBeNull();
    expect(document.getElementById('import-csv-btn')).not.toBeNull();
    expect(document.getElementById('export-csv-btn')).not.toBeNull();
    expect(document.getElementById('import-json-btn')).not.toBeNull();
    expect(document.getElementById('export-json-btn')).not.toBeNull();

    // 2-tab mode switcher + TOC controls
    expect(document.getElementById('tab-bookmarks')).not.toBeNull();
    expect(document.getElementById('tab-toc')).not.toBeNull();
    expect(document.getElementById('toc-title')).not.toBeNull();
    expect(document.getElementById('font-size')).not.toBeNull();
    expect(document.getElementById('font-family')).not.toBeNull();
    expect(document.getElementById('add-bookmark')).not.toBeNull();
  });

  it('pre-selects Table of Contents on ?entry=table-of-contents, syncs ?entry on tab switches, supports bookmark Undo/Redo, and commits Bookmarks or TOC via Output Session without resetting the viewer', async () => {
    window.history.replaceState(
      {},
      '',
      '/bookmark.html?entry=table-of-contents'
    );
    document.title = 'Edit Bookmarks | Shift PDF';
    loadBookmarkBodyFromHtml();

    const { initializeBookmarkPage } =
      await import('../js/logic/bookmark-pdf.ts');
    initShiftPdfSave();
    initializeBookmarkPage();
    initToolOutputToolbar();

    const tabBookmarks = document.getElementById(
      'tab-bookmarks'
    ) as HTMLButtonElement;
    const tabToc = document.getElementById('tab-toc') as HTMLButtonElement;
    const bookmarksPanel = document.getElementById('bookmarks-panel');
    const tocPanel = document.getElementById('toc-panel');

    expect(tabToc.getAttribute('aria-selected')).toBe('true');
    expect(tabBookmarks.getAttribute('aria-selected')).toBe('false');
    expect(tocPanel?.classList.contains('hidden')).toBe(false);
    expect(bookmarksPanel?.classList.contains('hidden')).toBe(true);

    // Upload a valid 2-page PDF
    const srcDoc = await PDFDocument.create();
    srcDoc.addPage([200, 300]);
    srcDoc.addPage([200, 300]);
    const pdfBytes = await srcDoc.save();
    const pdfFile = new File([new Uint8Array(pdfBytes)], 'manual.pdf', {
      type: 'application/pdf',
    });

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [pdfFile],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(document.getElementById('app')?.classList.contains('hidden')).toBe(
        false
      );
    });

    // Switch to Bookmarks tab -> syncs URL to bare /bookmark.html and preserves loaded PDF
    tabBookmarks.click();
    expect(window.location.search).toBe('');
    expect(tabBookmarks.getAttribute('aria-selected')).toBe('true');
    expect(bookmarksPanel?.classList.contains('hidden')).toBe(false);
    expect(tocPanel?.classList.contains('hidden')).toBe(true);

    // Add a top-level bookmark
    const titleInput = document.getElementById(
      'bookmark-title'
    ) as HTMLInputElement;
    titleInput.value = 'Chapter 1: Introduction';
    document.getElementById('add-top-level-btn')?.click();

    await vi.waitFor(() => {
      expect(
        document.querySelectorAll('#bookmark-tree-list > li')
      ).toHaveLength(1);
    });

    // Header Undo / Redo works on the bookmark tree
    expect(
      (document.getElementById(TOOL_OUTPUT_UNDO_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    document.getElementById(TOOL_OUTPUT_UNDO_ID)?.click();
    expect(document.querySelectorAll('#bookmark-tree-list > li')).toHaveLength(
      0
    );
    expect(
      (document.getElementById(TOOL_OUTPUT_REDO_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    document.getElementById(TOOL_OUTPUT_REDO_ID)?.click();
    expect(document.querySelectorAll('#bookmark-tree-list > li')).toHaveLength(
      1
    );

    // Commit on Bookmarks tab via header Download -> writes Outlines to PDF and stays on #app
    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();
    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toBe('manual.pdf');
    expect(document.getElementById('app')?.classList.contains('hidden')).toBe(
      false
    );

    const savedBookmarkPdf = await PDFDocument.load(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(savedBookmarkPdf.catalog.get(PDFName.of('Outlines'))).toBeDefined();

    clearLatestPdfOutput();

    // Switch back to Table of Contents tab -> syncs ?entry=table-of-contents
    tabToc.click();
    expect(window.location.search).toBe('?entry=table-of-contents');
    expect(tabToc.getAttribute('aria-selected')).toBe('true');

    const tocTitle = document.getElementById('toc-title') as HTMLInputElement;
    const fontSize = document.getElementById('font-size') as HTMLSelectElement;
    const fontFamily = document.getElementById(
      'font-family'
    ) as HTMLSelectElement;
    const addBookmark = document.getElementById(
      'add-bookmark'
    ) as HTMLInputElement;

    tocTitle.value = 'Contents';
    fontSize.value = '14';
    fontFamily.value = '0';
    addBookmark.checked = true;

    // Configure MockTocWorker to respond with a 3-page PDF when postMessage is called
    const tocDoc = await PDFDocument.create();
    tocDoc.addPage([200, 300]);
    tocDoc.addPage([200, 300]);
    tocDoc.addPage([200, 300]);
    const tocBytes = await tocDoc.save();

    const activeWorker = workerInstances[workerInstances.length - 1]!;
    activeWorker.postMessage.mockImplementation(() => {
      const copy = tocBytes.buffer.slice(
        tocBytes.byteOffset,
        tocBytes.byteOffset + tocBytes.byteLength
      );
      activeWorker.onmessage?.({
        data: { status: 'success', pdfBytes: copy },
      } as MessageEvent);
    });

    // Commit on Table of Contents tab via header Download
    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(activeWorker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'generate-toc',
          title: 'Contents',
          fontSize: 14,
          fontFamily: 0,
          addBookmark: true,
        }),
        expect.any(Array)
      );
      expect(getLatestPdfOutput()).not.toBeNull();
    });

    expect(getLatestPdfOutput()?.filename).toBe('manual.pdf');
    expect(document.getElementById('app')?.classList.contains('hidden')).toBe(
      false
    );
  });
});
