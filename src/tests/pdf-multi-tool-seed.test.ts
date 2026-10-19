import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import { seedToolOpenFile } from '../js/logic/seed-tool-open-file';
import {
  clearPersistedOpenFile,
  markOpenWithSelection,
  writePersistedOpenFiles,
} from '../js/logic/open-file-store';
import { state } from '../js/state';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';
import {
  clearLatestPdfOutput,
  getLatestPdfOutput,
  initShiftPdfSave,
} from '../js/logic/shift-pdf-save';
import {
  initToolOutputToolbar,
  TOOL_OUTPUT_REDO_ID,
  TOOL_OUTPUT_RESET_ID,
  TOOL_OUTPUT_SAVE_ID,
  TOOL_OUTPUT_UNDO_ID,
} from '../js/logic/tool-output-toolbar';

const { downloadFileMock, downloadBlobMock, convertImagesToPdfFileMock } =
  vi.hoisted(() => ({
    downloadFileMock: vi.fn(),
    downloadBlobMock: vi.fn(),
    convertImagesToPdfFileMock: vi.fn(
      async () =>
        new File(['converted-pdf'], 'images.pdf', { type: 'application/pdf' })
    ),
  }));

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

vi.mock('heic2any', () => ({
  default: vi.fn(),
}));

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn(() => ({ destroy: vi.fn() })),
  },
}));

vi.mock('../js/utils/shortcuts-init.js', () => ({
  initializeGlobalShortcuts: vi.fn(),
}));

vi.mock('../js/logic/repair-pdf.js', () => ({
  repairPdfFile: vi.fn(async () => null),
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt: vi.fn(async (file: File) => ({
    file,
    bytes: await file.arrayBuffer(),
    pdf: { numPages: 3, destroy: vi.fn() },
  })),
}));

vi.mock('../js/utils/load-pdf-document.js', () => ({
  loadPdfDocument: vi.fn(async () => {
    const doc = await PDFLibDocument.create();
    doc.addPage([200, 300]);
    doc.addPage([200, 300]);
    doc.addPage([200, 300]);
    return doc;
  }),
}));

vi.mock('../js/utils/render-utils', () => ({
  cleanupLazyRendering: vi.fn(),
  renderPageToCanvas: vi.fn(async () => document.createElement('canvas')),
  renderPagesProgressively: vi.fn(
    async (
      pdfjsDoc: { numPages: number },
      container: HTMLElement,
      createPageEl: (
        canvas: HTMLCanvasElement,
        pageNumber: number
      ) => HTMLElement
    ) => {
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 140;
        const el = createPageEl(canvas, i);
        container.appendChild(el);
      }
    }
  ),
}));

vi.mock('../js/utils/images-to-pdf-lib.js', () => ({
  convertImagesToPdfFile: convertImagesToPdfFileMock,
}));

vi.mock('../js/utils/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../js/utils/helpers')>();
  return {
    ...actual,
    downloadFile: (...args: Parameters<typeof actual.downloadFile>) => {
      downloadFileMock(...args);
      return actual.downloadFile(...args);
    },
    downloadBlob: (...args: Parameters<typeof actual.downloadBlob>) => {
      downloadBlobMock(...args);
    },
    getPDFDocument: vi.fn(() => ({
      promise: Promise.resolve({
        numPages: 3,
        destroy: vi.fn(),
      }),
    })),
  };
});

