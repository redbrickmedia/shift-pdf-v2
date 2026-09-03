import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/utils/pdf-thumbnail.js', () => ({
  renderPdfFirstPage: vi.fn().mockResolvedValue(undefined),
}));

import { initHomeFiles } from '../js/logic/home-files';
import {
  filterLibraryFilesByName,
  getMyPdfsSearchQuery,
  initMyPdfsSearch,
  MY_PDFS_SEARCH_EMPTY_MESSAGE,
  MY_PDFS_SEARCH_INPUT_ID,
  MY_PDFS_SEARCH_PLACEHOLDER,
  resetMyPdfsSearch,
  setMyPdfsSearchQuery,
} from '../js/logic/my-pdfs-search';
import {
  getWorkspaceFiles,
  resetWorkspaceFileIndicator,
  setHomeLibraryFiles,
  setHomeOpenFileView,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

function mountMyPdfs(view: 'list' | 'thumbnail' = 'thumbnail') {
  document.body.className = 'shift-home';
  document.body.innerHTML = `
    <div id="drop-zone">
      <input id="file-input" type="file" accept="application/pdf,.pdf" multiple />
    </div>
    <section id="shift-my-pdfs" data-view="thumbnail">
      <div class="shift-open-file-header">
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <div class="shift-open-file-header-controls">
          <div id="shift-open-file-tools" class="shift-open-file-tools" hidden></div>
          <div class="shift-open-file-view-by" role="group" aria-label="View by">
            <span>View by</span>
            <div class="shift-open-file-view-toggle">
              <button type="button" id="shift-open-file-view-list" data-view="list"></button>
              <button type="button" id="shift-open-file-view-thumbnail" data-view="thumbnail"></button>
            </div>
          </div>
        </div>
      </div>
      <table class="shift-my-pdfs-table">
        <tbody id="shift-my-pdfs-body"></tbody>
      </table>
      <div id="shift-my-pdfs-thumbs" class="shift-open-file-thumbs"></div>
    </section>
  `;
  if (view === 'list') {
    document.getElementById('shift-my-pdfs')?.setAttribute('data-view', 'list');
  }
}

afterEach(() => {
  document.body.className = '';
  document.body.innerHTML = '';
  resetWorkspaceFileIndicator();
  resetMyPdfsSearch();
  vi.restoreAllMocks();
});

describe('filterLibraryFilesByName', () => {
  const files = [
    { name: 'Invoice-Q1.pdf' },
    { name: 'report.pdf' },
    { name: 'Notes.PDF' },
  ];

  it('returns all files when the query is empty or whitespace', () => {
    expect(filterLibraryFilesByName(files, '')).toEqual(files);
    expect(filterLibraryFilesByName(files, '   ')).toEqual(files);
  });

  it('filters by case-insensitive filename substring', () => {
    expect(
      filterLibraryFilesByName(files, 'invoice').map((f) => f.name)
    ).toEqual(['Invoice-Q1.pdf']);
    expect(filterLibraryFilesByName(files, 'PDF').map((f) => f.name)).toEqual([
      'Invoice-Q1.pdf',
      'report.pdf',
      'Notes.PDF',
    ]);
    expect(filterLibraryFilesByName(files, 'note').map((f) => f.name)).toEqual([
      'Notes.PDF',
    ]);
  });
});

describe('My PDFs library search', () => {
  it('injects a full-width filter below the drop zone', () => {
    mountMyPdfs();
    // Chrome moves the drop zone under the title before search mounts.
    setHomeLibraryFiles([]);
    initMyPdfsSearch(document, () => undefined);

    const input = document.getElementById(
      MY_PDFS_SEARCH_INPUT_ID
    ) as HTMLInputElement | null;
    const label = document.querySelector(
      `label[for="${MY_PDFS_SEARCH_INPUT_ID}"]`
    );
    const wrap = document.querySelector('.shift-my-pdfs-search');
    const dropZone = document.getElementById('drop-zone');

    expect(input?.type).toBe('search');
    expect(input?.placeholder).toBe(MY_PDFS_SEARCH_PLACEHOLDER);
    expect(label?.textContent).toBe('Filter by filename');
    expect(wrap).not.toBeNull();
    expect(dropZone?.nextElementSibling).toBe(wrap);
    expect(
      document.querySelector(
        '.shift-open-file-header-controls .shift-my-pdfs-search'
      )
    ).toBeNull();
  });

  it('filters the library in both thumbnail and list views', () => {
    mountMyPdfs('thumbnail');
    setMyPdfsSearchQuery('bet');
    setHomeLibraryFiles([
      { id: 'a', name: 'alpha.pdf', size: 10, source: 'upload' },
      { id: 'b', name: 'beta.pdf', size: 20, source: 'upload' },
      { id: 'c', name: 'gamma.pdf', size: 30, source: 'upload' },
    ]);

    expect(
      Array.from(
        document.querySelectorAll('#shift-my-pdfs-body tr.shift-my-pdfs-row')
      ).map((row) => (row as HTMLElement).dataset.fileName)
    ).toEqual(['beta.pdf']);
    expect(
      Array.from(
        document.querySelectorAll(
          '#shift-my-pdfs-thumbs .shift-open-file-thumb'
        )
      ).map((card) => (card as HTMLElement).dataset.fileName)
    ).toEqual(['beta.pdf']);

    setHomeOpenFileView('list');
    expect(
      document.querySelectorAll('#shift-my-pdfs-body tr.shift-my-pdfs-row')
    ).toHaveLength(1);
    expect(
      (
        document.querySelector(
          '#shift-my-pdfs-body tr.shift-my-pdfs-row'
        ) as HTMLElement
      ).dataset.fileName
    ).toBe('beta.pdf');
  });

  it('shows a search empty state instead of the upload CTA when the library has files', () => {
    mountMyPdfs();
    setHomeLibraryFiles([
      { id: 'a', name: 'only.pdf', size: 10, source: 'upload' },
    ]);
    setMyPdfsSearchQuery('zzz');
    setHomeLibraryFiles([
      { id: 'a', name: 'only.pdf', size: 10, source: 'upload' },
    ]);

    expect(
      document.querySelector('.shift-my-pdfs-search-empty')?.textContent
    ).toBe(MY_PDFS_SEARCH_EMPTY_MESSAGE);
    expect(
      document.querySelector('.shift-my-pdfs-search-empty-row')
    ).not.toBeNull();
    expect(document.querySelector('.shift-my-pdfs-empty-row')).toBeNull();
    expect(document.body.textContent).not.toContain('Add a PDF to get started');
    expect(document.querySelector('.shift-open-file-view-by')).not.toBeNull();
  });

  it('keeps the upload empty state when the library itself is empty', () => {
    mountMyPdfs();
    setMyPdfsSearchQuery('anything');
    setHomeLibraryFiles([]);

    expect(document.querySelector('.shift-my-pdfs-empty-row')).not.toBeNull();
    expect(document.body.textContent).toContain('Add a PDF to get started');
    expect(document.querySelector('.shift-my-pdfs-search-empty')).toBeNull();
  });

  it('keeps a filtered-out selection in memory', () => {
    mountMyPdfs();
    const selected = new File(['a'], 'keep.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([
      { id: 'a', name: 'keep.pdf', size: 4, source: 'upload', blob: selected },
      { id: 'b', name: 'other.pdf', size: 5, source: 'upload' },
    ]);
    setWorkspaceFiles([selected]);
    expect(getWorkspaceFiles().map((f) => f.name)).toEqual(['keep.pdf']);

    setMyPdfsSearchQuery('other');
    setHomeLibraryFiles([
      { id: 'a', name: 'keep.pdf', size: 4, source: 'upload', blob: selected },
      { id: 'b', name: 'other.pdf', size: 5, source: 'upload' },
    ]);

    expect(
      document.querySelectorAll('#shift-my-pdfs-body tr.shift-my-pdfs-row')
    ).toHaveLength(1);
    expect(
      (document.querySelector('.shift-my-pdfs-row') as HTMLElement).dataset
        .fileName
    ).toBe('other.pdf');
    expect(getWorkspaceFiles().map((f) => f.name)).toEqual(['keep.pdf']);
    expect(
      document
        .getElementById('shift-open-file-tools')
        ?.classList.contains('is-disabled')
    ).toBe(false);
  });

  it('clears the query on Escape and via the clear control', () => {
    mountMyPdfs();
    initHomeFiles();
    const input = document.getElementById(
      MY_PDFS_SEARCH_INPUT_ID
    ) as HTMLInputElement;
    const clear = document.getElementById(
      'shift-my-pdfs-search-clear'
    ) as HTMLButtonElement;

    input.value = 'report';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(getMyPdfsSearchQuery()).toBe('report');
    expect(clear.hidden).toBe(false);

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(input.value).toBe('');
    expect(getMyPdfsSearchQuery()).toBe('');
    expect(clear.hidden).toBe(true);

    input.value = 'again';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    clear.click();
    expect(input.value).toBe('');
    expect(getMyPdfsSearchQuery()).toBe('');
  });

  it('keeps the authored icon-only view toggle, with no visible labels', () => {
    document.body.className = 'shift-home';
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf,.pdf" multiple />
      </div>
      <section id="shift-my-pdfs" data-view="thumbnail">
        <div class="shift-open-file-header">
          <h2 id="shift-my-pdfs-heading">My PDFs</h2>
          <div class="shift-open-file-header-controls">
            <div
              class="shift-open-file-view-by"
              role="group"
              aria-label="View by"
              data-i18n-aria-label="home.viewBy"
            >
              <span data-i18n="home.viewBy">View by</span>
              <div class="shift-open-file-view-toggle">
                <button
                  type="button"
                  id="shift-open-file-view-list"
                  class="shift-open-file-view-btn"
                  data-view="list"
                  aria-pressed="false"
                  aria-label="List view"
                >
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M3 4h10M3 8h10M3 12h10"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  id="shift-open-file-view-thumbnail"
                  class="shift-open-file-view-btn"
                  data-view="thumbnail"
                  aria-pressed="true"
                  aria-label="Thumbnail view"
                >
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="2.5" y="2.5" width="4.5" height="4.5" stroke="currentColor" stroke-width="1.5" />
                    <rect x="9" y="2.5" width="4.5" height="4.5" stroke="currentColor" stroke-width="1.5" />
                    <rect x="2.5" y="9" width="4.5" height="4.5" stroke="currentColor" stroke-width="1.5" />
                    <rect x="9" y="9" width="4.5" height="4.5" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <table class="shift-my-pdfs-table">
          <tbody id="shift-my-pdfs-body"></tbody>
        </table>
        <div id="shift-my-pdfs-thumbs" class="shift-open-file-thumbs"></div>
      </section>
    `;
    setHomeLibraryFiles([]);

    const grid = document.getElementById('shift-open-file-view-thumbnail');
    const list = document.getElementById('shift-open-file-view-list');
    const toggle = document.querySelector('.shift-open-file-view-toggle');

    // Authored icons survive the restyle untouched.
    expect(grid?.querySelectorAll('svg rect')).toHaveLength(4);
    expect(list?.querySelector('svg path')?.getAttribute('d')).toBe(
      'M3 4h10M3 8h10M3 12h10'
    );

    // Icon-only: the buttons render no text of their own.
    expect(grid?.textContent?.trim()).toBe('');
    expect(list?.textContent?.trim()).toBe('');

    // Screen-reader affordances stay as authored.
    expect(grid?.getAttribute('aria-label')).toBe('Thumbnail view');
    expect(list?.getAttribute('aria-label')).toBe('List view');
    expect(grid?.getAttribute('aria-pressed')).toBe('true');
    expect(list?.getAttribute('aria-pressed')).toBe('false');
    expect(
      document
        .querySelector('.shift-open-file-view-by')
        ?.getAttribute('aria-label')
    ).toBe('View by');
    expect(
      document.querySelector('.shift-open-file-view-by > span')?.textContent
    ).toBe('View by');

    // Grid comes first, matching My Images.
    expect(toggle?.firstElementChild).toBe(grid);
    // The toggle moves into the new control row, replacing the old header.
    expect(
      document.querySelector('.shift-my-pdfs-controls .shift-open-file-view-by')
    ).not.toBeNull();
    expect(document.querySelector('.shift-open-file-header')).toBeNull();
  });

  it('shows select-all count for the library', () => {
    mountMyPdfs();
    const first = new File(['a'], 'one.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'two.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([first, second]);

    expect(
      document.getElementById('shift-my-pdfs-selection-count')?.textContent
    ).toBe('0 of 2 selected');

    setWorkspaceFiles([first]);
    expect(
      document.getElementById('shift-my-pdfs-selection-count')?.textContent
    ).toBe('1 of 2 selected');

    document.getElementById('shift-my-pdfs-select-all')?.click();
    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'one.pdf',
      'two.pdf',
    ]);
    expect(
      document.getElementById('shift-my-pdfs-selection-count')?.textContent
    ).toBe('2 of 2 selected');
    expect(
      document.getElementById('shift-my-pdfs-select-all')?.textContent
    ).toBe('Deselect all');
  });
});
