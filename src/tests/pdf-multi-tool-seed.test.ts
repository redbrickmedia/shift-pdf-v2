import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import { seedToolOpenFile } from '../js/logic/seed-tool-open-file';
import { writePersistedOpenFiles } from '../js/logic/open-file-store';
import { state } from '../js/state';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

const MULTI_TOOL_DOM = `
  <div id="main-scroll-container">
    <div id="upload-area" class="hidden">
      <input
        id="pdf-file-input"
        type="file"
        accept="application/pdf,image/*"
        multiple
      />
      <button id="pdf-file-input-select-btn" type="button"></button>
    </div>
    <div id="pages-container"></div>
  </div>
`;

afterEach(async () => {
  state.files = [];
  resetToolFilesSeededState();
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
});

describe('pdf multi tool seeding', () => {
  beforeEach(() => {
    state.files = [];
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    document.body.innerHTML = MULTI_TOOL_DOM;
  });

  it('assigns selected workspace PDFs into #pdf-file-input on seed', async () => {
    const first = new File(['a'], 'alpha.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'beta.pdf', { type: 'application/pdf' });
    await addPdfToLibrary(first, 'upload');
    await addPdfToLibrary(second, 'upload');
    await writePersistedOpenFiles([
      { file: first, source: 'upload' },
      { file: second, source: 'upload' },
    ]);

    let changeFiles: string[] = [];
    document
      .getElementById('pdf-file-input')
      ?.addEventListener('change', (event) => {
        const input = event.target as HTMLInputElement;
        changeFiles = Array.from(input.files ?? []).map((file) => file.name);
      });

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(changeFiles).toEqual(['alpha.pdf', 'beta.pdf']);
    expect(state.files.map((file) => file.name)).toEqual([
      'alpha.pdf',
      'beta.pdf',
    ]);
    const input = document.getElementById('pdf-file-input') as HTMLInputElement;
    expect(Array.from(input.files ?? []).map((file) => file.name)).toEqual([
      'alpha.pdf',
      'beta.pdf',
    ]);
  });

  it('does not invent a selection when the workspace is empty', async () => {
    await addPdfToLibrary(
      new File(['x'], 'library-only.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await expect(seedToolOpenFile()).resolves.toBe(false);
    expect(state.files).toHaveLength(0);
    const input = document.getElementById('pdf-file-input') as HTMLInputElement;
    expect(input.files?.length ?? 0).toBe(0);
  });
});
