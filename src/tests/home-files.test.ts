import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/utils/pdf-thumbnail.js', () => ({
  renderPdfFirstPage: vi.fn().mockResolvedValue(undefined),
}));

import { SHIFT_TOOLTIP_SHOW_DELAY_MS } from '../js/logic/shift-tooltip';
import { renderPdfFirstPage } from '../js/utils/pdf-thumbnail';
import { initHomeFiles } from '../js/logic/home-files';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import { writePersistedOpenFile } from '../js/logic/open-file-store';
import {
  clearWorkspaceOpenFile,
  getWorkspaceFiles,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

function mountHome() {
  document.body.className = 'shift-home';
  document.body.innerHTML = `
    <section id="shift-open-files">
      <h2 id="shift-open-files-heading">My PDFs</h2>
      <nav class="shift-primary-nav" aria-label="Library"></nav>
      <div id="shift-open-files-list" hidden></div>
    </section>
    <div id="drop-zone">
      <input id="file-input" type="file" accept="application/pdf,.pdf" multiple />
    </div>
    <section id="shift-my-pdfs" hidden data-view="thumbnail">
      <h2 id="shift-my-pdfs-heading">Open file</h2>
      <button id="shift-open-file-view-list" data-view="list"></button>
      <button id="shift-open-file-view-thumbnail" data-view="thumbnail"></button>
      <table>
        <tbody id="shift-my-pdfs-body"></tbody>
      </table>
      <div id="shift-my-pdfs-thumbs"></div>
    </section>
  `;
}

function mountAllTools() {
  document.body.className = 'shift-home';
  document.body.innerHTML = `
    <section id="shift-open-files">
      <h2 id="shift-open-files-heading">My PDFs</h2>
      <nav class="shift-primary-nav" aria-label="Library"></nav>
      <div id="shift-open-files-list" hidden></div>
    </section>
    <div id="search-bar"></div>
    <div id="grid-view"><div id="tool-grid"></div></div>
  `;
}

function dispatchDrop(files: File[]) {
  const dropZone = document.getElementById('drop-zone');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files },
  });
  dropZone?.dispatchEvent(event);
}

afterEach(async () => {
  document.body.className = '';
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  vi.restoreAllMocks();
});

