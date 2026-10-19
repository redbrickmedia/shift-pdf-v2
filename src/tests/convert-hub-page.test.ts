import { readFileSync } from 'node:fs';
import * as analytics from '../js/host/analytics';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addConvertSources,
  createInitialConvertHubState,
  describeRejectedConvertSources,
  getDestinationsForSources,
  initConvertHubPage,
  openConvertSourcePicker,
  removeConvertSource,
  renderConvertHub,
  resolveInitialConvertSources,
  setConvertDestinationSearchQuery,
} from '../js/logic/convert-hub-page';
import {
  clearPersistedOpenFile,
  hasOpenWithSelection,
  clearOpenWithSelection,
} from '../js/logic/open-file-store';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import * as pymupdfLoader from '../js/utils/pymupdf-loader';
import * as libreofficeLoader from '../js/utils/libreoffice-loader';
import { getLatestPdfOutput } from '../js/logic/shift-pdf-save';
import * as pdfLibraryPicker from '../js/logic/pdf-library-picker';
import {
  clearWorkspaceOpenFile,
  getWorkspaceFiles,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';
import {
  initToolOutputToolbar,
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_PRINT_ID,
  TOOL_OUTPUT_RESET_ID,
  TOOL_OUTPUT_SAVE_ID,
} from '../js/logic/tool-output-toolbar';
import { isViewerChromeFeatureOn } from '../js/logic/viewer-chrome';

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

vi.mock('../js/utils/disabled-tools.js', () => ({
  isToolDisabled: vi.fn(() => false),
}));

function pdf(name: string, body = '%PDF'): File {
  return new File([body], name, { type: 'application/pdf' });
}

function docx(name: string): File {
  return new File(['doc'], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function jpg(name: string): File {
  return new File(['jpg'], name, { type: 'image/jpeg' });
}

function mountHub(): void {
  document.body.innerHTML = `
    <div id="uploader">
      <div id="tool-uploader" data-convert-hub>
        <h1>Convert</h1>
        <p>Select one or more documents, then choose the format you want to convert them to.</p>
        <div id="convert-source-step">
          <div id="drop-zone">
            <input id="file-input" type="file" multiple />
          </div>
        </div>
        <div id="convert-destination-step" class="hidden">
          <span id="convert-source-label"></span>
          <strong id="convert-source-name"></strong>
          <span id="convert-source-meta"></span>
          <ul id="convert-source-list" class="hidden"></ul>
          <h2 id="convert-destination-heading"></h2>
          <div id="convert-destination-primary"></div>
          <button id="convert-show-more-formats" type="button"></button>
          <div id="convert-destination-secondary" class="hidden"></div>
          <div id="convert-format-options" class="hidden"></div>
          <p id="convert-unsupported-message" class="hidden"></p>
          <button id="convert-add-source" type="button"></button>
          <button id="convert-change-source" type="button"></button>
        </div>
      </div>
    </div>
  `;
}

function render(
  state: ReturnType<typeof createInitialConvertHubState>,
  overrides: Partial<Parameters<typeof renderConvertHub>[2]> = {}
): void {
  renderConvertHub(document, state, {
    onSourceSelected: vi.fn(),
    onChangeSource: vi.fn(),
    onAddSource: vi.fn(),
    onRemoveSource: vi.fn(),
    onDestinationSelected: vi.fn(),
    onToggleMore: vi.fn(),
    showMore: false,
    ...overrides,
  });
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-launch-entry');
  document.documentElement.removeAttribute('data-launch-surface');
  document.documentElement.removeAttribute('data-launch-context-applied');
  document.title = 'Convert | Shift PDF';
  window.history.replaceState({}, '', '/pdf-converter.html');
  clearOpenWithSelection();
});

afterEach(async () => {
  resetWorkspaceFileIndicator();
  await clearWorkspaceOpenFile();
  await clearPersistedOpenFile();
  await clearPdfLibrary();
  setConvertDestinationSearchQuery('');
  clearOpenWithSelection();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('convert hub state', () => {
  it('starts on the destination step when source files already exist', () => {
    const file = pdf('active.pdf');
    expect(createInitialConvertHubState([file])).toMatchObject({
      step: 'destination',
      sourceFiles: [file],
    });
  });

  it('starts on the source step with nothing selected', () => {
    expect(createInitialConvertHubState()).toMatchObject({
      step: 'source',
      sourceFiles: [],
    });
  });

  it('adds to the selection instead of replacing it', () => {
    const first = pdf('one.pdf');
    const second = pdf('two.pdf', '%PDF-second');
    const state = addConvertSources(createInitialConvertHubState(), [first]);

    expect(addConvertSources(state, [second])).toMatchObject({
      step: 'destination',
      sourceFiles: [first, second],
    });
  });

  it('ignores a file that is already selected', () => {
    const file = pdf('one.pdf');
    const state = addConvertSources(createInitialConvertHubState(), [file]);

    expect(addConvertSources(state, [pdf('one.pdf')]).sourceFiles).toHaveLength(
      1
    );
  });

  it('does not call a duplicate PDF an unsupported type', () => {
    const file = pdf('find_all.pdf');
    const state = addConvertSources(createInitialConvertHubState(), [file]);

    expect(describeRejectedConvertSources(state, [pdf('find_all.pdf')])).toBe(
      'find_all.pdf is already in this conversion.'
    );
    expect(
      describeRejectedConvertSources(state, [
        new File(['zzz'], 'notes.zip', { type: 'application/zip' }),
      ])
    ).toBe(
      'That file type is not supported for conversion yet. Try a PDF or another common document format.'
    );
  });

  it('keeps supported files from a mixed drop and drops the rest', () => {
    const supported = pdf('one.pdf');
    const unsupported = new File(['zzz'], 'archive.zip', {
      type: 'application/zip',
    });

    expect(
      addConvertSources(createInitialConvertHubState(), [
        supported,
        unsupported,
      ]).sourceFiles
    ).toEqual([supported]);
  });

  it('keeps the current selection when nothing supported is added', () => {
    const state = addConvertSources(createInitialConvertHubState(), [
      pdf('one.pdf'),
    ]);
    const unsupported = new File(['zzz'], 'archive.zip', {
      type: 'application/zip',
    });

    expect(addConvertSources(state, [unsupported])).toBe(state);
  });

  it('removes one file and returns to the source step once empty', () => {
    const first = pdf('one.pdf');
    const second = pdf('two.pdf', '%PDF-second');
    const state = addConvertSources(createInitialConvertHubState(), [
      first,
      second,
    ]);

    const afterRemove = removeConvertSource(state, {
      name: first.name,
      size: first.size,
    });
    expect(afterRemove).toMatchObject({
      step: 'destination',
      sourceFiles: [second],
    });

    expect(
      removeConvertSource(afterRemove, {
        name: second.name,
        size: second.size,
      })
    ).toMatchObject({ step: 'source', sourceFiles: [] });
  });

  it('offers PDF destinations for PDFs and a single PDF target otherwise', () => {
    expect(
      getDestinationsForSources([pdf('briefing.pdf')]).primary.length
    ).toBeGreaterThan(0);

    const wordDestinations = getDestinationsForSources([
      docx('briefing.docx'),
    ]).primary;
    expect(wordDestinations).toHaveLength(1);
    expect(wordDestinations[0]?.id).toBe('word-to-pdf');
  });
});

describe('convert hub page', () => {
  it('resolves every active workspace file before prompting for upload', () => {
    const first = pdf('one.pdf');
    const second = pdf('two.pdf', '%PDF-second');
    setWorkspaceFiles([first, second]);

    expect(resolveInitialConvertSources().map((file) => file.name)).toEqual([
      'one.pdf',
      'two.pdf',
    ]);
  });

  it('renders destination cards after a source file is selected', () => {
    mountHub();
    render(createInitialConvertHubState([pdf('briefing.pdf')]));

    expect(
      document
        .getElementById('convert-source-step')
        ?.classList.contains('hidden')
    ).toBe(true);
    expect(document.getElementById('convert-source-name')?.textContent).toBe(
      'briefing.pdf'
    );
    expect(
      document
        .getElementById('convert-source-list')
        ?.classList.contains('hidden')
    ).toBe(true);
    expect(
      document.querySelectorAll(
        '#convert-destination-primary .shift-convert-destination'
      ).length
    ).toBeGreaterThan(0);
  });

  it('lists each file and summarises the batch when several are selected', () => {
    mountHub();
    render(
      createInitialConvertHubState([
        pdf('one.pdf'),
        pdf('two.pdf', '%PDF-second'),
      ])
    );

    expect(document.getElementById('convert-source-label')?.textContent).toBe(
      'Source files'
    );
    expect(document.getElementById('convert-source-name')?.textContent).toBe(
      '2 files selected'
    );

    const rows = document.querySelectorAll('.shift-convert-source-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('one.pdf');
    expect(
      document
        .getElementById('convert-source-list')
        ?.classList.contains('hidden')
    ).toBe(false);
    expect(document.getElementById('convert-change-source')?.textContent).toBe(
      'Start over'
    );
  });

  it('removes a file through the row action', () => {
    mountHub();
    const onRemoveSource = vi.fn();
    const first = pdf('one.pdf');
    render(
      createInitialConvertHubState([first, pdf('two.pdf', '%PDF-second')]),
      { onRemoveSource }
    );

    document
      .querySelector<HTMLButtonElement>('.shift-convert-source-remove')
      ?.click();

    expect(onRemoveSource).toHaveBeenCalledWith({
      name: 'one.pdf',
      size: first.size,
    });
  });

  it('keeps all 13 Convert from PDF destinations enabled when a multi-file PDF batch is selected', () => {
    mountHub();
    render(
      createInitialConvertHubState([
        pdf('one.pdf'),
        pdf('two.pdf', '%PDF-second'),
      ]),
      { showMore: true }
    );

    const jpgBtn = document.querySelector<HTMLButtonElement>(
      '[data-destination-id="pdf-to-jpg"]'
    );
    const docxBtn = document.querySelector<HTMLButtonElement>(
      '[data-destination-id="pdf-to-docx"]'
    );
    const extractTablesBtn = document.querySelector<HTMLButtonElement>(
      '[data-destination-id="extract-tables"]'
    );

    expect(jpgBtn?.disabled).toBe(false);
    expect(jpgBtn?.classList.contains('is-unavailable')).toBe(false);
    expect(
      jpgBtn?.querySelector('.shift-convert-destination-output')?.textContent
    ).toBe('2 files → .jpg');

    expect(docxBtn?.disabled).toBe(false);
    expect(
      docxBtn?.querySelector('.shift-convert-destination-output')?.textContent
    ).toBe('2 files → .docx');

    expect(extractTablesBtn?.disabled).toBe(false);
  });

  it('filters destination formats when the user searches', () => {
    mountHub();
    render(createInitialConvertHubState([pdf('one.pdf')]), { showMore: true });

    const before = document.querySelectorAll(
      '.shift-convert-destination'
    ).length;
    expect(before).toBeGreaterThan(1);

    setConvertDestinationSearchQuery('word');
    render(createInitialConvertHubState([pdf('one.pdf')]), { showMore: true });

    const visible = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.shift-convert-destination')
    ).map((button) => button.dataset.destinationId);
    expect(visible).toEqual(['pdf-to-docx']);
    expect(
      document.getElementById('convert-destination-search')
    ).not.toBeNull();
  });

  it('explains a selection with no format in common', () => {
    mountHub();
    render(createInitialConvertHubState([pdf('one.pdf'), docx('two.docx')]));

    const message = document.getElementById('convert-unsupported-message');
    expect(message?.classList.contains('hidden')).toBe(false);
    expect(message?.textContent).toContain('no format in common');
    expect(
      document.querySelectorAll(
        '#convert-destination-primary .shift-convert-destination'
      )
    ).toHaveLength(0);
  });

  it('calls onAddSource and onChangeSource from the card actions', () => {
    mountHub();
    const onAddSource = vi.fn();
    const onChangeSource = vi.fn();
    render(createInitialConvertHubState([pdf('briefing.pdf')]), {
      onAddSource,
      onChangeSource,
    });

    document.getElementById('convert-add-source')?.click();
    document.getElementById('convert-change-source')?.click();

    expect(onAddSource).toHaveBeenCalledTimes(1);
    expect(onChangeSource).toHaveBeenCalledTimes(1);
  });

  it('updates destination options when the source file changes kind', () => {
    mountHub();

    render(createInitialConvertHubState([pdf('briefing.pdf')]));
    expect(
      document.getElementById('convert-destination-heading')?.textContent
    ).toBe('Convert to…');
    expect(
      document.querySelectorAll(
        '#convert-destination-primary .shift-convert-destination'
      ).length
    ).toBeGreaterThan(1);

    render(createInitialConvertHubState([docx('briefing.docx')]));
    expect(document.getElementById('convert-source-name')?.textContent).toBe(
      'briefing.docx'
    );
    expect(
      document.getElementById('convert-destination-heading')?.textContent
    ).toBe('Convert to PDF');
    expect(
      document.querySelectorAll(
        '#convert-destination-primary .shift-convert-destination'
      )
    ).toHaveLength(1);
    expect(
      document
        .querySelector(
          '#convert-destination-primary .shift-convert-destination'
        )
        ?.getAttribute('data-destination-id')
    ).toBe('word-to-pdf');
  });
});

describe('in-place destination selection, Launch Context sync, format options, and header actions', () => {
  function mountRealPage(): void {
    const markup = readFileSync(
      path.resolve(__dirname, '../../pdf-converter.html'),
      'utf8'
    );
    const hub = /<div\s+id="tool-uploader"[\s\S]*?\n {6}<\/div>/.exec(markup);
    expect(hub).not.toBeNull();
    document.body.innerHTML = `<div id="uploader">${hub?.[0] ?? ''}</div>`;
  }

  function selectFiles(files: File[]): void {
    const input = document.getElementById('file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: files,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('selects a Convert from PDF destination in-place without navigating, syncs ?entry=, hides Save/Print, and enables Download', async () => {
    mountRealPage();
    initToolOutputToolbar(document);
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([pdf('report.pdf')]);

    const saveBtn = document.getElementById(
      TOOL_OUTPUT_SAVE_ID
    ) as HTMLButtonElement;
    const downloadBtn = document.getElementById(
      TOOL_OUTPUT_DOWNLOAD_ID
    ) as HTMLButtonElement;
    const header = document.querySelector(
      '.shift-pdf-viewer-header'
    ) as HTMLElement;

    // On bare pdf-converter.html with a PDF, waits for user to select a destination card
    expect(downloadBtn.disabled).toBe(true);
    expect(saveBtn.disabled).toBe(true);

    const jpgCard = document.querySelector<HTMLButtonElement>(
      '[data-destination-id="pdf-to-jpg"]'
    );
    expect(jpgCard).not.toBeNull();
    jpgCard?.click();

    expect(window.location.search).toBe('?entry=pdf-to-jpg');
    expect(header.querySelector('h1')?.textContent).toBe('PDF to JPG');
    expect(jpgCard?.classList.contains('is-selected')).toBe(true);
    expect(jpgCard?.getAttribute('aria-pressed')).toBe('true');

    // #file-input.multiple stays true after setLaunchContext
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);

    // Non-PDF destination hides Save and Print and enables Download
    expect(isViewerChromeFeatureOn(header, 'save')).toBe(false);
    expect(isViewerChromeFeatureOn(header, 'print')).toBe(false);
    expect(downloadBtn.disabled).toBe(false);
    expect(
      (document.getElementById(TOOL_OUTPUT_RESET_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    // #convert-format-options renders JPG quality and scale controls
    const optionsEl = document.getElementById('convert-format-options');
    expect(optionsEl?.classList.contains('hidden')).toBe(false);
    expect(
      (document.getElementById('jpg-quality') as HTMLInputElement | null)?.value
    ).toBe('0.9');
    expect(
      (document.getElementById('image-scale') as HTMLSelectElement | null)
        ?.value
    ).toBe('2');
  });

  it('auto-selects the Convert to PDF destination on bare pdf-converter.html when non-PDF files are uploaded and shows Save + Print', async () => {
    mountRealPage();
    initToolOutputToolbar(document);
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([jpg('one.jpg'), jpg('two.jpg')]);

    const header = document.querySelector(
      '.shift-pdf-viewer-header'
    ) as HTMLElement;
    const saveBtn = document.getElementById(
      TOOL_OUTPUT_SAVE_ID
    ) as HTMLButtonElement;
    const downloadBtn = document.getElementById(
      TOOL_OUTPUT_DOWNLOAD_ID
    ) as HTMLButtonElement;
    const printBtn = document.getElementById(
      TOOL_OUTPUT_PRINT_ID
    ) as HTMLButtonElement;

    const jpgToPdfCard = document.querySelector<HTMLButtonElement>(
      '[data-destination-id="jpg-to-pdf"]'
    );
    expect(jpgToPdfCard?.classList.contains('is-selected')).toBe(true);
    expect(jpgToPdfCard?.getAttribute('aria-pressed')).toBe('true');

    expect(isViewerChromeFeatureOn(header, 'save')).toBe(true);
    expect(isViewerChromeFeatureOn(header, 'print')).toBe(true);
    expect(saveBtn.disabled).toBe(false);
    expect(downloadBtn.disabled).toBe(false);
    expect(printBtn.disabled).toBe(false);

    // Image-to-PDF format options: #jpg-pdf-quality + #image-combine-mode when >1 image
    const qualitySelect = document.getElementById(
      'jpg-pdf-quality'
    ) as HTMLSelectElement | null;
    const combineModeSelect = document.getElementById(
      'image-combine-mode'
    ) as HTMLSelectElement | null;
    expect(qualitySelect?.value).toBe('medium');
    expect(combineModeSelect?.value).toBe('combine');

    // Switching combine mode to separate (.zip) disables Print (multi-pdf-zip) while keeping Save enabled
    if (combineModeSelect) {
      combineModeSelect.value = 'separate';
      combineModeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(saveBtn.disabled).toBe(false);
    expect(printBtn.disabled).toBe(true);
  });

  it('pre-selects destination when opened with ?entry=<id> and renders format options for each configurable family', async () => {
    window.history.replaceState(
      {},
      '',
      '/pdf-converter.html?entry=pdf-to-tiff'
    );
    mountRealPage();
    initToolOutputToolbar(document);
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([pdf('scan.pdf')]);

    const tiffCard = document.querySelector<HTMLButtonElement>(
      '[data-destination-id="pdf-to-tiff"]'
    );
    expect(tiffCard?.classList.contains('is-selected')).toBe(true);
    expect(
      (document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    // PDF to TIFF options
    expect(
      (document.getElementById('tiff-dpi') as HTMLSelectElement | null)?.value
    ).toBe('300');
    expect(
      (
        document.getElementById('tiff-compression') as HTMLSelectElement | null
      )?.value.toLowerCase()
    ).toBe('lzw');
    expect(
      (
        document.getElementById('tiff-color-mode') as HTMLSelectElement | null
      )?.value.toLowerCase()
    ).toBe('rgb');
    expect(
      (document.getElementById('tiff-multipage') as HTMLInputElement | null)
        ?.checked
    ).toBe(false);

    // Switch to pdf-to-webp
    document
      .querySelector<HTMLButtonElement>('[data-destination-id="pdf-to-webp"]')
      ?.click();
    expect(
      (document.getElementById('webp-quality') as HTMLInputElement | null)
        ?.value
    ).toBe('0.85');
    expect(
      (document.getElementById('image-scale') as HTMLSelectElement | null)
        ?.value
    ).toBe('2');

    // Switch to pdf-to-png
    document
      .querySelector<HTMLButtonElement>('[data-destination-id="pdf-to-png"]')
      ?.click();
    expect(
      (document.getElementById('png-scale') as HTMLInputElement | null)?.value
    ).toBe('2.0');

    // Switch to pdf-to-markdown
    document
      .querySelector<HTMLButtonElement>(
        '[data-destination-id="pdf-to-markdown"]'
      )
      ?.click();
    expect(
      (document.getElementById('include-images') as HTMLInputElement | null)
        ?.checked
    ).toBe(false);

    // Switch to extract-tables
    document
      .querySelector<HTMLButtonElement>(
        '[data-destination-id="extract-tables"]'
      )
      ?.click();
    expect(
      (document.getElementById('export-format') as HTMLSelectElement | null)
        ?.value
    ).toBe('csv');

    // Switch to zero-option destination pdf-to-docx -> hides #convert-format-options
    document
      .querySelector<HTMLButtonElement>('[data-destination-id="pdf-to-docx"]')
      ?.click();
    expect(
      document
        .getElementById('convert-format-options')
        ?.classList.contains('hidden')
    ).toBe(true);
  });

  it('renders email-to-pdf options and secondary editor button for .txt / .md uploads', async () => {
    mountRealPage();
    initToolOutputToolbar(document);
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([
      new File(['From: a@b.com\n\nHello'], 'msg.eml', {
        type: 'message/rfc822',
      }),
    ]);

    expect(
      (document.getElementById('page-size') as HTMLSelectElement | null)?.value
    ).toBe('a4');
    expect(
      (document.getElementById('include-cc-bcc') as HTMLInputElement | null)
        ?.checked
    ).toBe(true);
    expect(
      (
        document.getElementById(
          'include-attachments'
        ) as HTMLInputElement | null
      )?.checked
    ).toBe(true);

    // Change source to .txt on bare pdf-converter.html
    document.getElementById('convert-change-source')?.click();
    await vi.waitFor(() => {
      expect(
        document
          .getElementById('convert-source-step')
          ?.classList.contains('hidden')
      ).toBe(false);
    });

    selectFiles([
      new File(['Hello world'], 'notes.txt', { type: 'text/plain' }),
    ]);
    const editorBtn = document.getElementById(
      'open-dedicated-editor-btn'
    ) as HTMLButtonElement | null;
    expect(editorBtn).not.toBeNull();
    expect(editorBtn?.textContent).toContain('Open in Text Editor');

    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        assign,
        pathname: '/pdf-converter.html',
        search: '',
        hash: '',
        origin: 'http://localhost',
        href: 'http://localhost/pdf-converter.html',
      },
    });

    editorBtn?.click();
    await vi.waitFor(() => {
      expect(assign).toHaveBeenCalledWith(
        expect.stringMatching(/txt-to-pdf\.html$/)
      );
    });
    expect(hasOpenWithSelection()).toBe(true);
  });

  it('names the Excel download xlsx and explains a duplicate PDF', async () => {
    const end = vi.spyOn(analytics, 'endToolUse');
    mountRealPage();
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([pdf('basicapi.pdf')]);
    expect(
      document.querySelector('[data-destination-id="pdf-to-excel"]')
        ?.textContent
    ).toContain('basicapi.xlsx');

    selectFiles([pdf('basicapi.pdf')]);
    expect(
      document.getElementById('convert-unsupported-message')?.textContent
    ).toBe('basicapi.pdf is already in this conversion.');
    expect(end).toHaveBeenCalledWith('error');
  });

  it('loads a Shift file handoff into the convert selection', async () => {
    const handoffId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        assign: vi.fn(),
        href: `http://localhost/pdf-converter.html?shiftHandoff=${handoffId}`,
        pathname: '/pdf-converter.html',
        search: `?shiftHandoff=${handoffId}`,
      },
    });
    mountRealPage();
    initConvertHubPage(document);

    const source = { postMessage: vi.fn() };
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          bytes: new Uint8Array([37, 80, 68, 70]).buffer,
          channel: 'shift-file-handoff-payload',
          filename: 'basicapi.pdf',
          handoffId,
          mimeType: 'application/pdf',
          mode: 'copy',
          version: 1,
        },
        origin: 'chrome-extension://mofjdkplmlofiadhjjcacadmghmaglna',
        source: source as unknown as Window,
      })
    );

    await vi.waitFor(() => {
      expect(document.getElementById('convert-source-name')?.textContent).toBe(
        'basicapi.pdf'
      );
    });
    await vi.waitFor(() => {
      expect(source.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'shift-file-handoff-accepted',
          handoffId,
          version: 1,
        }),
        'chrome-extension://mofjdkplmlofiadhjjcacadmghmaglna'
      );
    });
  });

  it('accepts a multi-file selection through the page file input', async () => {
    mountRealPage();
    initConvertHubPage(document);
    await Promise.resolve();

    const input = document.getElementById('file-input') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('application/pdf');

    selectFiles([pdf('alpha.pdf'), pdf('beta.pdf', '%PDF-beta')]);

    expect(document.getElementById('convert-source-label')?.textContent).toBe(
      'Source files'
    );
    expect(document.getElementById('convert-source-name')?.textContent).toBe(
      '2 files selected'
    );
    expect(document.querySelectorAll('.shift-convert-source-row')).toHaveLength(
      2
    );
    expect(
      document
        .getElementById('convert-destination-step')
        ?.classList.contains('hidden')
    ).toBe(false);
  });

  it('returns to the drop zone when the selection is cleared', async () => {
    mountRealPage();
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([pdf('alpha.pdf')]);
    expect(
      document
        .getElementById('convert-source-step')
        ?.classList.contains('hidden')
    ).toBe(true);

    document.getElementById('convert-change-source')?.click();
    await vi.waitFor(() => {
      expect(
        document
          .getElementById('convert-source-step')
          ?.classList.contains('hidden')
      ).toBe(false);
    });
    expect(getWorkspaceFiles()).toEqual([]);
  });

  it('executes Image-to-PDF in combine and separate (.zip) modes and unpacks multi-PDF ZIP into My PDFs on Save', async () => {
    const imagesToPdf = vi.fn(
      async (files: File[]) =>
        new Blob([`%PDF-1.4-${files.map((f) => f.name).join(',')}`], {
          type: 'application/pdf',
        })
    );
    vi.spyOn(pymupdfLoader, 'loadPyMuPDF').mockResolvedValue({
      imagesToPdf,
    } as unknown as Awaited<ReturnType<typeof pymupdfLoader.loadPyMuPDF>>);

    mountRealPage();
    initToolOutputToolbar(document);
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([jpg('page1.jpg'), jpg('page2.jpg')]);

    const saveBtn = document.getElementById(
      TOOL_OUTPUT_SAVE_ID
    ) as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('jpg_to_pdf.pdf');
    });
    expect(imagesToPdf).toHaveBeenCalledTimes(1);

    // Switch to separate PDF per image (.zip) and click Save -> unpacks both PDFs into My PDFs
    await clearPdfLibrary();
    const combineSelect = document.getElementById(
      'image-combine-mode'
    ) as HTMLSelectElement;
    combineSelect.value = 'separate';
    combineSelect.dispatchEvent(new Event('change', { bubbles: true }));

    saveBtn.click();

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries.map((e) => e.name).sort()).toEqual([
        'page1.pdf',
        'page2.pdf',
      ]);
    });
  });

  it('executes LibreOffice batch conversion to multi-PDF ZIP and unpacks into My PDFs on Save', async () => {
    const convertToPdf = vi.fn(
      async (file: File) =>
        new Blob([`%PDF-1.4-${file.name}`], { type: 'application/pdf' })
    );
    vi.spyOn(libreofficeLoader, 'getLibreOfficeConverter').mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      convertToPdf,
    } as unknown as ReturnType<
      typeof libreofficeLoader.getLibreOfficeConverter
    >);

    mountRealPage();
    initToolOutputToolbar(document);
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([docx('alpha.docx'), docx('beta.docx')]);

    const saveBtn = document.getElementById(
      TOOL_OUTPUT_SAVE_ID
    ) as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries.map((e) => e.name).sort()).toEqual([
        'alpha.pdf',
        'beta.pdf',
      ]);
    });
    expect(convertToPdf).toHaveBeenCalledTimes(2);
    expect(getLatestPdfOutput()?.filename).toBe('word-to-pdf-converted.zip');
  });

  it('executes Convert from PDF destinations in-place via header Download and re-runs fresh when format options change', async () => {
    const pdfToDocx = vi.fn(
      async () =>
        new Blob(['docx-bytes'], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
    );
    const pdfToMarkdown = vi.fn(
      async (_file: Blob, opts?: { includeImages?: boolean }) =>
        opts?.includeImages ? '# Markdown with images' : '# Markdown plain'
    );
    const open = vi.fn(async () => ({
      pageCount: 1,
      getPage: () => ({
        findTables: () => [
          {
            rows: [
              ['Item', 'Qty'],
              ['Pen', '3'],
            ],
            markdown: '| Item | Qty |\n| --- | --- |\n| Pen | 3 |',
            rowCount: 2,
            colCount: 2,
          },
        ],
        toSvg: () => '<svg></svg>',
      }),
    }));

    vi.spyOn(pymupdfLoader, 'loadPyMuPDF').mockResolvedValue({
      pdfToDocx,
      pdfToMarkdown,
      open,
    } as unknown as Awaited<ReturnType<typeof pymupdfLoader.loadPyMuPDF>>);

    mountRealPage();
    initToolOutputToolbar(document);
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([pdf('invoice.pdf')]);

    // Select pdf-to-markdown and download with default includeImages = false
    document
      .querySelector<HTMLButtonElement>(
        '[data-destination-id="pdf-to-markdown"]'
      )
      ?.click();

    const downloadBtn = document.getElementById(
      TOOL_OUTPUT_DOWNLOAD_ID
    ) as HTMLButtonElement;
    downloadBtn.click();

    await vi.waitFor(() => {
      expect(getLatestPdfOutput()?.filename).toBe('invoice.md');
    });
    expect(pdfToMarkdown).toHaveBeenLastCalledWith(
      expect.any(File),
      expect.objectContaining({ includeImages: false })
    );

    // Toggle #include-images and click Download again -> runs fresh with includeImages: true
    const includeImages = document.getElementById(
      'include-images'
    ) as HTMLInputElement;
    includeImages.checked = true;
    includeImages.dispatchEvent(new Event('change', { bubbles: true }));

    downloadBtn.click();
    await vi.waitFor(() => {
      expect(pdfToMarkdown).toHaveBeenLastCalledWith(
        expect.any(File),
        expect.objectContaining({ includeImages: true })
      );
    });

    // Switch to extract-tables and test CSV vs JSON export format
    document
      .querySelector<HTMLButtonElement>(
        '[data-destination-id="extract-tables"]'
      )
      ?.click();

    downloadBtn.click();
    await vi.waitFor(() => {
      expect(getLatestPdfOutput()?.filename).toBe('invoice_table.csv');
    });

    const exportFormat = document.getElementById(
      'export-format'
    ) as HTMLSelectElement;
    exportFormat.value = 'json';
    exportFormat.dispatchEvent(new Event('change', { bubbles: true }));

    downloadBtn.click();
    await vi.waitFor(() => {
      expect(getLatestPdfOutput()?.filename).toBe('invoice_table.json');
    });
  });
});

