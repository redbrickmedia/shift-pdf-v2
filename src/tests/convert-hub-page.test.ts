import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addConvertSources,
  createInitialConvertHubState,
  getDestinationsForSources,
  handoffConvertSourcesToTool,
  initConvertHubPage,
  openConvertSourcePicker,
  removeConvertSource,
  renderConvertHub,
  resolveInitialConvertSources,
} from '../js/logic/convert-hub-page';
import { clearPersistedOpenFile } from '../js/logic/open-file-store';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import * as pdfLibraryPicker from '../js/logic/pdf-library-picker';
import {
  clearWorkspaceOpenFile,
  getWorkspaceFiles,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

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

function mountHub(): void {
  document.body.innerHTML = `
    <div id="convert-source-step"></div>
    <div id="convert-destination-step">
      <span id="convert-source-label"></span>
      <strong id="convert-source-name"></strong>
      <span id="convert-source-meta"></span>
      <ul id="convert-source-list" class="hidden"></ul>
      <h2 id="convert-destination-heading"></h2>
      <div id="convert-destination-primary"></div>
      <button id="convert-show-more-formats" type="button"></button>
      <div id="convert-destination-secondary"></div>
      <p id="convert-unsupported-message" class="hidden"></p>
      <button id="convert-add-source" type="button"></button>
      <button id="convert-change-source" type="button"></button>
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

afterEach(async () => {
  resetWorkspaceFileIndicator();
  await clearWorkspaceOpenFile();
  await clearPersistedOpenFile();
  await clearPdfLibrary();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('convert hub state', () => {
  it('starts on the destination step when source files already exist', () => {
    const file = pdf('active.pdf');
    expect(createInitialConvertHubState([file])).toEqual({
      step: 'destination',
      sourceFiles: [file],
    });
  });

  it('starts on the source step with nothing selected', () => {
    expect(createInitialConvertHubState()).toEqual({
      step: 'source',
      sourceFiles: [],
    });
  });

  it('adds to the selection instead of replacing it', () => {
    const first = pdf('one.pdf');
    const second = pdf('two.pdf', '%PDF-second');
    const state = addConvertSources(createInitialConvertHubState(), [first]);

    expect(addConvertSources(state, [second])).toEqual({
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
    expect(afterRemove).toEqual({
      step: 'destination',
      sourceFiles: [second],
    });

    expect(
      removeConvertSource(afterRemove, {
        name: second.name,
        size: second.size,
      })
    ).toEqual({ step: 'source', sourceFiles: [] });
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

  // A single-file tool would keep one file and drop the rest without saying so,
  // so it has to stay visibly out of reach rather than look ready.
  it('disables destinations that cannot take a batch', () => {
    mountHub();
    render(
      createInitialConvertHubState([
        pdf('one.pdf'),
        pdf('two.pdf', '%PDF-second'),
      ]),
      { showMore: true }
    );

    const jpg = document.querySelector<HTMLButtonElement>(
      '[data-destination-id="pdf-to-jpg"]'
    );
    const docxTarget = document.querySelector<HTMLButtonElement>(
      '[data-destination-id="pdf-to-docx"]'
    );

    expect(jpg?.disabled).toBe(true);
    expect(jpg?.classList.contains('is-unavailable')).toBe(true);
    expect(
      jpg?.querySelector('.shift-convert-destination-output')?.textContent
    ).toBe('One file at a time');

    expect(docxTarget?.disabled).toBe(false);
    expect(
      docxTarget?.querySelector('.shift-convert-destination-output')
        ?.textContent
    ).toBe('2 files → .docx');
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

  it('persists every source file and navigates into the selected tool', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign },
    });

    await handoffConvertSourcesToTool(
      [pdf('one.pdf'), pdf('two.pdf', '%PDF-second')],
      {
        id: 'pdf-to-docx',
        name: 'PDF to Word',
        subtitle: 'Editable DOCX',
        icon: 'ph-microsoft-word-logo',
        href: '/pdf-to-docx.html',
        outputExtension: 'docx',
        acceptsMultiple: true,
      }
    );

    expect(assign).toHaveBeenCalledWith('/pdf-to-docx.html');
    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'one.pdf',
      'two.pdf',
    ]);
  });

  it('hands a single-file tool only the first file', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign },
    });

    await handoffConvertSourcesToTool(
      [pdf('one.pdf'), pdf('two.pdf', '%PDF-second')],
      {
        id: 'pdf-to-jpg',
        name: 'PDF to JPG',
        subtitle: 'Page images',
        icon: 'ph-file-image',
        href: '/pdf-to-jpg.html',
        outputExtension: 'jpg',
        acceptsMultiple: false,
      }
    );

    expect(assign).toHaveBeenCalledWith('/pdf-to-jpg.html');
    expect(getWorkspaceFiles().map((file) => file.name)).toEqual(['one.pdf']);
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

// Every id the page logic reads lives in pdf-converter.html, so drive the real
// markup: a renamed or missing element is otherwise invisible to unit tests that
// mount their own fixture.
describe('convert hub against the shipped page markup', () => {
  function mountRealPage(): void {
    const markup = readFileSync(
      path.resolve(__dirname, '../../pdf-converter.html'),
      'utf8'
    );
    const hub = /<div\s+id="convert-hub"[\s\S]*?\n {6}<\/div>/.exec(markup);
    expect(hub).not.toBeNull();
    document.body.innerHTML = hub?.[0] ?? '';
  }

  // jsdom has no DataTransfer, the same gap assignInputFiles works around.
  function selectFiles(files: File[]): void {
    const input = document.getElementById('file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: files,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

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

  it('re-enables a single-file destination once a file is removed', async () => {
    mountRealPage();
    initConvertHubPage(document);
    await Promise.resolve();

    selectFiles([pdf('alpha.pdf'), pdf('beta.pdf', '%PDF-beta')]);

    const jpgSelector = '[data-destination-id="pdf-to-jpg"]';
    expect(
      document.querySelector<HTMLButtonElement>(jpgSelector)?.disabled
    ).toBe(true);

    document
      .querySelector<HTMLButtonElement>('.shift-convert-source-remove')
      ?.click();

    expect(document.getElementById('convert-source-name')?.textContent).toBe(
      'beta.pdf'
    );
    expect(
      document
        .getElementById('convert-source-list')
        ?.classList.contains('hidden')
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(jpgSelector)?.disabled
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
