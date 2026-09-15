import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adoptViewerIntoCard,
  initToolViewerLayout,
  isViewerActive,
  isViewerPending,
  isViewerToolDocument,
  MULTI_FILE_VIEWER_ROOT_IDS,
  PENDING_VIEWER_ROOT_IDS,
  resetToolViewerLayout,
  syncToolViewerLayout,
  TOOL_VIEWER_ACTIONS_ATTR,
  TOOL_VIEWER_BAR_CLASS,
  TOOL_VIEWER_BODY_CLASS,
  TOOL_VIEWER_CAPABLE_CLASS,
  TOOL_VIEWER_PENDING_CLASS,
  TOOL_VIEWER_SCROLL_HOST_CLASS,
  TOOL_VIEWER_SLOT_ATTR,
  TOOL_VIEWER_SUPPRESS_CLASS,
  TOOL_VIEWER_TITLE_CLASS,
  VIEWER_DOWNLOAD_BUTTON_IDS,
  VIEWER_ROOT_IDS,
} from '../js/logic/tool-viewer-layout';
import { OPEN_FILE_FLAG_KEY } from '../js/logic/open-file-store';

const OPEN_FILE_IN_TOOL_CLASS = 'shift-open-file-in-tool';

const BOOT_SCRIPT = readFileSync(
  resolve(process.cwd(), 'public/sidebar-boot.js'),
  'utf8'
);

function readTheme(): string {
  return readFileSync(
    resolve(process.cwd(), 'src/css/shift-theme.css'),
    'utf8'
  );
}

/** Run sidebar-boot.js the way the browser does: synchronously, from <head>. */
function runBootScript(): void {
  new Function(BOOT_SCRIPT)();
}

/** Observable hide: attribute or the class syncToolViewerLayout applies. */
function isUploadChromeSuppressed(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.hasAttribute('hidden') ||
    el.classList.contains(TOOL_VIEWER_SUPPRESS_CLASS)
  );
}

function mountSignLikeShell() {
  document.body.innerHTML = `
    <div id="uploader" class="min-h-screen">
      <div id="tool-uploader">
        <h1>Sign PDF</h1>
        <p class="subtitle">Add a signature to your PDF.</p>
        <div id="drop-zone">
          <input id="file-input" type="file" accept="application/pdf" />
        </div>
        <div id="file-display-area"></div>
      </div>
      <div id="signature-editor" class="hidden">
        <div id="canvas-container-sign"></div>
        <button id="process-btn" type="button" class="btn-gradient w-full mt-4">
          Download Signed PDF
        </button>
      </div>
    </div>
  `;
}

function mountMergeLikeShell() {
  document.body.innerHTML = `
    <div id="uploader">
      <div id="tool-uploader">
        <h1>Merge PDF</h1>
        <div id="drop-zone">
          <input id="file-input" type="file" accept="application/pdf" multiple />
        </div>
        <div id="file-display-area"></div>
        <button id="process-btn" type="button">Merge</button>
      </div>
    </div>
  `;
}

afterEach(() => {
  resetToolViewerLayout();
  vi.useRealTimers();
  document.documentElement.className = '';
  document.body.className = '';
  document.body.innerHTML = '';
  sessionStorage.clear();
});