describe('home files', () => {
  it('is a no-op on tool pages without the Open file section', () => {
    document.body.className = '';
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" />
      </div>
    `;
    expect(() => initHomeFiles()).not.toThrow();
    expect(getWorkspaceFiles()).toEqual([]);
  });

  it('restores the active file into the all-tools sidebar without a library grid', async () => {
    await writePersistedOpenFile(
      new File(['x'], 'active.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );
    mountAllTools();
    initHomeFiles();

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toMatchObject([{ name: 'active.pdf' }]);
    });
    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(
      document.querySelector('.shift-open-file-item .shift-nav-label')
        ?.textContent
    ).toBe('active.pdf');
    expect(document.getElementById('shift-my-pdfs')).toBeNull();
  });

  it('lists a dropped PDF in the home Open file section', () => {
    mountHome();
    initHomeFiles();
    const pdf = new File([new Uint8Array([1, 2, 3])], 'briefing.pdf', {
      type: 'application/pdf',
    });

    dispatchDrop([pdf]);

    expect(getWorkspaceFiles()).toMatchObject([
      { name: 'briefing.pdf', source: 'upload' },
    ]);
    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(document.getElementById('shift-my-pdfs-heading')?.textContent).toBe(
      'My PDFs'
    );
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('briefing.pdf');
  });

  it('shows a dropped PDF in the all-tools sidebar file list', async () => {
    mountHome();
    initHomeFiles();
    vi.mocked(renderPdfFirstPage).mockClear();
    const pdf = new File(['%PDF'], 'briefing.pdf', {
      type: 'application/pdf',
    });

    dispatchDrop([pdf]);

    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(
      document.querySelector('.shift-open-file-item .shift-nav-label')
        ?.textContent
    ).toBe('briefing.pdf');

    await vi.waitFor(() => {
      expect(
        document.querySelector('.shift-open-file-preview:not(.is-empty)')
      ).not.toBeNull();
    });
  });

  it('keeps the My PDFs list chrome and shows an empty-state placeholder when nothing is uploaded', async () => {
    mountHome();
    initHomeFiles();

    await vi.waitFor(() => {
      expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    });
    expect(getWorkspaceFiles()).toEqual([]);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(
      document.querySelector('#shift-my-pdfs-body tr.shift-my-pdfs-empty-row')
    ).not.toBeNull();
    expect(
      document.querySelector('#shift-my-pdfs-body tr.shift-my-pdfs-row')
    ).toBeNull();
  });

  it('keeps every PDF from a multi-file drop and skips other types', () => {
    mountHome();
    setWorkspaceFiles([{ name: 'briefing.pdf' }]);
    initHomeFiles();
    const replacement = new File(['x'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    const notes = new File(['x'], 'notes.txt', { type: 'text/plain' });
    const extra = new File(['x'], 'second.pdf', { type: 'application/pdf' });

    dispatchDrop([notes, replacement, extra]);

    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'briefing.pdf',
      'second.pdf',
    ]);
    expect(document.getElementById('shift-my-pdfs-heading')?.textContent).toBe(
      'My PDFs'
    );
    expect(document.querySelectorAll('#shift-my-pdfs-body tr')).toHaveLength(2);
  });

  it('keeps earlier PDFs in the library when another is uploaded', async () => {
    mountHome();
    initHomeFiles();
    const first = new File(['a'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'second.pdf', { type: 'application/pdf' });

    dispatchDrop([first]);
    dispatchDrop([second]);

    expect(getWorkspaceFiles()).toMatchObject([{ name: 'second.pdf' }]);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#shift-my-pdfs-body tr')).toHaveLength(
        2
      );
    });
    expect(document.querySelectorAll('.shift-open-file-thumb')).toHaveLength(2);
  });

  it('accepts PDFs selected through the hidden file input', async () => {
    mountHome();
    initHomeFiles();
    const input = document.getElementById('file-input') as HTMLInputElement;
    const pdf = new File(['x'], 'picked.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [pdf],
    });

    input.dispatchEvent(new Event('change'));

    expect(getWorkspaceFiles()).toMatchObject([{ name: 'picked.pdf' }]);
    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    await vi.waitFor(() => {
      expect(
        Array.from(document.querySelectorAll('#shift-my-pdfs-body tr')).some(
          (row) => row.textContent?.includes('picked.pdf')
        )
      ).toBe(true);
    });
  });

  it('restores a handed-off file from the PDF library', async () => {
    await addPdfToLibrary(
      new File(['x'], 'from-tab.pdf', { type: 'application/pdf' }),
      'handoff'
    );
    mountHome();
    initHomeFiles();

    await vi.waitFor(() => {
      expect(
        document.querySelector('#shift-my-pdfs-body tr')?.textContent
      ).toContain('from-tab.pdf');
    });
    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('from-tab.pdf');
  });

  it('makes a saved library PDF active when its thumbnail is selected', async () => {
    await addPdfToLibrary(
      new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );
    mountHome();
    initHomeFiles();

    await vi.waitFor(() => {
      expect(document.querySelector('.shift-open-file-thumb')).not.toBeNull();
    });
    expect(
      document
        .querySelector('.shift-open-file-thumb')
        ?.getAttribute('aria-pressed')
    ).toBe('false');
    document
      .querySelector<HTMLButtonElement>('.shift-open-file-thumb')
      ?.click();

    expect(getWorkspaceFiles()).toMatchObject([
      { name: 'saved.pdf', source: 'upload' },
    ]);
    expect(
      document
        .querySelector('.shift-open-file-thumb')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    // The border is the only mark on the card: no chip overlay any more.
    expect(
      document.querySelector('.shift-open-file-thumb-selected')
    ).toBeNull();
    expect(document.querySelector('.shift-my-pdfs-selected-label')).toBeNull();
    expect(
      document
        .querySelector('.shift-open-file-thumb')
        ?.classList.contains('is-selected')
    ).toBe(true);

    const selectedChip = document.querySelector<HTMLElement>(
      '.shift-open-file-selected-label'
    );
    expect(selectedChip?.textContent).toBe('Selected');
    expect(selectedChip?.getAttribute('data-shift-tooltip')).toBe(
      'A selected file is a file that will be used when you click on tools.'
    );
    expect(selectedChip?.getAttribute('data-i18n-tooltip')).toBe(
      'home.activeFileTooltip'
    );

    vi.useFakeTimers();
    selectedChip?.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(SHIFT_TOOLTIP_SHOW_DELAY_MS);
    expect(document.getElementById('shift-tooltip')?.textContent).toBe(
      'A selected file is a file that will be used when you click on tools.'
    );
    vi.useRealTimers();

    await clearWorkspaceOpenFile();

    expect(getWorkspaceFiles()).toEqual([]);
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('saved.pdf');
  });

  it('does not re-render thumbnails when switching the active library file', async () => {
    const first = new File(['a'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'second.pdf', { type: 'application/pdf' });
    await addPdfToLibrary(first, 'upload');
    await addPdfToLibrary(second, 'upload');
    mountHome();
    initHomeFiles();

    await vi.waitFor(() => {
      expect(document.querySelectorAll('.shift-open-file-thumb')).toHaveLength(
        2
      );
    });
    vi.mocked(renderPdfFirstPage).mockClear();

    const canvasesBefore = Array.from(
      document.querySelectorAll<HTMLCanvasElement>(
        '.shift-open-file-thumb canvas'
      )
    );
    const gridRenderCalls = () =>
      vi
        .mocked(renderPdfFirstPage)
        .mock.calls.filter(([, canvas]) =>
          canvas.closest('.shift-open-file-thumb')
        ).length;
    const renderCallsBefore = gridRenderCalls();

    document
      .querySelector<HTMLButtonElement>(
        '.shift-open-file-thumb[data-file-name="first.pdf"]'
      )
      ?.click();

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toMatchObject([{ name: 'first.pdf' }]);
    });

    expect(gridRenderCalls()).toBe(renderCallsBefore);
    const canvasesAfter = Array.from(
      document.querySelectorAll<HTMLCanvasElement>(
        '.shift-open-file-thumb canvas'
      )
    );
    expect(canvasesAfter[0]).toBe(canvasesBefore[0]);
    expect(canvasesAfter[1]).toBe(canvasesBefore[1]);
  });
});
