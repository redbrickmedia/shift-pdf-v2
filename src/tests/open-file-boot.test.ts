import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HAS_OPEN_FILE_BODY_CLASS,
  OPEN_FILE_FLAG_KEY,
  OPEN_FILE_IN_TOOL_CLASS,
  OPEN_FILE_PENDING_CLASS,
  OPEN_FILE_SKELETON_ATTR,
  OPEN_FILE_SNAPSHOT_KEY,
  REVEALED_PANEL_ATTR,
  applyOpenFileFlagClasses,
  clearPersistedOpenFile,
  hasOpenFileFlag,
  hasOpenFileSkeleton,
  markOpenFilePresent,
  readOpenFileSnapshot,
  removeOpenFileSkeleton,
  retireOpenFileSkeleton,
  writeOpenFileSnapshot,
  writePersistedOpenFile,
} from '../js/logic/open-file-store';
import {
  applyFilesToToolInput,
  seedToolOpenFile,
} from '../js/logic/seed-tool-open-file';
import { state } from '../js/state';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';

const BOOT_SCRIPT = readFileSync(
  resolve(__dirname, '../../public/sidebar-boot.js'),
  'utf8'
);

/** Run sidebar-boot.js the way the browser does: synchronously, from <head>. */
function runBootScript(): void {
  new Function(BOOT_SCRIPT)();
}

const TOOL_PAGE_DOM = `
  <div id="tool-uploader">
    <div id="drop-zone"></div>
    <input id="file-input" type="file" accept="application/pdf" multiple />
    <div id="file-display-area"></div>
    <div id="tool-options" class="hidden mt-6">
      <div id="custom-settings-panel" class="hidden"></div>
    </div>
    <div id="completion-panel" class="hidden"></div>
  </div>
`;

afterEach(async () => {
  document.documentElement.className = '';
  document.body.className = '';
  document.body.innerHTML = '';
  state.files = [];
  removeOpenFileSkeleton();
  resetToolFilesSeededState();
  resetWorkspaceFileIndicator();
  sessionStorage.clear();
  await clearPersistedOpenFile();
  vi.restoreAllMocks();
});

describe('applyOpenFileFlagClasses', () => {
  it('does not hide the drop zone when the open-file flag is unset', () => {
    document.body.innerHTML = `
      <div id="drop-zone"></div>
      <input id="file-input" type="file" accept="application/pdf" />
    `;

    expect(applyOpenFileFlagClasses(document, { acceptsPdf: true })).toBe(
      false
    );
    expect(document.body.classList.contains(OPEN_FILE_IN_TOOL_CLASS)).toBe(
      false
    );
  });

  it('adds shift-open-file-in-tool before blobs hydrate when the flag is set', () => {
    markOpenFilePresent(true);
    document.body.innerHTML = `
      <div id="tool-uploader">
        <div id="drop-zone"></div>
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
    `;

    expect(hasOpenFileFlag()).toBe(true);
    expect(applyOpenFileFlagClasses(document, { acceptsPdf: true })).toBe(true);
    expect(document.body.classList.contains(OPEN_FILE_IN_TOOL_CLASS)).toBe(
      true
    );
    expect(
      document.documentElement.classList.contains(OPEN_FILE_PENDING_CLASS)
    ).toBe(false);
  });

  it('keeps the drop zone on home / My PDFs even when the flag is set', () => {
    markOpenFilePresent(true);
    document.body.className = 'shift-home';
    document.body.innerHTML = `<div id="drop-zone"></div>`;

    expect(
      applyOpenFileFlagClasses(document, { acceptsPdf: true, isHome: true })
    ).toBe(false);
    expect(document.body.classList.contains(OPEN_FILE_IN_TOOL_CLASS)).toBe(
      false
    );
  });

  it('does not hide non-PDF tool drop zones', () => {
    markOpenFilePresent(true);
    document.body.innerHTML = `
      <div id="drop-zone"></div>
      <input id="file-input" type="file" accept="image/png,.png" />
    `;

    expect(applyOpenFileFlagClasses(document, { acceptsPdf: false })).toBe(
      true
    );
    expect(document.body.classList.contains(OPEN_FILE_IN_TOOL_CLASS)).toBe(
      false
    );
  });
});