describe('tool viewer layout', () => {
  it('recognizes viewer tools and ignores non-viewer tools', () => {
    mountSignLikeShell();
    expect(isViewerToolDocument()).toBe(true);
    expect(isViewerActive()).toBe(false);

    mountMergeLikeShell();
    expect(isViewerToolDocument()).toBe(false);
  });

  it('keeps the empty-state drop zone when no viewer is showing', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    expect(document.body.classList.contains(TOOL_VIEWER_CAPABLE_CLASS)).toBe(
      true
    );
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
    expect(document.getElementById('drop-zone')).not.toBeNull();
    expect(isUploadChromeSuppressed(document.getElementById('drop-zone'))).toBe(
      false
    );
    expect(
      isUploadChromeSuppressed(document.getElementById('file-display-area'))
    ).toBe(false);
    expect(
      document.getElementById('process-btn')?.closest('#signature-editor')
    ).not.toBeNull();
  });

  it('activates full-panel mode and moves Download into the heading bar', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    document.getElementById('signature-editor')?.classList.remove('hidden');
    document.getElementById('file-display-area')!.textContent = 'file.pdf';
    syncToolViewerLayout();

    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);
    expect(isViewerActive()).toBe(true);

    const bar = document.querySelector(`.${TOOL_VIEWER_BAR_CLASS}`);
    const actions = document.querySelector(`[${TOOL_VIEWER_ACTIONS_ATTR}]`);
    const download = document.getElementById('process-btn');

    expect(bar).not.toBeNull();
    expect(bar?.querySelector('h1')?.textContent).toBe('Sign PDF');
    expect(actions?.contains(download)).toBe(true);
    expect(download?.closest('#signature-editor')).toBeNull();
  });

  it('hides drop zone and file chips after the viewer is revealed the page way', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    // Pages reveal viewers by removing `.hidden` (sign-pdf, crop-pdf, etc.).
    document.getElementById('file-display-area')!.innerHTML =
      '<div class="file-chip">sample.pdf</div>';
    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();

    const drop = document.getElementById('drop-zone');
    const chips = document.getElementById('file-display-area');

    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);
    expect(isUploadChromeSuppressed(drop)).toBe(true);
    expect(isUploadChromeSuppressed(chips)).toBe(true);
  });

  it('restores upload chrome when the viewer is hidden again', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();
    expect(isUploadChromeSuppressed(document.getElementById('drop-zone'))).toBe(
      true
    );

    document.getElementById('signature-editor')?.classList.add('hidden');
    syncToolViewerLayout();
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
    expect(isUploadChromeSuppressed(document.getElementById('drop-zone'))).toBe(
      false
    );
    expect(
      isUploadChromeSuppressed(document.getElementById('file-display-area'))
    ).toBe(false);
  });

  it('clears viewer mode when the viewer is hidden again', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);

    document.getElementById('signature-editor')?.classList.add('hidden');
    syncToolViewerLayout();
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
  });

  it('does nothing on non-viewer tool pages', () => {
    mountMergeLikeShell();
    initToolViewerLayout();

    expect(document.body.classList.contains(TOOL_VIEWER_CAPABLE_CLASS)).toBe(
      false
    );
    expect(document.querySelector(`.${TOOL_VIEWER_BAR_CLASS}`)).toBeNull();
    expect(
      document.getElementById('process-btn')?.closest('#tool-uploader')
    ).not.toBeNull();
  });

  it('scopes full-panel CSS to body.shift-tool-viewer', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/css/shift-theme.css'),
      'utf8'
    );

    expect(css).toContain('body.shift-tool-viewer #drop-zone');
    expect(css).toContain('body.shift-tool-viewer #file-display-area');
    expect(css).toContain('.shift-tool-viewer-suppressed');
    expect(css).toContain('.shift-tool-viewer-actions');
    expect(css).toContain(
      'body.shift-tool-viewer:not(.simple-mode):has(#shift-sidebar)'
    );
    expect(css).toContain('> #uploader');
    expect(css).toMatch(/body\.shift-tool-viewer[\s\S]*flex:\s*1 1 auto/);
    expect(css).not.toMatch(
      /body\.shift-home:has\(#shift-my-pdfs\).*shift-tool-viewer/s
    );
  });

  it('marks scroll hosts and kills nested Sign/Form scrollports while viewing', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    const host = document.getElementById('canvas-container-sign');
    expect(host?.classList.contains(TOOL_VIEWER_SCROLL_HOST_CLASS)).toBe(false);

    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();

    expect(host?.classList.contains(TOOL_VIEWER_SCROLL_HOST_CLASS)).toBe(true);
    expect(
      document
        .querySelector(`.${TOOL_VIEWER_BAR_CLASS}`)
        ?.closest('#tool-uploader')
    ).not.toBeNull();
    expect(host?.closest('#signature-editor')).not.toBeNull();

    document.getElementById('signature-editor')?.classList.add('hidden');
    syncToolViewerLayout();
    expect(host?.classList.contains(TOOL_VIEWER_SCROLL_HOST_CLASS)).toBe(false);
  });

  it('scopes scroll containment CSS for viewer hosts and shell panes', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/css/shift-theme.css'),
      'utf8'
    );

    expect(css).toContain('.shift-viewer-scroll-host');
    expect(css).toMatch(
      /body\.shift-tool-viewer[\s\S]*#canvas-container-sign[\s\S]*overflow:\s*hidden\s*!important/
    );
    expect(css).toMatch(
      /body\.shift-tool-viewer[\s\S]*#canvas-container-sign[\s\S]*> iframe/
    );
    expect(css).toMatch(
      /body\.shift-tool-viewer:not\(\.simple-mode\):has\(#shift-sidebar\)\s*\{[^}]*overflow:\s*hidden/
    );
    expect(css).toContain('body.shift-tool-viewer .compare-panel');
    expect(css).toMatch(
      /\.shift-sidebar-content\s*\{[^}]*overscroll-behavior:\s*contain/s
    );
    expect(css).toMatch(
      /body\.shift-home:has\(#tool-grid\) #grid-view\s*\{[^}]*overscroll-behavior:\s*contain/s
    );
    expect(css).toMatch(
      /body\.shift-home:has\(#shift-my-pdfs\) \.shift-my-pdfs-scroll\s*\{[^}]*overscroll-behavior:\s*contain/s
    );
    expect(css).toMatch(
      /\.shift-library-picker-list\s*\{[^}]*overscroll-behavior:\s*contain/s
    );
    expect(css).toContain('#main-scroll-container');
    expect(css).toMatch(
      /#main-scroll-container\s*\{[^}]*overscroll-behavior:\s*contain|#main-scroll-container[\s\S]{0,80}overscroll-behavior:\s*contain/
    );
    // Modal / dialog scroll is left alone — no global dialog overflow lock.
    expect(css).not.toMatch(
      /\.dialog[^{]*\{[^}]*overflow:\s*hidden[^}]*overscroll-behavior:\s*none/s
    );
  });
});

