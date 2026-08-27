import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/embedder/shift-file-access.js', () => ({
  getSourceTabIdFromLocation: vi.fn(() => undefined),
  getHandoffSourceTabId: vi.fn(() => undefined),
  isShiftFilesBridgeReady: vi.fn(() => false),
  readOpenShiftFile: vi.fn(),
}));

vi.mock('../js/ui.js', async () => {
  const actual =
    await vi.importActual<typeof import('../js/ui.js')>('../js/ui.js');
  return {
    ...actual,
    showAlert: vi.fn(),
  };
});

import * as shiftFileAccess from '../js/embedder/shift-file-access';
import {
  applyFileToToolInput,
  inputAcceptsFile,
  seedToolOpenFile,
} from '../js/logic/seed-tool-open-file';
import { writePersistedOpenFile } from '../js/logic/open-file-store';
import { state } from '../js/state';
import {
  getWorkspaceFiles,
  markFileFromExtension,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

afterEach(async () => {
  state.files = [];
  resetWorkspaceFileIndicator();
  vi.clearAllMocks();
  vi.mocked(shiftFileAccess.isShiftFilesBridgeReady).mockReturnValue(false);
  vi.mocked(shiftFileAccess.getSourceTabIdFromLocation).mockReturnValue(
    undefined
  );
  vi.mocked(shiftFileAccess.getHandoffSourceTabId).mockReturnValue(undefined);
  vi.mocked(shiftFileAccess.readOpenShiftFile).mockReset();
});

describe('seed tool open file', () => {
  it('does not seed the home page picker', async () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden></section>
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
    `;
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );

    await expect(seedToolOpenFile()).resolves.toBe(false);
    expect(getWorkspaceFiles()).toEqual([]);
  });

  it('hides the tool picker and loads a persisted upload', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
    `;
    const input = document.getElementById('file-input') as HTMLInputElement;
    const change = vi.fn();
    input.addEventListener('change', change);
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(getWorkspaceFiles()).toMatchObject([{ name: 'briefing.pdf' }]);
    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(input.files?.[0]?.name).toBe('briefing.pdf');
    expect(change).toHaveBeenCalledOnce();
  });

  it('uses the persisted file on later tools even when the Shift bridge is ready', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
    `;
    vi.mocked(shiftFileAccess.isShiftFilesBridgeReady).mockReturnValue(true);
    vi.mocked(shiftFileAccess.readOpenShiftFile).mockResolvedValue(
      new File(['from-tab'], 'from-tab.pdf', { type: 'application/pdf' })
    );
    await writePersistedOpenFile(
      new File(['home'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'extension', sourceTabId: 9 }
    );

    await seedToolOpenFile();

    expect(shiftFileAccess.readOpenShiftFile).not.toHaveBeenCalled();
    expect(getWorkspaceFiles()[0]?.name).toBe('briefing.pdf');
    expect(getWorkspaceFiles()[0]?.source).toBe('extension');
  });

  it('reads from Shift when this page is a fresh handoff', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
    `;
    vi.mocked(shiftFileAccess.getSourceTabIdFromLocation).mockReturnValue(12);
    vi.mocked(shiftFileAccess.getHandoffSourceTabId).mockReturnValue(12);
    vi.mocked(shiftFileAccess.readOpenShiftFile).mockImplementation(async () =>
      markFileFromExtension(
        new File(['from-tab'], 'from-tab.pdf', { type: 'application/pdf' }),
        12
      )
    );
    await writePersistedOpenFile(
      new File(['home'], 'home.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );

    await seedToolOpenFile();

    expect(getWorkspaceFiles()[0]?.name).toBe('from-tab.pdf');
    expect(getWorkspaceFiles()[0]?.source).toBe('extension');
  });

  it('falls back to a Shift read when persist is empty but the tab is remembered', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
    `;
    vi.mocked(shiftFileAccess.getHandoffSourceTabId).mockReturnValue(9);
    vi.mocked(shiftFileAccess.readOpenShiftFile).mockImplementation(async () =>
      markFileFromExtension(
        new File(['from-tab'], 'from-tab.pdf', { type: 'application/pdf' }),
        9
      )
    );

    await seedToolOpenFile();

    expect(shiftFileAccess.readOpenShiftFile).toHaveBeenCalledOnce();
    expect(getWorkspaceFiles()[0]?.name).toBe('from-tab.pdf');
  });

  it('overwrites a populated picker and fires change', () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" accept="application/pdf" />
    `;
    const input = document.getElementById('file-input') as HTMLInputElement;
    const existing = new File(['old'], 'old.pdf', { type: 'application/pdf' });
    const next = new File(['new'], 'new.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [existing],
    });
    const change = vi.fn();
    input.addEventListener('change', change);

    expect(applyFileToToolInput(next)).toBe(true);
    expect(input.files?.[0]?.name).toBe('new.pdf');
    expect(change).toHaveBeenCalledOnce();
  });

  it('does not put a PDF into an image-only picker', () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" accept="image/png,.png" />
    `;
    const input = document.getElementById('file-input') as HTMLInputElement;
    const file = new File(['x'], 'briefing.pdf', { type: 'application/pdf' });

    expect(inputAcceptsFile(input, file)).toBe(false);
    expect(applyFileToToolInput(file)).toBe(false);
  });

  it('keeps the upload picker on tools that do not accept PDFs', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="image/jpeg,.jpg" />
      </div>
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Active file</h2>
        <div id="shift-open-files-list"></div>
      </section>
    `;
    const input = document.getElementById('file-input') as HTMLInputElement;
    const change = vi.fn();
    input.addEventListener('change', change);
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(getWorkspaceFiles()).toMatchObject([{ name: 'briefing.pdf' }]);
    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      false
    );
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(input.files?.length ?? 0).toBe(0);
    expect(change).not.toHaveBeenCalled();
    expect(state.files).toEqual([]);
  });

  it('keeps the uploaded file after a tool page clears its local list', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    `;
    await writePersistedOpenFile(
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );

    setWorkspaceFiles([]);
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    `;

    await expect(seedToolOpenFile()).resolves.toBe(true);
    expect(getWorkspaceFiles()[0]?.name).toBe('briefing.pdf');
    expect(state.files[0]?.name).toBe('briefing.pdf');
    expect(
      document.querySelector('#file-display-area .truncate')?.textContent
    ).toBe('briefing.pdf');
  });

  it('keeps a Shift handoff file after a tool page clears its local list', async () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    `;
    await writePersistedOpenFile(
      new File(['x'], 'from-tab.pdf', { type: 'application/pdf' }),
      { source: 'extension', sourceTabId: 9 }
    );

    setWorkspaceFiles([]);
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    `;

    await expect(seedToolOpenFile()).resolves.toBe(true);
    expect(getWorkspaceFiles()[0]).toMatchObject({
      name: 'from-tab.pdf',
      source: 'extension',
      sourceTabId: 9,
    });
    expect(state.files[0]?.name).toBe('from-tab.pdf');
  });
});
