import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import { seedToolOpenFile } from '../js/logic/seed-tool-open-file';
import { writePersistedOpenFile } from '../js/logic/open-file-store';
import { state } from '../js/state';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';

const { loadPdfWithPasswordPrompt } = vi.hoisted(() => ({
  loadPdfWithPasswordPrompt: vi.fn(),
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt,
}));

vi.mock('../js/utils/load-pdf-document.js', () => ({
  loadPdfDocument: vi.fn(async () => ({
    getPageCount: () => 2,
  })),
}));

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

vi.mock('../js/ui.js', () => ({
  showAlert: vi.fn(),
  showLoader: vi.fn(),
  hideLoader: vi.fn(),
}));

const EXTRACT_PAGE_DOM = `
  <div id="drop-zone">
    <input id="file-input" type="file" accept="application/pdf" />
  </div>
  <div id="file-display-area"></div>
  <div id="extract-options" class="hidden"></div>
  <button id="process-btn" type="button"></button>
`;

afterEach(async () => {
  state.files = [];
  resetToolFilesSeededState();
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  vi.resetModules();
});

describe('extract pages page', () => {
  beforeEach(() => {
    state.files = [];
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    document.body.innerHTML = EXTRACT_PAGE_DOM;
    loadPdfWithPasswordPrompt.mockResolvedValue({
      file: new File(['pdf'], 'saved.pdf', { type: 'application/pdf' }),
      bytes: new Uint8Array([1, 2, 3]).buffer,
      pdf: { destroy: vi.fn() },
    });
  });

  it('loads a selected PDF when the shared seed runs', async () => {
    const file = new File(['pdf'], 'saved.pdf', { type: 'application/pdf' });
    await addPdfToLibrary(file, 'upload');
    await writePersistedOpenFile(file, { source: 'upload' });

    await import('../js/logic/extract-pages-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await expect(seedToolOpenFile()).resolves.toBe(true);

    await vi.waitFor(() => {
      expect(
        document.getElementById('extract-options')?.classList.contains('hidden')
      ).toBe(false);
    });

    expect(state.files[0]?.name).toBe('saved.pdf');
    expect(document.getElementById('file-display-area')?.textContent).toContain(
      'saved.pdf'
    );
  });
});
