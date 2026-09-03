import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import { seedToolOpenFile } from '../js/logic/seed-tool-open-file';
import { writePersistedOpenFile } from '../js/logic/open-file-store';
import { state } from '../js/state';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

vi.stubGlobal('Worker', MockWorker);

const PDF_TO_JSON_PAGE_DOM = `
  <div id="drop-zone">
    <input id="file-input" type="file" accept="application/pdf" multiple />
  </div>
  <div id="file-controls" class="hidden"></div>
  <div id="file-display-area"></div>
  <div id="convert-options" class="hidden"></div>
  <button id="process-btn" disabled></button>
  <button id="add-more-btn"></button>
  <button id="clear-files-btn"></button>
  <div id="status-message" class="hidden"></div>
`;

afterEach(async () => {
  state.files = [];
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  vi.resetModules();
});

describe('pdf to json page', () => {
  beforeEach(() => {
    state.files = [];
    resetWorkspaceFileIndicator();
    document.body.innerHTML = PDF_TO_JSON_PAGE_DOM;
  });

  it('reveals conversion options when a selected PDF is seeded', async () => {
    const file = new File(['pdf'], 'seminar-overview.pdf', {
      type: 'application/pdf',
    });
    await addPdfToLibrary(file, 'upload');
    await writePersistedOpenFile(file, { source: 'upload' });

    await import('../js/logic/pdf-to-json.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(state.files).toHaveLength(1);
    expect(state.files[0]?.name).toBe('seminar-overview.pdf');
    expect(
      document.getElementById('convert-options')?.classList.contains('hidden')
    ).toBe(false);
    expect(
      document.getElementById('file-controls')?.classList.contains('hidden')
    ).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(
      (document.getElementById('process-btn') as HTMLButtonElement).disabled
    ).toBe(false);
  });
});
