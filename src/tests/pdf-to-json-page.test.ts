import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import { seedToolOpenFile } from '../js/logic/seed-tool-open-file';
import { state } from '../js/state';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';

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

  it('reveals conversion options when a library PDF is seeded', async () => {
    await addPdfToLibrary(
      new File(['pdf'], 'seminar-overview.pdf', {
        type: 'application/pdf',
      }),
      'upload'
    );

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
