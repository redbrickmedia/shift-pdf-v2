import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInitialConvertHubState,
  getDestinationsForSource,
  handoffConvertSourceToTool,
  openConvertSourcePicker,
  renderConvertHub,
  resolveInitialConvertSource,
  selectConvertSource,
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

afterEach(async () => {
  resetWorkspaceFileIndicator();
  await clearWorkspaceOpenFile();
  await clearPersistedOpenFile();
  await clearPdfLibrary();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('convert hub state', () => {
  it('starts on the destination step when a source file already exists', () => {
    const file = new File(['%PDF'], 'active.pdf', { type: 'application/pdf' });
    expect(createInitialConvertHubState(file)).toEqual({
      step: 'destination',
      sourceFile: file,
    });
  });

  it('moves from source upload to destination selection', () => {
    const initial = createInitialConvertHubState(null);
    const file = new File(['%PDF'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    expect(selectConvertSource(initial, file)).toEqual({
      step: 'destination',
      sourceFile: file,
    });
  });

  it('replaces the source file while staying on the destination step', () => {
    const pdf = new File(['%PDF'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    const docx = new File(['doc'], 'briefing.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const selected = selectConvertSource(
      createInitialConvertHubState(null),
      pdf
    );
    expect(selectConvertSource(selected, docx)).toEqual({
      step: 'destination',
      sourceFile: docx,
    });
  });

  it('keeps the current source when a replacement file is unsupported', () => {
    const pdf = new File(['%PDF'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    const unsupported = new File(['txt'], 'notes.txt', { type: 'text/plain' });
    const selected = selectConvertSource(
      createInitialConvertHubState(null),
      pdf
    );
    expect(selectConvertSource(selected, unsupported)).toEqual(selected);
  });

  it('offers PDF destinations for PDF sources and a single PDF target otherwise', () => {
    const pdf = new File(['%PDF'], 'briefing.pdf', { type: 'application/pdf' });
    const docx = new File(['doc'], 'briefing.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(getDestinationsForSource(pdf).primary.length).toBeGreaterThan(0);
    expect(getDestinationsForSource(docx).primary).toHaveLength(1);
    expect(getDestinationsForSource(docx).primary[0]?.id).toBe('word-to-pdf');
  });
});

describe('convert hub page', () => {
  it('resolves the active workspace file before prompting for upload', async () => {
    const file = new File(['%PDF'], 'workspace.pdf', {
      type: 'application/pdf',
    });
    setWorkspaceFiles([file]);
    await expect(resolveInitialConvertSource()).resolves.toBe(file);
  });

  it('renders destination cards after a source file is selected', () => {
    const file = new File(['%PDF'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    document.body.innerHTML = `
      <div id="convert-source-step"></div>
      <div id="convert-destination-step">
        <strong id="convert-source-name"></strong>
        <span id="convert-source-meta"></span>
        <h2 id="convert-destination-heading"></h2>
        <div id="convert-destination-primary"></div>
        <button id="convert-show-more-formats" type="button"></button>
        <div id="convert-destination-secondary"></div>
        <p id="convert-unsupported-message" class="hidden"></p>
        <button id="convert-change-source" type="button"></button>
      </div>
    `;

    renderConvertHub(
      document,
      selectConvertSource(createInitialConvertHubState(null), file),
      {
        onSourceSelected: vi.fn(),
        onChangeSource: vi.fn(),
        onDestinationSelected: vi.fn(),
        onToggleMore: vi.fn(),
        showMore: false,
      }
    );

    expect(
      document
        .getElementById('convert-source-step')
        ?.classList.contains('hidden')
    ).toBe(true);
    expect(document.getElementById('convert-source-name')?.textContent).toBe(
      'briefing.pdf'
    );
    expect(
      document.querySelectorAll(
        '#convert-destination-primary .shift-convert-destination'
      ).length
    ).toBeGreaterThan(0);
  });

  it('persists the source file and navigates into the selected tool', async () => {
    const file = new File(['%PDF'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign },
    });

    await handoffConvertSourceToTool(file, {
      id: 'pdf-to-docx',
      name: 'PDF to Word',
      subtitle: 'Editable DOCX',
      icon: 'ph-microsoft-word-logo',
      href: '/pdf-to-docx.html',
      outputExtension: 'docx',
    });

    expect(assign).toHaveBeenCalledWith('/pdf-to-docx.html');
    expect(getWorkspaceFiles()[0]?.name).toBe('briefing.pdf');
  });

  it('calls onChangeSource when the change file button is clicked', () => {
    const file = new File(['%PDF'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    document.body.innerHTML = `
      <div id="convert-source-step"></div>
      <div id="convert-destination-step">
        <strong id="convert-source-name"></strong>
        <span id="convert-source-meta"></span>
        <h2 id="convert-destination-heading"></h2>
        <div id="convert-destination-primary"></div>
        <button id="convert-show-more-formats" type="button"></button>
        <div id="convert-destination-secondary"></div>
        <p id="convert-unsupported-message" class="hidden"></p>
        <button id="convert-change-source" type="button"></button>
      </div>
    `;

    const onChangeSource = vi.fn();
    renderConvertHub(
      document,
      selectConvertSource(createInitialConvertHubState(null), file),
      {
        onSourceSelected: vi.fn(),
        onChangeSource,
        onDestinationSelected: vi.fn(),
        onToggleMore: vi.fn(),
        showMore: false,
      }
    );

    document.getElementById('convert-change-source')?.click();
    expect(onChangeSource).toHaveBeenCalledTimes(1);
  });

  it('updates destination options when the source file is replaced', () => {
    const pdf = new File(['%PDF'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    const docx = new File(['doc'], 'briefing.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    document.body.innerHTML = `
      <div id="convert-source-step"></div>
      <div id="convert-destination-step">
        <strong id="convert-source-name"></strong>
        <span id="convert-source-meta"></span>
        <h2 id="convert-destination-heading"></h2>
        <div id="convert-destination-primary"></div>
        <button id="convert-show-more-formats" type="button"></button>
        <div id="convert-destination-secondary"></div>
        <p id="convert-unsupported-message" class="hidden"></p>
        <button id="convert-change-source" type="button"></button>
      </div>
    `;

    const renderState = (sourceFile: File) => {
      renderConvertHub(
        document,
        selectConvertSource(createInitialConvertHubState(null), sourceFile),
        {
          onSourceSelected: vi.fn(),
          onChangeSource: vi.fn(),
          onDestinationSelected: vi.fn(),
          onToggleMore: vi.fn(),
          showMore: false,
        }
      );
    };

    renderState(pdf);
    expect(
      document.getElementById('convert-destination-heading')?.textContent
    ).toBe('Convert to…');
    expect(
      document.querySelectorAll(
        '#convert-destination-primary .shift-convert-destination'
      ).length
    ).toBeGreaterThan(1);

    renderState(docx);
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

describe('openConvertSourcePicker', () => {
  it('opens the library picker when saved PDFs exist', async () => {
    await addPdfToLibrary(
      new File(['one'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );
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
        file: new File(['one'], 'saved.pdf', { type: 'application/pdf' }),
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
    expect(openPicker.mock.calls[0]?.[0]?.title).toBe(
      'Choose a file to convert'
    );
    expect(openPicker.mock.calls[0]?.[0]?.exclude).toEqual([]);
    expect(fileInput.click).not.toHaveBeenCalled();
  });

  it('excludes the current convert source when changing file', async () => {
    const currentSource = new File(['one'], 'saved.pdf', {
      type: 'application/pdf',
    });
    const openPicker = vi
      .spyOn(pdfLibraryPicker, 'openPdfLibraryPicker')
      .mockResolvedValue();

    await openConvertSourcePicker(document, null, vi.fn(), currentSource);

    expect(openPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        exclude: [{ name: 'saved.pdf', size: currentSource.size }],
      })
    );
  });

  it('disables the current convert source in the library picker', async () => {
    const currentSource = new File(['one'], 'saved.pdf', {
      type: 'application/pdf',
    });
    await addPdfToLibrary(currentSource, 'upload');
    await addPdfToLibrary(
      new File(['two'], 'other.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await openConvertSourcePicker(document, null, vi.fn(), currentSource);

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

  it('does not replace the source when the library picker is cancelled', async () => {
    await addPdfToLibrary(
      new File(['one'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );
    const onFileSelected = vi.fn();

    await openConvertSourcePicker(document, null, onFileSelected);
    document
      .querySelector<HTMLButtonElement>('.shift-library-picker-close')
      ?.click();

    expect(onFileSelected).not.toHaveBeenCalled();
    expect(document.getElementById('shift-pdf-library-picker')).toBeNull();
  });
});
