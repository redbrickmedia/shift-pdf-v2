import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TOOL_FAVORITES_MIGRATED_KEY,
  TOOL_FAVORITES_STORAGE_KEY,
} from '../js/logic/tool-favorites';
import {
  clearWorkspaceOpenFile,
  resetWorkspaceFileIndicator,
} from '../js/logic/workspace-files';
import { clearPdfLibrary } from '../js/logic/pdf-library-store';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';

vi.mock('../js/ui.js', () => ({
  showAlert: vi.fn(),
  showLoader: vi.fn(),
  hideLoader: vi.fn(),
}));

vi.mock('../js/utils/disabled-tools.js', () => ({
  isToolDisabled: vi.fn(() => false),
}));

vi.mock('../js/embedder/shift-file-handoff.js', () => ({
  listenForShiftFileHandoff: vi.fn(),
  hasShiftFileHandoffRequest: () => false,
}));

function pdf(name = 'Report.pdf'): File {
  return new File(['%PDF'], name, { type: 'application/pdf' });
}

function mountPage(): void {
  document.body.innerHTML = `
    <div id="pdf-viewer-page">
      <div id="uploader">
        <div id="tool-uploader">
          <div id="drop-zone">
            <input id="file-input" type="file" accept="application/pdf" />
          </div>
        </div>
      </div>
      <section id="pdf-viewer-stage" hidden>
        <p id="pdf-viewer-filename"></p>
        <button id="pdf-viewer-change-file" type="button"></button>
        <div id="pdf-viewer-frame"></div>
        <div id="pdf-viewer-pins"></div>
        <button id="pdf-viewer-more-tools" type="button" hidden></button>
        <div id="pdf-viewer-more-menu" hidden></div>
      </section>
    </div>
  `;
}

describe('pdf viewer page', () => {
  afterEach(async () => {
    resetWorkspaceFileIndicator();
    resetToolFilesSeededState();
    await clearWorkspaceOpenFile();
    await clearPdfLibrary();
    document.body.innerHTML = '';
    document.body.className = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens a PDF in the themed viewer and pins favorite tools', async () => {
    mountPage();
    const { initPdfViewerPage, openPdfInViewer } =
      await import('../js/logic/pdf-viewer-page');
    const storage = {
      getItem: (key: string) => {
        if (key === TOOL_FAVORITES_STORAGE_KEY) {
          return JSON.stringify(['sign-pdf', 'pdf-converter']);
        }
        if (key === TOOL_FAVORITES_MIGRATED_KEY) return '1';
        return null;
      },
      setItem: vi.fn(),
    };

    initPdfViewerPage(document, { favoritesStorage: storage });
    await openPdfInViewer(pdf(), document);

    expect(document.body.classList.contains('is-viewing')).toBe(true);
    expect(document.getElementById('pdf-viewer-stage')?.hidden).toBe(false);
    expect(document.getElementById('pdf-viewer-filename')?.textContent).toBe(
      'Report.pdf'
    );
    const iframe = document.querySelector('iframe');
    expect(iframe?.src).toContain('pdfjs-viewer/viewer.html');
    expect(
      [...document.querySelectorAll('#pdf-viewer-pins [data-tool-id]')].map(
        (el) => (el as HTMLElement).dataset.toolId
      )
    ).toEqual(['sign-pdf', 'pdf-converter']);
    expect(
      document.querySelector(
        '#pdf-viewer-more-menu [data-tool-id="compress-pdf"]'
      )
    ).not.toBeNull();
  });

  it('opens the More tools menu and hands the PDF to the chosen tool', async () => {
    mountPage();
    const assignLocation = vi.fn();
    const { initPdfViewerPage, openPdfInViewer } =
      await import('../js/logic/pdf-viewer-page');
    const storage = {
      getItem: (key: string) => {
        if (key === TOOL_FAVORITES_STORAGE_KEY) {
          return JSON.stringify(['sign-pdf']);
        }
        if (key === TOOL_FAVORITES_MIGRATED_KEY) return '1';
        return null;
      },
      setItem: vi.fn(),
    };

    initPdfViewerPage(document, { assignLocation, favoritesStorage: storage });
    await openPdfInViewer(pdf('Contract.pdf'), document);

    const moreButton = document.getElementById(
      'pdf-viewer-more-tools'
    ) as HTMLButtonElement;
    moreButton.click();
    expect(document.getElementById('pdf-viewer-more-menu')?.hidden).toBe(false);

    const compress = document.querySelector(
      '#pdf-viewer-more-menu [data-tool-id="compress-pdf"]'
    ) as HTMLButtonElement;
    compress.click();

    await vi.waitFor(() => expect(assignLocation).toHaveBeenCalled());
    expect(assignLocation.mock.calls[0][0]).toContain('compress-pdf.html');
  });
});