describe('openConvertSourcePicker', () => {
  it('opens the library picker when saved PDFs exist', async () => {
    await addPdfToLibrary(pdf('saved.pdf', 'one'), 'upload');
    const openPicker = vi
      .spyOn(pdfLibraryPicker, 'openPdfLibraryPicker')
      .mockResolvedValue();
    const onFileSelected = vi.fn();

    await openConvertSourcePicker(document, null, onFileSelected);

    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(openPicker.mock.calls[0]?.[0]?.title).toBe(
      'Choose a file to convert'
    );
    openPicker.mock.calls[0]?.[0]?.onSelect([
      {
        id: 'entry-1',
        name: 'saved.pdf',
        type: 'application/pdf',
        size: 3,
        addedAt: Date.now(),
        source: 'upload',
        availability: 'ready',
        file: pdf('saved.pdf', 'one'),
      },
    ]);
    expect(onFileSelected).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'saved.pdf' })
    );
  });

  it('opens the library picker with an empty state when the library is empty', async () => {
    const openPicker = vi
      .spyOn(pdfLibraryPicker, 'openPdfLibraryPicker')
      .mockResolvedValue();
    const fileInput = { click: vi.fn() } as unknown as HTMLInputElement;

    await openConvertSourcePicker(document, fileInput, vi.fn());

    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(openPicker.mock.calls[0]?.[0]?.exclude).toEqual([]);
    expect(fileInput.click).not.toHaveBeenCalled();
  });

  it('excludes every already selected file', async () => {
    const first = pdf('saved.pdf', 'one');
    const second = pdf('other.pdf', 'two');
    const openPicker = vi
      .spyOn(pdfLibraryPicker, 'openPdfLibraryPicker')
      .mockResolvedValue();

    await openConvertSourcePicker(document, null, vi.fn(), [first, second]);

    expect(openPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        exclude: [
          { name: 'saved.pdf', size: first.size },
          { name: 'other.pdf', size: second.size },
        ],
      })
    );
  });

  it('disables the selected sources in the library picker', async () => {
    const currentSource = pdf('saved.pdf', 'one');
    await addPdfToLibrary(currentSource, 'upload');
    await addPdfToLibrary(pdf('other.pdf', 'two'), 'upload');

    await openConvertSourcePicker(document, null, vi.fn(), [currentSource]);

    const rows = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.shift-library-picker-row')
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.find((row) => row.textContent?.includes('saved.pdf'))?.disabled
    ).toBe(true);
    expect(
      rows.find((row) => row.textContent?.includes('other.pdf'))?.disabled
    ).toBe(false);
    expect(
      rows
        .find((row) => row.textContent?.includes('saved.pdf'))
        ?.getAttribute('aria-label')
    ).toBe('saved.pdf already added');
  });

  it('does not change the selection when the library picker is cancelled', async () => {
    await addPdfToLibrary(pdf('saved.pdf', 'one'), 'upload');
    const onFileSelected = vi.fn();

    await openConvertSourcePicker(document, null, onFileSelected);
    document
      .querySelector<HTMLButtonElement>('.shift-library-picker-close')
      ?.click();

    expect(onFileSelected).not.toHaveBeenCalled();
    expect(document.getElementById('shift-pdf-library-picker')).toBeNull();
  });
});
