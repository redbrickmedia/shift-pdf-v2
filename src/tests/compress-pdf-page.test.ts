import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import { seedToolOpenFile } from '../js/logic/seed-tool-open-file';
import { writePersistedOpenFile } from '../js/logic/open-file-store';
import { state } from '../js/state';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';

const COMPRESS_PAGE_DOM = `
  <div id="drop-zone">
    <input id="file-input" type="file" accept="application/pdf" multiple />
  </div>
  <div id="file-display-area"></div>
  <div id="file-controls" class="hidden"></div>
  <div id="compress-options" class="hidden"></div>
  <button id="process-btn"></button>
  <select id="compression-algorithm">
    <option value="condense">Condense</option>
    <option value="photon">Photon</option>
  </select>
  <p id="condense-info"></p>
  <p id="photon-info" class="hidden"></p>
  <button id="toggle-custom-settings"></button>
  <div id="custom-settings-panel" class="hidden"></div>
  <i id="custom-settings-chevron"></i>
  <section id="completion-panel" class="hidden">
    <p id="completion-summary"></p>
    <span id="completion-timing"></span>
    <a id="completion-download" href="#"></a>
    <button id="completion-start-over" type="button"></button>
  </section>
`;

afterEach(async () => {
  state.files = [];
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  vi.resetModules();
});

describe('compress pdf page', () => {
  beforeEach(() => {
    state.files = [];
    resetWorkspaceFileIndicator();
    document.body.innerHTML = COMPRESS_PAGE_DOM;
  });

  it('reveals compression options when a selected PDF is seeded', async () => {
    const file = new File(['pdf'], 'saved.pdf', { type: 'application/pdf' });
    await addPdfToLibrary(file, 'upload');
    await writePersistedOpenFile(file, { source: 'upload' });

    await import('../js/logic/compress-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await expect(seedToolOpenFile()).resolves.toBe(true);

    expect(state.files).toHaveLength(1);
    expect(state.files[0]?.name).toBe('saved.pdf');
    expect(
      document.getElementById('compress-options')?.classList.contains('hidden')
    ).toBe(false);
    expect(
      document.getElementById('file-controls')?.classList.contains('hidden')
    ).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
  });
});