/**
 * sign-pdf and crop-pdf author their viewer as a sibling of the card, which
 * left them looking unlike edit-pdf, form-filler, compare and stamps: heading
 * in a card, document loose on the page below it.
 */
describe('viewer inside the tool card', () => {
  it('moves a viewer the page authored outside the card into it', () => {
    mountSignLikeShell();
    const viewer = document.getElementById('signature-editor');
    expect(viewer?.parentElement?.id).toBe('uploader');

    initToolViewerLayout();

    expect(viewer?.parentElement?.id).toBe('tool-uploader');
    // After the heading bar, which the layout keeps first.
    expect(document.getElementById('tool-uploader')?.lastElementChild).toBe(
      viewer
    );
  });

  it('leaves a viewer the page already authored in the card alone', () => {
    document.body.innerHTML = `
      <div id="uploader">
        <div id="tool-uploader">
          <h1>PDF Editor</h1>
          <div id="drop-zone"><input id="file-input" type="file" /></div>
          <div id="embed-pdf-wrapper" class="hidden">
            <div id="embed-pdf-container"></div>
          </div>
        </div>
      </div>
    `;
    const viewer = document.getElementById('embed-pdf-wrapper');
    const before = viewer?.previousElementSibling?.id;

    adoptViewerIntoCard();

    expect(viewer?.parentElement?.id).toBe('tool-uploader');
    expect(viewer?.previousElementSibling?.id).toBe(before);
  });

  it('will not reparent a viewer the tool has already mounted', () => {
    mountSignLikeShell();
    const viewer = document.getElementById('signature-editor');
    // Reparenting an iframe discards its browsing context: the PDF.js viewer
    // would reload and lose the session.
    document
      .getElementById('canvas-container-sign')
      ?.appendChild(document.createElement('iframe'));

    adoptViewerIntoCard();
    expect(viewer?.parentElement?.id).toBe('uploader');

    viewer?.classList.remove('hidden');
    adoptViewerIntoCard();
    expect(viewer?.parentElement?.id).toBe('uploader');
  });

  it('keeps every viewer root in the card-scoped CSS', () => {
    const css = readTheme();
    const cardChildren = css.slice(
      css.indexOf('body.shift-tool-viewer\n  #tool-uploader\n  > :not('),
      css.indexOf('body.shift-tool-viewer #drop-zone,')
    );
    const cardGrowth = css.slice(
      css.indexOf('#tool-uploader:has(\n    #embed-pdf-wrapper:not(.hidden)'),
      css.indexOf('body.shift-tool-viewer #embed-pdf-wrapper:not(.hidden)')
    );

    expect(cardChildren).not.toBe('');
    expect(cardGrowth).not.toBe('');
    for (const id of VIEWER_ROOT_IDS) {
      // Missing from the first list the viewer is display:none inside the card;
      // missing from the second the card stays at its heading height.
      expect(cardChildren).toContain(`#${id}`);
      expect(cardGrowth).toContain(`#${id}:not(.hidden)`);
    }
  });
});

