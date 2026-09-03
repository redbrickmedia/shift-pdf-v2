import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import {
  applyFileToToolInput,
  applyFilesToToolInput,
  inputAcceptsFile,
  seedToolOpenFile,
} from '../js/logic/seed-tool-open-file';
import {
  writePersistedOpenFile,
  writePersistedOpenFiles,
} from '../js/logic/open-file-store';
import { state } from '../js/state';
import * as workspaceFiles from '../js/logic/workspace-files';
import {
  getWorkspaceFiles,
  persistWorkspaceOpenFile,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';
import {
  onToolFilesSeeded,
  resetToolFilesSeededState,
  syncSeededToolFiles,
} from '../js/logic/tool-file-seed';

afterEach(async () => {
  document.body.className = '';
  state.files = [];
  resetToolFilesSeededState();
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
});

describe('seed tool open file', () => {
  it('does not seed the home page picker', async () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden></section>
      <input id="file-input" type="file" accept="application/pdf" />
    `;
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );

    await expect(seedToolOpenFile()).resolves.toBe(false);
    expect(getWorkspaceFiles()).toEqual([]);
  });

  it('does not seed the all-tools catalog page', async () => {
    document.body.className = 'shift-home';
    document.body.innerHTML = `
      <div id="grid-view"><div id="tool-grid"></div></div>
      <input id="file-input" type="file" accept="application/pdf" />
    `;
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );

    await expect(seedToolOpenFile()).resolves.toBe(false);
    expect(getWorkspaceFiles()).toEqual([]);
  });

  it('loads a persisted handoff into a PDF tool', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    `;
    await writePersistedOpenFile(
      new File(['x'], 'from-shift.pdf', { type: 'application/pdf' }),
      { source: 'handoff' }
    );

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(getWorkspaceFiles()[0]).toMatchObject({
      name: 'from-shift.pdf',
      source: 'handoff',
    });
    expect(state.files[0]?.name).toBe('from-shift.pdf');
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });

  it('seeds every selected PDF into a multiple file input', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" multiple />
      </div>
      <div id="file-display-area"></div>
    `;
    await writePersistedOpenFiles([
      {
        file: new File(['first'], 'first.pdf', { type: 'application/pdf' }),
        source: 'upload',
      },
      {
        file: new File(['second'], 'second.pdf', {
          type: 'application/pdf',
        }),
        source: 'upload',
      },
    ]);

    await expect(seedToolOpenFile()).resolves.toBe(true);

    const input = document.getElementById('file-input') as HTMLInputElement;
    expect(Array.from(input.files ?? []).map((file) => file.name)).toEqual([
      'first.pdf',
      'second.pdf',
    ]);
    expect(state.files.map((file) => file.name)).toEqual([
      'first.pdf',
      'second.pdf',
    ]);
    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'first.pdf',
      'second.pdf',
    ]);
  });

  it('uses the most recently selected PDF for a single file input', () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" accept="application/pdf" />
    `;
    const first = new File(['first'], 'first.pdf', {
      type: 'application/pdf',
    });
    const second = new File(['second'], 'second.pdf', {
      type: 'application/pdf',
    });

    expect(applyFilesToToolInput([first, second])).toBe(true);

    const input = document.getElementById('file-input') as HTMLInputElement;
    expect(Array.from(input.files ?? []).map((file) => file.name)).toEqual([
      'second.pdf',
    ]);
    expect(state.files.map((file) => file.name)).toEqual(['second.pdf']);
  });

  it('seeds legacy #pdf-file-input used by Multi PDF', () => {
    document.body.innerHTML = `
      <div id="upload-area">
        <input
          id="pdf-file-input"
          type="file"
          accept="application/pdf,image/*"
          multiple
        />
      </div>
    `;
    const first = new File(['a'], 'one.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'two.pdf', { type: 'application/pdf' });
    let changeCount = 0;
    document
      .getElementById('pdf-file-input')
      ?.addEventListener('change', () => {
        changeCount += 1;
      });

    expect(applyFilesToToolInput([first, second])).toBe(true);

    const input = document.getElementById('pdf-file-input') as HTMLInputElement;
    expect(Array.from(input.files ?? []).map((file) => file.name)).toEqual([
      'one.pdf',
      'two.pdf',
    ]);
    expect(changeCount).toBe(1);
    expect(state.files.map((file) => file.name)).toEqual([
      'one.pdf',
      'two.pdf',
    ]);
  });

  it('seeds legacy #pdfFile and #pdfFileInput upload ids', () => {
    for (const id of ['pdfFile', 'pdfFileInput'] as const) {
      state.files = [];
      resetToolFilesSeededState();
      document.body.innerHTML = `<input id="${id}" type="file" accept="application/pdf" />`;
      const file = new File(['x'], `${id}.pdf`, { type: 'application/pdf' });

      expect(applyFileToToolInput(file)).toBe(true);
      const input = document.getElementById(id) as HTMLInputElement;
      expect(input.files?.[0]?.name).toBe(`${id}.pdf`);
    }
  });

  it('hides the drop zone when the PDF library already has files', async () => {
    await addPdfToLibrary(
      new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    `;
    await writePersistedOpenFile(
      new File(['x'], 'from-shift.pdf', { type: 'application/pdf' }),
      { source: 'handoff' }
    );

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
  });

  it('does not invent a selection from the library when the workspace is empty', async () => {
    await addPdfToLibrary(
      new File(['older'], 'older.pdf', { type: 'application/pdf' }),
      'upload'
    );
    await addPdfToLibrary(
      new File(['newer'], 'newer.pdf', { type: 'application/pdf' }),
      'upload'
    );
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    `;
    const setFiles = vi.spyOn(workspaceFiles, 'setWorkspaceFiles');

    await expect(seedToolOpenFile()).resolves.toBe(false);

    expect(setFiles).not.toHaveBeenCalled();
    expect(getWorkspaceFiles()).toEqual([]);
    expect(state.files).toEqual([]);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });

  it('keeps the picker visible when the tool does not accept PDFs', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="image/png,.png" />
      </div>
    `;
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'handoff' }
    );

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(state.files).toEqual([]);
  });

  it('hides the picker on non-PDF tools when the library already has files', async () => {
    await addPdfToLibrary(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      'upload'
    );
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="image/png,.png" />
      </div>
    `;
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'handoff' }
    );

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(state.files).toEqual([]);
  });

  it('checks a picker accept list before applying a file', () => {
    document.body.innerHTML =
      '<input id="file-input" type="file" accept="image/png,.png" />';
    const input = document.getElementById('file-input') as HTMLInputElement;
    const file = new File(['x'], 'briefing.pdf', { type: 'application/pdf' });

    expect(inputAcceptsFile(input, file)).toBe(false);
    expect(applyFileToToolInput(file)).toBe(false);
  });

  it('does not restore a file after emptying the workspace', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    `;
    const file = new File(['x'], 'briefing.pdf', { type: 'application/pdf' });
    setWorkspaceFiles([file]);
    await persistWorkspaceOpenFile();
    setWorkspaceFiles([]);
    await persistWorkspaceOpenFile();

    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    `;

    await expect(seedToolOpenFile()).resolves.toBe(false);
    expect(getWorkspaceFiles()).toEqual([]);
    expect(state.files).toEqual([]);
  });

  it('does not paint a generic file row without enabling tool controls', async () => {
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
      <div id="compress-options" class="hidden"></div>
      <div id="file-controls" class="hidden"></div>
    `;

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(state.files[0]?.name).toBe('briefing.pdf');
    expect(document.getElementById('file-display-area')?.textContent).toBe('');
  });

  it('enables tool options when the page listens for seeded files', async () => {
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
      <div id="compress-options" class="hidden"></div>
      <div id="file-controls" class="hidden"></div>
      <button id="process-btn"></button>
    `;

    onToolFilesSeeded(() => {
      if (state.files.length === 0) return;
      document.getElementById('compress-options')?.classList.remove('hidden');
      document.getElementById('file-controls')?.classList.remove('hidden');
    });

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(
      document.getElementById('compress-options')?.classList.contains('hidden')
    ).toBe(false);
    expect(
      document.getElementById('file-controls')?.classList.contains('hidden')
    ).toBe(false);
  });

  it('syncSeededToolFiles copies seeded files into a local list', async () => {
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
    `;

    const localFiles: File[] = [];
    syncSeededToolFiles((files) => {
      localFiles.push(...files);
    });

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(localFiles).toHaveLength(1);
    expect(localFiles[0]?.name).toBe('briefing.pdf');
  });
});
