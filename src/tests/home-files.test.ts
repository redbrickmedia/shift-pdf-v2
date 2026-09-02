import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/utils/pdf-thumbnail.js', () => ({
  renderPdfFirstPage: vi.fn().mockResolvedValue(undefined),
}));

import { initHomeFiles } from '../js/logic/home-files';
import { writePersistedOpenFile } from '../js/logic/open-file-store';
import {
  getWorkspaceFiles,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

function mountHome() {
  document.body.innerHTML = `
    <div id="drop-zone">
      <input id="file-input" type="file" accept="application/pdf,.pdf" multiple />
    </div>
    <section id="shift-my-pdfs" hidden data-view="thumbnail">
      <h2 id="shift-my-pdfs-heading">Open file</h2>
      <button id="shift-open-file-view-list" data-view="list"></button>
      <button id="shift-open-file-view-thumbnail" data-view="thumbnail"></button>
      <table>
        <tbody id="shift-my-pdfs-body"></tbody>
      </table>
      <div id="shift-my-pdfs-thumbs"></div>
    </section>
  `;
}

function dispatchDrop(files: File[]) {
  const dropZone = document.getElementById('drop-zone');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files },
  });
  dropZone?.dispatchEvent(event);
}

afterEach(() => {
  resetWorkspaceFileIndicator();
  vi.restoreAllMocks();
});

describe('home files', () => {
  it('is a no-op on tool pages without the Open file section', () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" />
      </div>
    `;
    expect(() => initHomeFiles()).not.toThrow();
    expect(getWorkspaceFiles()).toEqual([]);
  });

  it('lists a dropped PDF in the home Open file section', () => {
    mountHome();
    initHomeFiles();
    const pdf = new File([new Uint8Array([1, 2, 3])], 'briefing.pdf', {
      type: 'application/pdf',
    });

    dispatchDrop([pdf]);

    expect(getWorkspaceFiles()).toMatchObject([
      { name: 'briefing.pdf', source: 'upload' },
    ]);
    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(document.getElementById('shift-my-pdfs-heading')?.textContent).toBe(
      'Active file'
    );
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('briefing.pdf');
  });

  it('keeps the home Open file section hidden when nothing is uploaded', () => {
    mountHome();
    initHomeFiles();

    expect(getWorkspaceFiles()).toEqual([]);
    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(true);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(document.querySelector('#shift-my-pdfs-body tr')).toBeNull();
  });

  it('keeps every PDF from a multi-file drop and skips other types', () => {
    mountHome();
    setWorkspaceFiles([{ name: 'previous.pdf' }]);
    initHomeFiles();
    const notes = new File(['x'], 'notes.txt', { type: 'text/plain' });
    const briefing = new File(['x'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    const extra = new File(['x'], 'second.pdf', { type: 'application/pdf' });

    dispatchDrop([notes, briefing, extra]);

    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'briefing.pdf',
      'second.pdf',
    ]);
    expect(document.getElementById('shift-my-pdfs-heading')?.textContent).toBe(
      'Active files'
    );
    expect(document.querySelectorAll('#shift-my-pdfs-body tr')).toHaveLength(2);
  });

  it('replaces the open file instead of adding another', () => {
    mountHome();
    initHomeFiles();
    const first = new File(['a'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'second.pdf', { type: 'application/pdf' });

    dispatchDrop([first]);
    dispatchDrop([second]);

    expect(getWorkspaceFiles()).toMatchObject([{ name: 'second.pdf' }]);
    expect(document.querySelectorAll('#shift-my-pdfs-body tr')).toHaveLength(1);
    expect(document.querySelectorAll('.shift-open-file-thumb')).toHaveLength(1);
  });

  it('accepts PDFs selected through the hidden file input', () => {
    mountHome();
    initHomeFiles();
    const input = document.getElementById('file-input') as HTMLInputElement;
    const pdf = new File(['x'], 'picked.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [pdf],
    });

    input.dispatchEvent(new Event('change'));

    expect(getWorkspaceFiles()).toMatchObject([{ name: 'picked.pdf' }]);
    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('picked.pdf');
  });

  it('keeps every PDF from one multi-select in the file input', () => {
    mountHome();
    initHomeFiles();
    const input = document.getElementById('file-input') as HTMLInputElement;
    const first = new File(['a'], 'one.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'two.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [first, second],
    });

    input.dispatchEvent(new Event('change'));

    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'one.pdf',
      'two.pdf',
    ]);
    expect(document.querySelectorAll('#shift-my-pdfs-body tr')).toHaveLength(2);
  });

  it('restores a handed-off file from the workspace store', async () => {
    await writePersistedOpenFile(
      new File(['x'], 'from-tab.pdf', { type: 'application/pdf' }),
      { source: 'handoff' }
    );
    mountHome();
    initHomeFiles();

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toMatchObject([
        { name: 'from-tab.pdf', source: 'handoff' },
      ]);
    });
    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('from-tab.pdf');
  });
});