/**
 * Entering a tool with a file already selected used to paint the card first and
 * switch to the viewer a few hundred milliseconds later, once the blob had
 * resolved. The layout now starts where it ends up, with a reserved pane
 * standing in for the viewer.
 */
describe('viewer layout before the file lands', () => {
  it('opens in the viewer layout while the blob is still resolving', () => {
    mountSignLikeShell();
    document.body.classList.add(OPEN_FILE_IN_TOOL_CLASS);
    initToolViewerLayout();

    // The tool has not revealed anything yet — this is the frame that used to
    // show the drop zone and file chips.
    expect(isViewerActive()).toBe(false);
    expect(isViewerPending()).toBe(true);
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);
    expect(document.body.classList.contains(TOOL_VIEWER_PENDING_CLASS)).toBe(
      true
    );
    expect(isUploadChromeSuppressed(document.getElementById('drop-zone'))).toBe(
      true
    );
    expect(
      document.querySelector(`[${TOOL_VIEWER_ACTIONS_ATTR}]`)
    ).not.toBeNull();

    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();

    // Only the reservation ends: the layout class it was standing in for is
    // the one already on the body, so nothing moves on the handover.
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);
    expect(document.body.classList.contains(TOOL_VIEWER_PENDING_CLASS)).toBe(
      false
    );
  });

  it('leaves tools without an open file on their own card', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    expect(isViewerPending()).toBe(false);
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
  });

  it('does not reserve a pane for compare, which needs a file per slot', () => {
    document.body.innerHTML = `
      <div id="uploader">
        <div id="tool-uploader">
          <h1>Compare PDFs</h1>
          <div id="drop-zone-1"></div>
          <div id="drop-zone-2"></div>
          <div id="compare-viewer" class="hidden"></div>
        </div>
      </div>
    `;
    document.body.classList.add(OPEN_FILE_IN_TOOL_CLASS);
    initToolViewerLayout();

    expect(isViewerToolDocument()).toBe(true);
    expect(isViewerPending()).toBe(false);
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
  });

  it('hands the tool back its card when the selection turns out to be gone', () => {
    mountSignLikeShell();
    document.body.classList.add(OPEN_FILE_IN_TOOL_CLASS);
    initToolViewerLayout();

    const download = document.getElementById('process-btn');
    expect(download?.closest(`[${TOOL_VIEWER_ACTIONS_ATTR}]`)).not.toBeNull();

    // What seedToolOpenFile does when the session flag named a file it could
    // not produce (clearOpenFileFlagClasses).
    document.body.classList.remove(OPEN_FILE_IN_TOOL_CLASS);
    syncToolViewerLayout();

    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
    expect(document.body.classList.contains(TOOL_VIEWER_PENDING_CLASS)).toBe(
      false
    );
    expect(isUploadChromeSuppressed(document.getElementById('drop-zone'))).toBe(
      false
    );
    // The actions row is display:none outside the viewer layout, so the button
    // has to go back to where the page authored it.
    expect(download?.closest('#signature-editor')).not.toBeNull();
    expect(document.querySelector(`[${TOOL_VIEWER_SLOT_ATTR}]`)).toBeNull();
  });

  it('gives up on the reservation if no viewer arrives', () => {
    vi.useFakeTimers();
    mountSignLikeShell();
    document.body.classList.add(OPEN_FILE_IN_TOOL_CLASS);
    initToolViewerLayout();

    expect(document.body.classList.contains(TOOL_VIEWER_PENDING_CLASS)).toBe(
      true
    );

    vi.advanceTimersByTime(10000);

    expect(document.body.classList.contains(TOOL_VIEWER_PENDING_CLASS)).toBe(
      false
    );
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
    expect(isUploadChromeSuppressed(document.getElementById('drop-zone'))).toBe(
      false
    );

    // A viewer that turns up late still takes over.
    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);
  });

  it('stops reserving once the user has closed the file', () => {
    mountSignLikeShell();
    document.body.classList.add(OPEN_FILE_IN_TOOL_CLASS);
    initToolViewerLayout();

    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();
    document.getElementById('signature-editor')?.classList.add('hidden');
    syncToolViewerLayout();

    // The open-file class outlives the selection, so a viewer the user has
    // dismissed must not read as one that is still loading.
    expect(isViewerPending()).toBe(false);
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
  });

  it('reserves the pane in CSS for every root the shell claims', () => {
    const css = readTheme();
    const block = css.slice(
      css.indexOf('body.shift-tool-viewer-pending'),
      css.indexOf('/* Compare panels are intentional inner scrollports')
    );

    expect(block).not.toBe('');
    for (const id of PENDING_VIEWER_ROOT_IDS) {
      // Without a rule the hidden root stays `display: none` and the panel
      // opens on an empty card instead of the viewer's shape.
      expect(block).toContain(`#${id}`);
    }
    expect(block).toContain('animation: shift-skeleton-pulse');
    expect(block).toMatch(/flex:\s*1 1 auto/);
    // compare-pdfs opts out in the shell, so it must not be reserved here.
    expect(block).not.toContain('#compare-viewer');
    expect(block).toMatch(
      /prefers-reduced-motion[\s\S]*shift-tool-viewer-pending[\s\S]*animation:\s*none/
    );
  });
});

