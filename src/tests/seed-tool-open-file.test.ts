import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFileToToolInput,
  inputAcceptsFile,
  seedToolOpenFile,
} from '../js/logic/seed-tool-open-file';
import { writePersistedOpenFile } from '../js/logic/open-file-store';
import { state } from '../js/state';
import {
  getWorkspaceFiles,
  persistWorkspaceOpenFile,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

afterEach(() => {
  state.files = [];
  resetWorkspaceFileIndicator();
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
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
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
});