function loadMultiToolBodyMarkup(): string {
  const html = readFileSync(
    resolve(process.cwd(), 'src/pages/pdf-multi-tool.html'),
    'utf8'
  );
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (bodyMatch?.[1] ?? '')
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

afterEach(async () => {
  state.files = [];
  clearLatestPdfOutput();
  resetToolFilesSeededState();
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  await clearPersistedOpenFile();
  document.documentElement.removeAttribute('data-launch-entry');
  document.documentElement.removeAttribute('data-launch-surface');
  document.documentElement.removeAttribute('data-launch-context-applied');
  window.history.replaceState({}, '', '/pdf-multi-tool.html');
  vi.clearAllMocks();
});

describe('pdf multi tool seeding and consolidated page manipulation', () => {
  beforeEach(() => {
    state.files = [];
    clearLatestPdfOutput();
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    window.history.replaceState({}, '', '/pdf-multi-tool.html');
    document.title = 'PDF Multi Tool | Shift PDF';
    document.body.innerHTML = loadMultiToolBodyMarkup();
  });

  it('assigns selected workspace PDFs into #pdf-file-input on seed', async () => {
    const first = new File(['a'], 'alpha.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'beta.pdf', { type: 'application/pdf' });
    await addPdfToLibrary(first, 'upload');
    await addPdfToLibrary(second, 'upload');
    await writePersistedOpenFiles([
      { file: first, source: 'upload' },
      { file: second, source: 'upload' },
    ]);

    let changeFiles: string[] = [];
    document
      .getElementById('pdf-file-input')
      ?.addEventListener('change', (event) => {
        const input = event.target as HTMLInputElement;
        changeFiles = Array.from(input.files ?? []).map((file) => file.name);
      });

    markOpenWithSelection();
    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(changeFiles).toEqual(['alpha.pdf', 'beta.pdf']);
    expect(state.files.map((file) => file.name)).toEqual([
      'alpha.pdf',
      'beta.pdf',
    ]);
    const input = document.getElementById('pdf-file-input') as HTMLInputElement;
    expect(Array.from(input.files ?? []).map((file) => file.name)).toEqual([
      'alpha.pdf',
      'beta.pdf',
    ]);
  });

  it('does not invent a selection when the workspace is empty', async () => {
    await addPdfToLibrary(
      new File(['x'], 'library-only.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await expect(seedToolOpenFile()).resolves.toBe(false);
    expect(state.files).toHaveLength(0);
    const input = document.getElementById('pdf-file-input') as HTMLInputElement;
    expect(input.files?.length ?? 0).toBe(0);
  });

  it('mounts viewer-chrome header, highlights Launch Context actions without auto-mutating pages, and supports 1-click Rotate All, Reverse, and Output Session commits', async () => {
    const multiToolModule = await import('../js/logic/pdf-multi-tool');

    window.history.replaceState(
      {},
      '',
      '/pdf-multi-tool.html?entry=rotate-pdf'
    );
    document.body.innerHTML = loadMultiToolBodyMarkup();
    initShiftPdfSave();
    initToolOutputToolbar();
    multiToolModule.initializeTool();

    // Header adapted to Rotate PDF
    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Rotate PDF');
    const pdfInput = document.getElementById(
      'pdf-file-input'
    ) as HTMLInputElement;
    expect(pdfInput.accept).toBe('application/pdf');

    // Rotate buttons highlighted, sibling buttons still enabled
    const rotateLeftBtn = document.getElementById(
      'bulk-rotate-left-btn'
    ) as HTMLButtonElement;
    const rotateRightBtn = document.getElementById(
      'bulk-rotate-btn'
    ) as HTMLButtonElement;
    const reverseBtn = document.getElementById(
      'reverse-pages-btn'
    ) as HTMLButtonElement;
    expect(rotateLeftBtn.dataset.launchHighlight).toBe('true');
    expect(rotateRightBtn.dataset.launchHighlight).toBe('true');
    expect(rotateLeftBtn.classList.contains('is-launch-action')).toBe(true);
    expect(reverseBtn.disabled).toBe(false);

    // Consolidated entry ignores incoming image files while loading PDFs without auto-mutation
    const pdfFile = new File(['%PDF-1.4'], 'sample.pdf', {
      type: 'application/pdf',
    });
    const imageFile = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    await multiToolModule.handleIncomingFiles([pdfFile, imageFile]);

    expect(convertImagesToPdfFileMock).not.toHaveBeenCalled();
    const cards = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '#pages-container .shift-page-card'
        )
      );
    expect(cards()).toHaveLength(3);
    // Non-destructive initial load: 0deg rotation on all pages
    expect(
      cards().map((c) => c.querySelector('canvas')?.style.transform)
    ).toEqual(['rotate(0deg)', 'rotate(0deg)', 'rotate(0deg)']);

    // 1-click Rotate All when 0 pages are selected: rotates all pages +90deg without showing modal
    rotateRightBtn.click();
    expect(document.getElementById('modal')?.classList.contains('hidden')).toBe(
      true
    );
    expect(
      cards().map((c) => c.querySelector('canvas')?.style.transform)
    ).toEqual(['rotate(90deg)', 'rotate(90deg)', 'rotate(90deg)']);

    // Header Undo restores 0deg rotation
    const headerUndoBtn = document.getElementById(
      TOOL_OUTPUT_UNDO_ID
    ) as HTMLButtonElement;
    const headerRedoBtn = document.getElementById(
      TOOL_OUTPUT_REDO_ID
    ) as HTMLButtonElement;
    expect(headerUndoBtn.disabled).toBe(false);
    headerUndoBtn.click();
    expect(
      cards().map((c) => c.querySelector('canvas')?.style.transform)
    ).toEqual(['rotate(0deg)', 'rotate(0deg)', 'rotate(0deg)']);
    expect(headerRedoBtn.disabled).toBe(false);

    // Reverse with < 2 pages selected reverses all pages in the grid
    const initialPageNumbers = cards().map((c) => c.dataset.pageNumber);
    expect(initialPageNumbers).toEqual(['1', '2', '3']);
    reverseBtn.click();
    expect(cards().map((c) => c.dataset.pageNumber)).toEqual(['3', '2', '1']);

    // Undo restores ['1', '2', '3']
    headerUndoBtn.click();
    expect(cards().map((c) => c.dataset.pageNumber)).toEqual(['1', '2', '3']);

    // Select pages at index 0 and 2 (pages 1 and 3) and click Reverse: reverses only selected pages in place
    cards()[0]
      ?.querySelector<HTMLButtonElement>('[data-shift-page-select]')
      ?.click();
    cards()[2]
      ?.querySelector<HTMLButtonElement>('[data-shift-page-select]')
      ?.click();
    reverseBtn.click();
    expect(cards().map((c) => c.dataset.pageNumber)).toEqual(['3', '2', '1']);

    // Download Selected (#bulk-download-btn) triggers inline downloadBlob without modal
    const bulkDownloadBtn = document.getElementById(
      'bulk-download-btn'
    ) as HTMLButtonElement;
    bulkDownloadBtn.click();
    await vi.waitFor(() => {
      expect(downloadBlobMock).toHaveBeenCalledWith(
        expect.any(Blob),
        'selected-pages.pdf'
      );
    });
    expect(document.getElementById('modal')?.classList.contains('hidden')).toBe(
      true
    );

    // Header Save / Output Session stages all-pages.pdf via downloadFile without legacy modal
    const headerSaveBtn = document.getElementById(
      TOOL_OUTPUT_SAVE_ID
    ) as HTMLButtonElement;
    expect(headerSaveBtn.disabled).toBe(false);
    headerSaveBtn.click();
    await vi.waitFor(() => {
      expect(downloadFileMock).toHaveBeenCalledWith(
        expect.any(Blob),
        'all-pages.pdf'
      );
    });
    expect(getLatestPdfOutput()?.filename).toBe('all-pages.pdf');

    // Header Reset clears all pages and disables Save/Reset
    const headerResetBtn = document.getElementById(
      TOOL_OUTPUT_RESET_ID
    ) as HTMLButtonElement;
    headerResetBtn.click();
    await vi.waitFor(() => {
      expect(cards()).toHaveLength(0);
      expect(headerSaveBtn.disabled).toBe(true);
    });
  });

  it('highlights the matching toolbar action for each consolidated pdf-multi-tool entry', async () => {
    const multiToolModule = await import('../js/logic/pdf-multi-tool');

    const cases: Array<[string, string[]]> = [
      ['organize-pdf', ['bulk-duplicate-btn']],
      ['delete-pages', ['bulk-delete-btn']],
      ['rotate-pdf', ['bulk-rotate-left-btn', 'bulk-rotate-btn']],
      ['add-blank-page', ['add-blank-page-btn']],
      ['reverse-pages', ['reverse-pages-btn']],
    ];

    for (const [entryId, expectedButtonIds] of cases) {
      window.history.replaceState(
        {},
        '',
        `/pdf-multi-tool.html?entry=${entryId}`
      );
      document.body.innerHTML = loadMultiToolBodyMarkup();
      multiToolModule.initializeTool();

      const highlighted = Array.from(
        document.querySelectorAll<HTMLElement>('[data-launch-highlight="true"]')
      ).map((el) => el.id);
      expect(highlighted).toEqual(expectedButtonIds);
      for (const id of expectedButtonIds) {
        expect(
          document.getElementById(id)?.classList.contains('is-launch-action')
        ).toBe(true);
      }
    }
  });
});