describe('sidebar-boot.js viewer layout', () => {
  it('claims the viewer layout and header bar before the module runs', () => {
    mountSignLikeShell();
    sessionStorage.setItem(OPEN_FILE_FLAG_KEY, '1');

    runBootScript();

    // This is the state of the first painted frame.
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);
    expect(document.body.classList.contains(TOOL_VIEWER_PENDING_CLASS)).toBe(
      true
    );

    // Same structure the module would have produced, so it changes nothing
    // when it runs: viewer in the card, heading in a bar.
    expect(document.getElementById('signature-editor')?.parentElement?.id).toBe(
      'tool-uploader'
    );

    const bar = document.querySelector(`.${TOOL_VIEWER_BAR_CLASS}`);
    const actions = document.querySelector(`[${TOOL_VIEWER_ACTIONS_ATTR}]`);
    expect(bar?.closest('#tool-uploader')).not.toBeNull();
    expect(bar?.querySelector('h1')?.textContent).toBe('Sign PDF');
    expect(
      bar?.querySelector(`.${TOOL_VIEWER_TITLE_CLASS} p`)?.textContent
    ).toBe('Add a signature to your PDF.');
    expect(actions?.contains(document.getElementById('process-btn'))).toBe(
      true
    );
    expect(
      document.querySelector(`[${TOOL_VIEWER_SLOT_ATTR}="process-btn"]`)
    ).not.toBeNull();

    // The module then takes the markup over as-is rather than building a
    // second bar.
    initToolViewerLayout();
    expect(document.querySelectorAll(`.${TOOL_VIEWER_BAR_CLASS}`)).toHaveLength(
      1
    );
    expect(document.body.classList.contains(TOOL_VIEWER_PENDING_CLASS)).toBe(
      true
    );
  });

  it('leaves the card alone when nothing is selected', () => {
    mountSignLikeShell();

    runBootScript();

    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
    expect(document.querySelector(`.${TOOL_VIEWER_BAR_CLASS}`)).toBeNull();
  });

  it('shares its literals with tool-viewer-layout.ts', () => {
    const declared = (name: string) =>
      BOOT_SCRIPT.match(new RegExp(`var ${name} = \\[([^\\]]*)\\]`))?.[1] ?? '';

    const parse = (list: string) =>
      list.match(/'([^']+)'/g)?.map((quoted) => quoted.slice(1, -1)) ?? [];

    // A classic script cannot import the module, so drift here is silent: the
    // shell would reserve a pane the module never releases, or none at all.
    expect(parse(declared('VIEWER_ROOT_IDS'))).toEqual([...VIEWER_ROOT_IDS]);
    expect(parse(declared('MULTI_FILE_VIEWER_ROOT_IDS'))).toEqual([
      ...MULTI_FILE_VIEWER_ROOT_IDS,
    ]);
    expect(parse(declared('VIEWER_ACTION_IDS'))).toEqual([
      ...VIEWER_DOWNLOAD_BUTTON_IDS,
    ]);
    expect(BOOT_SCRIPT).toContain(`'${TOOL_VIEWER_BODY_CLASS}'`);
    expect(BOOT_SCRIPT).toContain(`'${TOOL_VIEWER_PENDING_CLASS}'`);
    expect(BOOT_SCRIPT).toContain(`'${TOOL_VIEWER_BAR_CLASS}'`);
    expect(BOOT_SCRIPT).toContain(`'${TOOL_VIEWER_TITLE_CLASS}'`);
    expect(BOOT_SCRIPT).toContain(`'${TOOL_VIEWER_ACTIONS_ATTR}'`);
    expect(BOOT_SCRIPT).toContain(`'${TOOL_VIEWER_SLOT_ATTR}'`);
  });
});