describe('sidebar-boot open-file pre-paint', () => {
  it('sets the pending class from sessionStorage before body exists', () => {
    sessionStorage.setItem(OPEN_FILE_FLAG_KEY, '1');
    document.documentElement.className = '';

    runBootScript();

    expect(
      document.documentElement.classList.contains(OPEN_FILE_PENDING_CLASS)
    ).toBe(true);
  });

  it('promotes pending to body.shift-open-file-in-tool once file-input exists', async () => {
    sessionStorage.setItem(OPEN_FILE_FLAG_KEY, '1');

    runBootScript();
    expect(
      document.documentElement.classList.contains(OPEN_FILE_PENDING_CLASS)
    ).toBe(true);

    document.body.innerHTML = TOOL_PAGE_DOM;

    await vi.waitFor(() => {
      expect(document.body.classList.contains(OPEN_FILE_IN_TOOL_CLASS)).toBe(
        true
      );
    });
    expect(
      document.documentElement.classList.contains(OPEN_FILE_PENDING_CLASS)
    ).toBe(false);
  });
});

describe('first painted frame is never an empty card', () => {
  it('paints a skeleton row with the real filename when the flag is set', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;

    await vi.waitFor(() => {
      expect(hasOpenFileSkeleton()).toBe(true);
    });

    const area = document.getElementById('file-display-area');
    expect(area?.children).toHaveLength(1);
    expect(area?.textContent).toContain('briefing.pdf');
    expect(area?.textContent).toContain('2.0 KB');
    expect(area?.firstElementChild?.hasAttribute(OPEN_FILE_SKELETON_ATTR)).toBe(
      true
    );
  });

  it('reserves one row per snapshot entry for multi-file tools', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([
      { name: 'first.pdf', size: 1024 },
      { name: 'second.pdf', size: 4096 },
    ]);

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;

    await vi.waitFor(() => {
      expect(
        document.querySelectorAll(`[${OPEN_FILE_SKELETON_ATTR}]`)
      ).toHaveLength(2);
    });
  });

  it('does not paint a skeleton when no open file is flagged', async () => {
    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;

    await Promise.resolve();
    expect(hasOpenFileSkeleton()).toBe(false);
    expect(document.getElementById('file-display-area')?.children).toHaveLength(
      0
    );
  });

  it('does not paint a skeleton on home / My PDFs', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = `
      <section id="shift-my-pdfs"></section>
      <div id="drop-zone"></div>
      <input id="file-input" type="file" accept="application/pdf" />
      <div id="file-display-area"></div>
    `;

    await Promise.resolve();
    expect(hasOpenFileSkeleton()).toBe(false);
    expect(document.body.classList.contains(OPEN_FILE_IN_TOOL_CLASS)).toBe(
      false
    );
  });

  it('removes the skeleton once the real files are applied', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;
    await vi.waitFor(() => expect(hasOpenFileSkeleton()).toBe(true));

    const area = document.getElementById('file-display-area');
    // Stand in for the tool's own row, rendered from the seeded blob.
    document.addEventListener('shift:tool-files-seeded', () => {
      const row = document.createElement('div');
      row.className = 'truncate';
      row.textContent = 'briefing.pdf';
      area?.replaceChildren(row);
    });

    applyFilesToToolInput([
      new File(['%PDF'], 'briefing.pdf', { type: 'application/pdf' }),
    ]);

    expect(hasOpenFileSkeleton()).toBe(false);
    expect(area?.children).toHaveLength(1);
  });

  it('keeps the skeleton until an async tool paints its own row', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;
    await vi.waitFor(() => expect(hasOpenFileSkeleton()).toBe(true));

    applyFilesToToolInput([
      new File(['%PDF'], 'briefing.pdf', { type: 'application/pdf' }),
    ]);

    // Crop-style tools load the PDF first, so nothing is rendered yet.
    expect(hasOpenFileSkeleton()).toBe(true);

    const area = document.getElementById('file-display-area');
    const row = document.createElement('div');
    row.className = 'truncate';
    row.textContent = 'briefing.pdf';
    area?.appendChild(row);

    await vi.waitFor(() => expect(hasOpenFileSkeleton()).toBe(false));
    expect(area?.children).toHaveLength(1);
  });

  it('retires a stranded skeleton when the tool never renders a row', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;
    await vi.waitFor(() => expect(hasOpenFileSkeleton()).toBe(true));

    retireOpenFileSkeleton(document, { timeoutMs: 0 });

    await vi.waitFor(() => expect(hasOpenFileSkeleton()).toBe(false));
  });

  it('unhides the tool options panel before any blob arrives', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;

    const panel = document.getElementById('tool-options');
    await vi.waitFor(() => {
      expect(panel?.classList.contains('hidden')).toBe(false);
    });
    expect(panel?.hasAttribute(REVEALED_PANEL_ATTR)).toBe(true);

    // Nested groups are switched by the tool's own radios, and the result
    // panel belongs to a job the user has not run yet.
    expect(
      document.getElementById('custom-settings-panel')?.classList
    ).toContain('hidden');
    expect(document.getElementById('completion-panel')?.classList).toContain(
      'hidden'
    );
  });

  it('leaves the options panel hidden when no open file is flagged', async () => {
    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;

    await Promise.resolve();
    expect(
      document.getElementById('tool-options')?.classList.contains('hidden')
    ).toBe(true);
  });

  it('does not reveal panels on a tool that cannot use the file', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = `
      <div id="tool-uploader">
        <div id="drop-zone"></div>
        <input id="file-input" type="file" accept="image/png,.png" />
        <div id="file-display-area"></div>
        <div id="tool-options" class="hidden"></div>
      </div>
    `;

    await vi.waitFor(() => {
      expect(document.body.classList.contains(HAS_OPEN_FILE_BODY_CLASS)).toBe(
        true
      );
    });
    // Revealing #file-controls here would hide the picker and strand the card.
    expect(
      document.getElementById('tool-options')?.classList.contains('hidden')
    ).toBe(true);
  });

  it('keeps the panel up when a tool module hides it mid-seed', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);
    await writePersistedOpenFile(
      new File(['%PDF'], 'briefing.pdf', { type: 'application/pdf' }),
      { source: 'upload' }
    );

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;

    const panel = document.getElementById('tool-options');
    await vi.waitFor(() =>
      expect(panel?.classList.contains('hidden')).toBe(false)
    );

    const seeding = seedToolOpenFile();
    // A page module initialises on its own DOMContentLoaded handler and hides
    // its panel, because as far as it knows no file has arrived.
    panel?.classList.add('hidden');
    await seeding;

    await vi.waitFor(() =>
      expect(panel?.classList.contains('hidden')).toBe(false)
    );
  });

  it('hands the revealed panel to the tool once files land', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;

    const panel = document.getElementById('tool-options');
    await vi.waitFor(() =>
      expect(panel?.hasAttribute(REVEALED_PANEL_ATTR)).toBe(true)
    );

    applyFilesToToolInput([
      new File(['%PDF'], 'briefing.pdf', { type: 'application/pdf' }),
    ]);

    expect(panel?.classList.contains('hidden')).toBe(false);
    expect(panel?.hasAttribute(REVEALED_PANEL_ATTR)).toBe(false);
  });

  it('re-hides the revealed panel when the seed turns up no files', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;

    const panel = document.getElementById('tool-options');
    await vi.waitFor(() =>
      expect(panel?.classList.contains('hidden')).toBe(false)
    );

    await clearPersistedOpenFile();
    await seedToolOpenFile();

    expect(panel?.classList.contains('hidden')).toBe(true);
    expect(panel?.hasAttribute(REVEALED_PANEL_ATTR)).toBe(false);
  });

  it('restores the drop zone when the seed turns up no files', async () => {
    markOpenFilePresent(true);
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);

    runBootScript();
    document.body.innerHTML = TOOL_PAGE_DOM;
    await vi.waitFor(() => expect(hasOpenFileSkeleton()).toBe(true));
    expect(document.body.classList.contains(OPEN_FILE_IN_TOOL_CLASS)).toBe(
      true
    );

    // The stored blob is gone, so nothing can be applied.
    await clearPersistedOpenFile();
    await seedToolOpenFile();

    expect(hasOpenFileSkeleton()).toBe(false);
    expect(document.body.classList.contains(OPEN_FILE_IN_TOOL_CLASS)).toBe(
      false
    );
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });
});

describe('open file snapshot', () => {
  it('round-trips names and sizes through sessionStorage', () => {
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);
    expect(readOpenFileSnapshot()).toEqual([
      { name: 'briefing.pdf', size: 2048 },
    ]);
  });

  it('ignores a corrupt snapshot instead of throwing', () => {
    sessionStorage.setItem(OPEN_FILE_SNAPSHOT_KEY, '{not json');
    expect(readOpenFileSnapshot()).toEqual([]);
  });

  it('is cleared when the persisted open file is cleared', async () => {
    writeOpenFileSnapshot([{ name: 'briefing.pdf', size: 2048 }]);
    await clearPersistedOpenFile();
    expect(readOpenFileSnapshot()).toEqual([]);
  });
});
