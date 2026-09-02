import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/utils/pdf-thumbnail.js', () => ({
  renderPdfFirstPage: vi.fn().mockResolvedValue(undefined),
}));

import { renderPdfFirstPage } from '../js/utils/pdf-thumbnail';
import {
  hasOpenFileFlag,
  readPersistedOpenFile,
} from '../js/logic/open-file-store';
import {
  copyFileOrigin,
  getHomeOpenFileView,
  getWorkspaceFiles,
  initWorkspaceFileIndicator,
  markFileFromHandoff,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

function mountShell() {
  document.body.innerHTML = `
    <aside id="shift-sidebar">
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
    </aside>
    <div id="drop-zone">
      <input id="file-input" type="file" />
    </div>
    <div id="file-display-area"></div>
    <div id="file-list"></div>
  `;
}

afterEach(() => {
  resetWorkspaceFileIndicator();
});

describe('workspace files sidebar', () => {
  it('hides the sidebar section when no PDF is open', () => {
    mountShell();
    setWorkspaceFiles([]);

    const section = document.getElementById('shift-open-files');
    expect(section?.hidden).toBe(true);
    expect(document.body.classList.contains('shift-has-open-file')).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(getWorkspaceFiles()).toEqual([]);
  });

  it('shows the open file in the sidebar and marks the page', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'contract.pdf', size: 2048 }]);

    const section = document.getElementById('shift-open-files');
    const heading = document.getElementById('shift-open-files-heading');
    const button = document.querySelector('.shift-open-file-item');

    expect(section?.hidden).toBe(false);
    expect(heading?.textContent).toBe('Active file');
    expect(button?.textContent).toContain('contract.pdf');
    expect(button?.hasAttribute('title')).toBe(false);
    expect(button?.getAttribute('data-shift-tooltip')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('contract.pdf');
    expect(button?.getAttribute('data-source')).toBe('upload');
    expect(
      button?.querySelector('.shift-open-file-icon-upload')
    ).not.toBeNull();
    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
  });

  it('keeps the upload picker when the tool does not accept the active PDF', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Active file</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <div id="drop-zone">
        <input id="file-input" type="file" accept="image/jpeg,.jpg" />
      </div>
    `;
    setWorkspaceFiles([
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
    ]);

    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      false
    );
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });

  it('uses a plural heading and caps the visible list', () => {
    mountShell();
    setWorkspaceFiles([
      { name: 'one.pdf' },
      { name: 'two.pdf' },
      { name: 'three.pdf' },
      { name: 'four.pdf' },
      { name: 'five.pdf' },
    ]);

    const heading = document.getElementById('shift-open-files-heading');
    const labels = Array.from(
      document.querySelectorAll('.shift-open-file-item .shift-nav-label')
    ).map((node) => node.textContent);

    expect(heading?.textContent).toBe('Active files');
    expect(labels).toEqual(['one.pdf', 'two.pdf', 'three.pdf', '2 more']);
  });

  it('formats byte and megabyte sizes in the home table', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
      </section>
    `;
    setWorkspaceFiles([{ name: 'tiny.pdf', size: 500 }]);
    expect(
      document.querySelector('#shift-my-pdfs-body td:last-child')?.textContent
    ).toBe('500 B');

    setWorkspaceFiles([{ name: 'large.pdf', size: 2 * 1024 * 1024 }]);
    expect(
      document.querySelector('#shift-my-pdfs-body td:last-child')?.textContent
    ).toBe('2.0 MB');
  });

  it('does nothing when the file picker is missing', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
    `;
    setWorkspaceFiles([{ name: 'report.pdf' }]);
    expect(() =>
      document
        .querySelector<HTMLButtonElement>('.shift-open-file-item')
        ?.click()
    ).not.toThrow();
  });

  it('opens the hidden file picker from a sidebar file chip', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'report.pdf', size: 512 }]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    document.querySelector<HTMLButtonElement>('.shift-open-file-item')?.click();

    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('ignores blank names and missing sidebar markup', () => {
    document.body.innerHTML = '';
    setWorkspaceFiles([{ name: '   ' }, { name: 'kept.pdf' }]);

    expect(getWorkspaceFiles()).toMatchObject([
      { name: 'kept.pdf', size: 0, source: 'upload' },
    ]);
    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
  });

  it('infers open files from the in-page file list', async () => {
    mountShell();
    initWorkspaceFileIndicator();

    const area = document.getElementById('file-display-area');
    const row = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'truncate';
    name.textContent = 'from-display.pdf';
    row.appendChild(name);
    area?.appendChild(row);

    await vi.waitFor(() => {
      expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
        'from-display.pdf',
      ]);
    });
  });

  it('keeps explicitly set merge files when the sidebar initializes', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'merged.pdf' }]);
    initWorkspaceFileIndicator();

    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'merged.pdf',
    ]);
    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
  });

  it('does not clear merge files when the simple file list stays empty', async () => {
    mountShell();
    setWorkspaceFiles([{ name: 'merged.pdf' }]);
    document
      .getElementById('file-list')
      ?.appendChild(document.createElement('li'));
    initWorkspaceFileIndicator();

    document
      .getElementById('file-display-area')
      ?.appendChild(document.createElement('span'));

    await Promise.resolve();
    await Promise.resolve();

    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'merged.pdf',
    ]);
  });

  it('clears inferred files when the in-page list is emptied', async () => {
    mountShell();
    initWorkspaceFileIndicator();

    const area = document.getElementById('file-display-area');
    const name = document.createElement('div');
    name.className = 'truncate';
    name.textContent = 'temp.pdf';
    area?.appendChild(name);

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toHaveLength(1);
    });

    area?.replaceChildren();

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toEqual([]);
      expect(document.body.classList.contains('shift-has-open-file')).toBe(
        false
      );
    });
  });

  it('uses a handoff icon for files received from Shift', () => {
    mountShell();
    setWorkspaceFiles([
      { name: 'from-tab.pdf', size: 1024, source: 'handoff' },
    ]);

    const button = document.querySelector('.shift-open-file-item');
    expect(button?.getAttribute('data-source')).toBe('handoff');
    expect(button?.hasAttribute('title')).toBe(false);
    expect(button?.getAttribute('data-shift-tooltip')).toBe(
      'Received from Shift. Click to replace this PDF.'
    );
    expect(button?.getAttribute('aria-label')).toBe(
      'from-tab.pdf. Received from Shift. Click to replace this PDF.'
    );
    expect(
      button?.querySelector('.shift-open-file-icon-handoff')
    ).not.toBeNull();
    expect(getWorkspaceFiles()[0]).toMatchObject({
      source: 'handoff',
    });
  });

  it('tags a Shift-handoff File as a handoff source', () => {
    mountShell();
    const file = new File([new Uint8Array([1, 2, 3])], 'from-tab.pdf', {
      type: 'application/pdf',
    });
    markFileFromHandoff(file);
    setWorkspaceFiles([file]);

    const button = document.querySelector('.shift-open-file-item');
    expect(button?.getAttribute('data-source')).toBe('handoff');
    expect(button?.getAttribute('data-shift-tooltip')).toBe(
      'Received from Shift. Click to replace this PDF.'
    );
    expect(getWorkspaceFiles()[0]).toMatchObject({
      name: 'from-tab.pdf',
      source: 'handoff',
    });
  });

  it('keeps the Shift origin when the file-input clones the File', () => {
    mountShell();
    const original = new File([new Uint8Array([1, 2, 3])], 'from-tab.pdf', {
      type: 'application/pdf',
    });
    markFileFromHandoff(original);
    const clone = new File([original], original.name, { type: original.type });
    copyFileOrigin(original, clone);
    setWorkspaceFiles([clone]);

    expect(getWorkspaceFiles()[0]).toMatchObject({
      name: 'from-tab.pdf',
      source: 'handoff',
    });
  });

  it('keeps the Shift origin on a decrypted File copy', () => {
    mountShell();
    const original = new File([new Uint8Array([1, 2, 3])], 'locked.pdf', {
      type: 'application/pdf',
    });
    markFileFromHandoff(original);
    const decrypted = new File([new Uint8Array([4, 5, 6])], original.name, {
      type: original.type,
    });
    copyFileOrigin(original, decrypted);
    setWorkspaceFiles([decrypted]);

    expect(getWorkspaceFiles()[0]).toMatchObject({
      name: 'locked.pdf',
      source: 'handoff',
    });
  });

  it('opens the file picker when a handoff file is clicked', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    document.querySelector<HTMLButtonElement>('.shift-open-file-item')?.click();

    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('opens the active tool picker instead of the home picker', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden></section>
      <input id="file-input" type="file" accept="application/pdf" />
      <div id="tool-interface">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <section id="shift-open-files" hidden>
        <div id="shift-open-files-list"></div>
      </section>
    `;
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);
    const inputs = document.querySelectorAll<HTMLInputElement>('#file-input');
    const homeClick = vi.spyOn(inputs[0], 'click').mockImplementation(() => {});
    const toolClick = vi.spyOn(inputs[1], 'click').mockImplementation(() => {});

    document.querySelector<HTMLButtonElement>('.shift-open-file-item')?.click();

    expect(homeClick).not.toHaveBeenCalled();
    expect(toolClick).toHaveBeenCalledOnce();
  });

  it('keeps the handoff source when the in-page list refreshes the same name', async () => {
    mountShell();
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);
    initWorkspaceFileIndicator();

    const area = document.getElementById('file-display-area');
    const name = document.createElement('div');
    name.className = 'truncate';
    name.textContent = 'from-tab.pdf';
    area?.appendChild(name);

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()[0]).toMatchObject({
        name: 'from-tab.pdf',
        source: 'handoff',
      });
    });
  });

  it('preserves addedAt when the same file is set again', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'kept.pdf', addedAt: 1_000 }]);
    setWorkspaceFiles([{ name: 'kept.pdf', size: 2048 }]);

    expect(getWorkspaceFiles()[0]).toMatchObject({
      name: 'kept.pdf',
      size: 2048,
      addedAt: 1_000,
    });
  });

  it('hides the home Open file section when the workspace is empty', () => {
    document.body.innerHTML = `
      <div id="drop-zone"></div>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table>
          <tbody id="shift-my-pdfs-body"></tbody>
        </table>
      </section>
    `;
    setWorkspaceFiles([]);

    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(true);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(document.querySelector('#shift-my-pdfs-body tr')).toBeNull();
  });

  it('renders the home Open file table from the current workspace files', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table>
          <tbody id="shift-my-pdfs-body"></tbody>
        </table>
      </section>
    `;
    setWorkspaceFiles([
      { name: 'upload.pdf', size: 512 },
      {
        name: 'briefing.pdf',
        size: 113 * 1024,
        source: 'handoff',
        addedAt: Date.UTC(2026, 7, 26),
      },
    ]);

    const section = document.getElementById('shift-my-pdfs');
    const heading = document.getElementById('shift-my-pdfs-heading');
    const rows = document.querySelectorAll('#shift-my-pdfs-body tr');
    const cells = rows[0]?.querySelectorAll('td');

    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
    expect(section?.hidden).toBe(false);
    expect(heading?.textContent).toBe('Active file');
    expect(rows).toHaveLength(1);
    expect(cells?.[0]?.textContent).toContain('upload.pdf');
    expect(cells?.[2]?.textContent).toBe('512 B');
  });

  it('shows an uploaded file in the home Open file section', () => {
    document.body.innerHTML = `
      <div id="drop-zone"></div>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table>
          <tbody id="shift-my-pdfs-body"></tbody>
        </table>
      </section>
    `;
    setWorkspaceFiles([{ name: 'dropped.pdf', size: 2048 }]);

    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('dropped.pdf');
  });

  it('keeps uploaded files out of the home sidebar Open file list', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
      </section>
    `;
    setWorkspaceFiles([
      { name: 'upload.pdf', size: 512 },
      { name: 'from-tab.pdf', source: 'handoff' },
    ]);

    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(
      document.querySelector('.shift-open-file-item')?.textContent
    ).toContain('from-tab.pdf');
    expect(document.querySelectorAll('.shift-open-file-item')).toHaveLength(1);
    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.querySelectorAll('#shift-my-pdfs-body tr')).toHaveLength(1);
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('upload.pdf');
  });

  it('does not open the file picker from an uploaded home-table row', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
      </section>
      <input id="file-input" type="file" />
    `;
    setWorkspaceFiles([{ name: 'upload.pdf', size: 512 }]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    document
      .querySelector<HTMLTableRowElement>('#shift-my-pdfs-body tr')
      ?.click();

    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('does not make a handed-off home-table row interactive', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
      </section>
    `;
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);

    expect(
      document
        .querySelector<HTMLTableRowElement>('#shift-my-pdfs-body tr')
        ?.classList.contains('is-revealable')
    ).toBe(false);
  });

  it('uses a custom tooltip and replacement picker for a handoff thumbnail', () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" />
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const pickerClick = vi.spyOn(input, 'click').mockImplementation(() => {});
    const thumbnail = document.querySelector<HTMLButtonElement>(
      '.shift-open-file-thumb'
    );

    expect(thumbnail?.getAttribute('data-shift-tooltip')).toBe(
      'Received from Shift. Click to replace this PDF.'
    );
    thumbnail?.click();
    expect(pickerClick).toHaveBeenCalledOnce();
    pickerClick.mockRestore();
  });

  it('uses thumbnail view by default and can switch to the list', async () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" />
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <button id="shift-open-file-view-list" data-view="list" aria-pressed="false"></button>
        <button id="shift-open-file-view-thumbnail" data-view="thumbnail" aria-pressed="true"></button>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const pdf = new File(['%PDF-1.4'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    setWorkspaceFiles([pdf]);
    initWorkspaceFileIndicator();

    expect(getHomeOpenFileView()).toBe('thumbnail');
    expect(document.getElementById('shift-my-pdfs')?.dataset.view).toBe(
      'thumbnail'
    );
    expect(
      document.querySelector('.shift-open-file-thumb-name')?.textContent
    ).toBe('briefing.pdf');
    expect(
      document.querySelector('.shift-open-file-thumb-replace')?.textContent
    ).toBe('Click to upload');
    expect(
      document.querySelector('.shift-open-file-thumb')?.hasAttribute('title')
    ).toBe(false);
    expect(
      document
        .querySelector('.shift-open-file-thumb')
        ?.getAttribute('aria-label')
    ).toBe('Click to upload briefing.pdf');

    const picker = document.getElementById('file-input') as HTMLInputElement;
    const pickerClick = vi.spyOn(picker, 'click');
    document
      .querySelector<HTMLButtonElement>('.shift-open-file-thumb')
      ?.click();
    expect(pickerClick).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(renderPdfFirstPage).toHaveBeenCalled();
    });

    document.getElementById('shift-open-file-view-list')?.click();

    expect(getHomeOpenFileView()).toBe('list');
    expect(document.getElementById('shift-my-pdfs')?.dataset.view).toBe('list');
    expect(
      document
        .getElementById('shift-open-file-view-list')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('clears persisted files when the workspace is emptied', async () => {
    mountShell();
    const file = new File(['pdf'], 'briefing.pdf', { type: 'application/pdf' });
    setWorkspaceFiles([file]);
    setWorkspaceFiles([]);

    await vi.waitFor(async () => {
      expect(hasOpenFileFlag()).toBe(false);
      expect(await readPersistedOpenFile()).toBeNull();
    });
  });
});
