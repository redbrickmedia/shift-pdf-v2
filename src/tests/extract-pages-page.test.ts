import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPdfLibrary } from '../js/logic/pdf-library-store';
import { state } from '../js/state';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';

const { loadPdfWithPasswordPrompt } = vi.hoisted(() => ({
  loadPdfWithPasswordPrompt: vi.fn(),
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt,
}));

vi.mock('../js/utils/load-pdf-document.js', () => ({
  loadPdfDocument: vi.fn(async () => ({
    getPageCount: () => 2,
  })),
}));

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

vi.mock('../js/ui.js', () => ({
  showAlert: vi.fn(),
  showLoader: vi.fn(),
  hideLoader: vi.fn(),
}));

afterEach(async () => {
  state.files = [];
  resetToolFilesSeededState();
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  document.documentElement.removeAttribute('data-launch-entry');
  document.documentElement.removeAttribute('data-launch-surface');
  document.documentElement.removeAttribute('data-launch-context-applied');
  window.history.replaceState({}, '', '/');
  vi.resetModules();
});

describe('extract pages Launch Context on split-pdf.html', () => {
  beforeEach(() => {
    state.files = [];
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    loadPdfWithPasswordPrompt.mockResolvedValue({
      file: new File(['pdf'], 'saved.pdf', { type: 'application/pdf' }),
      bytes: new Uint8Array([1, 2, 3]).buffer,
      pdf: { destroy: vi.fn() },
    });
  });

  it('pre-selects Visual Page Selector and Single combined PDF when split-pdf.html is launched with ?entry=extract-pages, preserves ?entry on mode change, and restores Launch Context defaults on reset', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { initToolOutputToolbar, TOOL_OUTPUT_RESET_ID } =
      await import('../js/logic/tool-output-toolbar');

    const html = readFileSync(
      resolve(process.cwd(), 'src/pages/split-pdf.html'),
      'utf8'
    );
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    document.body.innerHTML = (bodyMatch?.[1] ?? '')
      .replace(/\{\{>\s*navbar\s*\}\}/g, '')
      .replace(/\{\{>\s*footer\s*\}\}/g, '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '');

    window.history.replaceState({}, '', '/split-pdf.html?entry=extract-pages');
    document.title = 'Split PDF | Shift PDF';

    initToolOutputToolbar();
    await import('../js/logic/split-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const splitMode = document.getElementById(
      'split-mode'
    ) as HTMLSelectElement;
    const combineRadio = document.getElementById(
      'output-combine'
    ) as HTMLInputElement;
    const separateRadio = document.getElementById(
      'output-separate'
    ) as HTMLInputElement;

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Extract Pages');
    expect(document.title).toBe('Extract Pages | Shift PDF');
    expect(splitMode.value).toBe('visual');
    expect(combineRadio.checked).toBe(true);
    expect(separateRadio.disabled).toBe(false);
    expect(
      document
        .getElementById('visual-select-panel')
        ?.classList.contains('hidden')
    ).toBe(false);
    expect(
      document.getElementById('range-panel')?.classList.contains('hidden')
    ).toBe(true);
    expect(Array.from(splitMode.options).map((o) => o.value)).toEqual([
      'range',
      'even-odd',
      'all',
      'visual',
      'bookmarks',
      'n-times',
    ]);

    // Switching split modes does NOT overwrite ?entry=extract-pages
    splitMode.value = 'even-odd';
    splitMode.dispatchEvent(new Event('change'));
    expect(window.location.search).toBe('?entry=extract-pages');
    expect(
      document.getElementById('even-odd-panel')?.classList.contains('hidden')
    ).toBe(false);

    // Resetting restores visual + combine for ?entry=extract-pages
    separateRadio.checked = true;
    combineRadio.checked = false;
    (
      document.getElementById(TOOL_OUTPUT_RESET_ID) as HTMLButtonElement
    )?.click();

    await vi.waitFor(() => {
      expect(splitMode.value).toBe('visual');
      expect(combineRadio.checked).toBe(true);
    });
  });
});
