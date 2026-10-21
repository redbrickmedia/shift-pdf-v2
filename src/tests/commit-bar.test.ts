import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categories } from '../js/config/tools';
import {
  initToolOutputToolbar,
  registerToolOutputSession,
  syncToolOutputToolbar,
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_OVERWRITE_ID,
  TOOL_OUTPUT_PRINT_ID,
  TOOL_OUTPUT_RESET_ID,
  TOOL_OUTPUT_SAVE_ID,
} from '../js/logic/tool-output-toolbar';
import {
  COMMIT_BAR_ID,
  NON_PDF_OUTPUT_SURFACE_IDS,
  STATEFUL_UNDO_REDO_SURFACE_IDS,
  VIEWER_CHROME_HEADER_CLASS,
  isViewerChromeFeatureOn,
} from '../js/logic/viewer-chrome';
import { clearLatestPdfOutput } from '../js/logic/shift-pdf-save';

const COMMIT_IDS = [
  TOOL_OUTPUT_RESET_ID,
  TOOL_OUTPUT_OVERWRITE_ID,
  TOOL_OUTPUT_SAVE_ID,
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_PRINT_ID,
];

const entries = categories.flatMap((category) => category.tools);
const surfaces = [...new Set(entries.map((entry) => entry.surface))].sort();

function mountSurface(surfaceId: string, entryId: string): void {
  document.documentElement.dataset.launchSurface = surfaceId;
  document.documentElement.dataset.launchEntry = entryId;
  document.body.innerHTML = `
    <div id="uploader">
      <div id="tool-uploader">
        <h1>Tool</h1>
        <button id="process-btn" type="button">Process</button>
      </div>
    </div>
  `;
  initToolOutputToolbar();
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-launch-surface');
  document.documentElement.removeAttribute('data-launch-entry');
  document.documentElement.removeAttribute('data-launch-context-applied');
  window.history.replaceState({}, '', '/');
  document.body.className = '';
});

afterEach(() => {
  clearLatestPdfOutput();
  document.documentElement.removeAttribute('data-launch-surface');
  document.documentElement.removeAttribute('data-launch-entry');
  document.body.innerHTML = '';
});

describe('Commit Bar action matrix (#55) across every Tool Surface', () => {
  it('walks every Catalog Entry and its Tool Surface', () => {
    expect(entries.length).toBeGreaterThan(surfaces.length);
    expect(surfaces).toContain('compress-pdf');
    expect(surfaces).toContain('pdf-converter');
  });

  describe.each(entries.map((entry) => [entry.id, entry.surface]))(
    'entry %s on surface %s',
    (entryId, surfaceId) => {
      it('keeps commit actions out of the header and in the bar under the card', () => {
        mountSurface(surfaceId, entryId);
        const header = document.querySelector(`.${VIEWER_CHROME_HEADER_CLASS}`);
        const bar = document.getElementById(COMMIT_BAR_ID);
        const card = document.getElementById('tool-uploader');

        expect(header).toBeTruthy();
        expect(bar?.previousElementSibling).toBe(card);
        for (const id of COMMIT_IDS) {
          expect(header?.contains(document.getElementById(id))).toBe(false);
          expect(bar?.contains(document.getElementById(id))).toBe(true);
        }
      });

      it('shows exactly the actions the matrix allows', () => {
        mountSurface(surfaceId, entryId);
        const bar = document.getElementById(COMMIT_BAR_ID) as HTMLElement;
        const header = document.querySelector(
          `.${VIEWER_CHROME_HEADER_CLASS}`
        ) as HTMLElement;
        const nonPdf =
          NON_PDF_OUTPUT_SURFACE_IDS.has(surfaceId) ||
          NON_PDF_OUTPUT_SURFACE_IDS.has(entryId);

        expect(isViewerChromeFeatureOn(bar, 'reset')).toBe(true);
        expect(isViewerChromeFeatureOn(bar, 'download')).toBe(true);
        expect(isViewerChromeFeatureOn(bar, 'save')).toBe(!nonPdf);
        expect(isViewerChromeFeatureOn(bar, 'print')).toBe(!nonPdf);
        expect(isViewerChromeFeatureOn(header, 'undo')).toBe(
          STATEFUL_UNDO_REDO_SURFACE_IDS.has(surfaceId)
        );
        expect(isViewerChromeFeatureOn(header, 'redo')).toBe(
          STATEFUL_UNDO_REDO_SURFACE_IDS.has(surfaceId)
        );
      });
    }
  );
});

describe('Commit Bar behaviour', () => {
  it('stays hidden on the empty state and appears once there is a job', () => {
    mountSurface('compress-pdf', 'compress-pdf');
    document.getElementById('process-btn')!.setAttribute('disabled', '');
    syncToolOutputToolbar();
    const bar = document.getElementById(COMMIT_BAR_ID) as HTMLElement;
    expect(bar.hidden).toBe(true);

    let ready = false;
    const unregister = registerToolOutputSession({
      canSave: () => ready,
      canReset: () => ready,
    });
    expect(bar.hidden).toBe(true);

    ready = true;
    syncToolOutputToolbar();
    expect(bar.hidden).toBe(false);
    unregister();
  });

  it('treats a process button in a panel the page still hides as no job', () => {
    document.body.innerHTML = `
      <div id="uploader">
        <div id="tool-uploader">
          <h1>Compress PDF</h1>
          <div id="compress-options" class="hidden">
            <button id="process-btn" type="button">Compress</button>
          </div>
        </div>
      </div>
    `;
    initToolOutputToolbar();
    const bar = document.getElementById(COMMIT_BAR_ID) as HTMLElement;
    expect(bar.hidden).toBe(true);

    document.getElementById('compress-options')!.classList.remove('hidden');
    syncToolOutputToolbar();

    expect(bar.hidden).toBe(false);
    expect(
      (document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it('names the primary action from the Output Session and falls back to Download', () => {
    mountSurface('compress-pdf', 'compress-pdf');
    const download = document.getElementById(
      TOOL_OUTPUT_DOWNLOAD_ID
    ) as HTMLButtonElement;
    expect(download.textContent).toBe('Download');

    const unregister = registerToolOutputSession({
      primaryLabel: () => 'Compress',
    });
    expect(download.textContent).toBe('Compress');
    expect(download.getAttribute('aria-label')).toBe('Compress');

    unregister();
    expect(download.textContent).toBe('Download');
    expect(download.getAttribute('aria-label')).toBe('Download');
  });

  it('keeps the bar as the last child of its host as the page grows', () => {
    mountSurface('compress-pdf', 'compress-pdf');
    const host = document.getElementById('uploader') as HTMLElement;
    const late = document.createElement('section');
    host.append(late);

    initToolOutputToolbar();
    syncToolOutputToolbar();

    expect(host.lastElementChild?.id).toBe(COMMIT_BAR_ID);
  });
});
